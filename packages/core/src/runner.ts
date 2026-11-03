import {
  analyzeToolPaths,
  attributeFailures,
  clusterFailures,
  clusterResponses,
  detectEnvironmentVariance,
  stableStringify,
  toolPathOf,
  type ClusterOptions,
} from "./analyzers.js";
import { evaluateGate } from "./gate.js";
import {
  classifyStability,
  flakiness,
  mean,
  passAtK,
  passHatK,
  percentile,
  requiredRuns,
  wilsonInterval,
} from "./statistics.js";
import type {
  AgentDefinition,
  AgentOutput,
  CriterionResult,
  GateConfig,
  RunRecord,
  Scenario,
  ScenarioReport,
  ScenarioStats,
  SuiteReport,
  ToolBox,
  ToolCall,
  ToolMode,
} from "./types.js";

export interface RunEvent {
  agent: string;
  scenarioId: string;
  run: RunRecord;
  completed: number;
  total: number;
}

export interface RunnerOptions {
  /** Executions per (agent, scenario). Default 20. */
  runs?: number;
  /** Maximum executions in flight at once. Default 5. */
  concurrency?: number;
  /** Per-execution timeout. Default 60s. */
  timeoutMs?: number;
  /** Retries for executions that throw (infrastructure errors only). Default 1. */
  retries?: number;
  /** Default "frozen". See {@link ToolMode}. */
  toolMode?: ToolMode;
  /** k values for pass@k and pass^k. Default [1, 3, 5, 10]. */
  k?: number[];
  /** Confidence level for intervals. Default 0.95. */
  confidence?: number;
  cluster?: ClusterOptions;
  onRun?: (event: RunEvent) => void;
}

export interface SuiteInput {
  name: string;
  agents: AgentDefinition[];
  scenarios: Scenario[];
  gate?: GateConfig;
  baseline?: SuiteReport;
  git?: SuiteReport["git"];
}

class TimeoutError extends Error {}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`Timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

/** Tool router for one (agent, scenario) batch: records every call and, in frozen mode, replays results. */
function createToolBox(
  handlers: Record<string, (args: any) => unknown>,
  mode: ToolMode,
  cache: Map<string, Promise<{ result?: unknown; error?: string }>>,
  record: ToolCall[],
): ToolBox {
  return {
    async call<T>(name: string, args?: unknown): Promise<T> {
      const handler = handlers[name];
      if (!handler) {
        record.push({ name, args, error: `Unknown tool: ${name}` });
        throw new Error(`Unknown tool: ${name}`);
      }
      const invoke = async () => {
        try {
          return { result: await handler(args) };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      };
      let outcome: { result?: unknown; error?: string };
      if (mode === "frozen") {
        const key = `${name}::${stableStringify(args)}`;
        let pending = cache.get(key);
        if (!pending) {
          pending = invoke();
          cache.set(key, pending);
        }
        outcome = await pending;
      } else {
        outcome = await invoke();
      }
      record.push({ name, args, ...outcome });
      if (outcome.error !== undefined) throw new Error(outcome.error);
      return outcome.result as T;
    },
  };
}

export function computeStats(runs: RunRecord[], ks: number[], confidence: number): ScenarioStats {
  const errors = runs.filter((r) => r.status === "error").length;
  const passed = runs.filter((r) => r.status === "passed").length;
  const scored = runs.length - errors;
  const rate = scored ? passed / scored : 0;
  const passAt: Record<string, number> = {};
  const passHat: Record<string, number> = {};
  for (const k of ks) {
    if (k > scored) continue;
    passAt[k] = passAtK(scored, passed, k);
    passHat[k] = passHatK(scored, passed, k);
  }
  const latencies = runs.filter((r) => r.status !== "error").map((r) => r.latencyMs);
  const costs = runs.map((r) => r.usage?.costUsd).filter((c): c is number => typeof c === "number");
  return {
    runs: runs.length,
    passed,
    failed: scored - passed,
    errors,
    passRate: rate,
    passRateInterval: wilsonInterval(passed, scored, confidence),
    passAtK: passAt,
    passHatK: passHat,
    stability: classifyStability(passed, scored),
    flakiness: flakiness(passed, scored),
    runsFor5ptMargin: requiredRuns(0.05, scored ? rate : 0.5, confidence),
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), mean: mean(latencies) },
    ...(costs.length ? { totalCostUsd: costs.reduce((a, b) => a + b, 0) } : {}),
  };
}

export class ReliabilityRunner {
  readonly options: Required<Omit<RunnerOptions, "onRun" | "cluster">> & Pick<RunnerOptions, "onRun" | "cluster">;

  constructor(options: RunnerOptions = {}) {
    this.options = {
      runs: options.runs ?? 20,
      concurrency: options.concurrency ?? 5,
      timeoutMs: options.timeoutMs ?? 60_000,
      retries: options.retries ?? 1,
      toolMode: options.toolMode ?? "frozen",
      k: options.k ?? [1, 3, 5, 10],
      confidence: options.confidence ?? 0.95,
      cluster: options.cluster,
      onRun: options.onRun,
    };
    if (this.options.runs < 1) throw new Error("runs must be >= 1");
  }

  /** Runs one scenario against one agent `runs` times and analyzes the results. */
  async evaluate(agent: AgentDefinition, scenario: Scenario): Promise<ScenarioReport> {
    const { runs: n, concurrency, toolMode } = this.options;
    const cache = new Map<string, Promise<{ result?: unknown; error?: string }>>();
    const records: RunRecord[] = new Array(n);
    let completed = 0;

    await pool(
      Array.from({ length: n }, (_, i) => i),
      concurrency,
      async (index) => {
        records[index] = await this.executeOnce(agent, scenario, index, toolMode, cache);
        completed++;
        this.options.onRun?.({ agent: agent.name, scenarioId: scenario.id, run: records[index]!, completed, total: n });
      },
    );

    attributeFailures(records);
    const responseClusters = await clusterResponses(records, this.options.cluster);
    return {
      scenarioId: scenario.id,
      description: scenario.description,
      agent: agent.name,
      model: agent.model,
      toolMode,
      stats: computeStats(records, this.options.k, this.options.confidence),
      toolPaths: analyzeToolPaths(records),
      responseClusters,
      failureClusters: clusterFailures(records),
      environmentVariance: detectEnvironmentVariance(records),
      runs: records,
    };
  }

  /** Runs every scenario against every agent and applies the release gate. */
  async runSuite(input: SuiteInput): Promise<SuiteReport> {
    const reports: ScenarioReport[] = [];
    for (const agent of input.agents) {
      for (const scenario of input.scenarios) {
        reports.push(await this.evaluate(agent, scenario));
      }
    }
    const createdAt = new Date().toISOString();
    const suite: SuiteReport = {
      schemaVersion: 1,
      id: `${createdAt.replace(/[:.]/g, "-")}`,
      name: input.name,
      createdAt,
      runsPerScenario: this.options.runs,
      concurrency: this.options.concurrency,
      toolMode: this.options.toolMode,
      ...(input.git ? { git: input.git } : {}),
      scenarios: reports,
    };
    if (input.gate || input.baseline) suite.gate = evaluateGate(suite, input.gate ?? {}, input.baseline);
    return suite;
  }

  private async executeOnce(
    agent: AgentDefinition,
    scenario: Scenario,
    index: number,
    toolMode: ToolMode,
    cache: Map<string, Promise<{ result?: unknown; error?: string }>>,
  ): Promise<RunRecord> {
    const { retries, timeoutMs } = this.options;
    let attempts = 0;
    let lastError = "";
    let recorded: ToolCall[] = [];
    let output: AgentOutput | undefined;
    let latencyMs = 0;

    while (attempts <= retries) {
      attempts++;
      recorded = [];
      const tools = createToolBox(agent.tools ?? {}, toolMode, cache, recorded);
      const started = performance.now();
      try {
        output = await withTimeout((signal) => agent.run(scenario.input, { runIndex: index, tools, signal }), timeoutMs);
        latencyMs = performance.now() - started;
        break;
      } catch (e) {
        latencyMs = performance.now() - started;
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    const metadata = { ...(output?.metadata ?? {}), input: scenario.input };
    if (!output) {
      return {
        index,
        status: "error",
        output: "",
        toolCalls: recorded,
        toolPath: toolPathOf(recorded),
        criteria: [],
        latencyMs,
        attempts,
        error: lastError,
        metadata,
      };
    }

    const toolCalls = output.toolCalls ?? recorded;
    const run: RunRecord = {
      index,
      status: "passed",
      output: output.output,
      toolCalls,
      toolPath: toolPathOf(toolCalls),
      criteria: [],
      latencyMs,
      attempts,
      ...(output.usage ? { usage: output.usage } : {}),
      metadata,
    };

    run.criteria = await Promise.all(
      scenario.criteria.map(async (c): Promise<CriterionResult> => {
        try {
          const verdict = await c.check(run);
          const v = typeof verdict === "boolean" ? { pass: verdict } : verdict;
          return { id: c.id, description: c.description, pass: v.pass, ...(v.reason && !v.pass ? { reason: v.reason } : {}) };
        } catch (e) {
          return { id: c.id, description: c.description, pass: false, reason: `Evaluator error: ${e instanceof Error ? e.message : e}` };
        }
      }),
    );
    run.status = run.criteria.every((c) => c.pass) ? "passed" : "failed";
    return run;
  }
}
