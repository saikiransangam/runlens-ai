/**
 * Shared types for RunLens. Everything that ends up in a report is plain JSON
 * so reports can be diffed, stored as CI artifacts and read by the dashboard.
 */

export interface ToolCall {
  name: string;
  args?: unknown;
  result?: unknown;
  error?: string;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/** What an agent returns for one execution of a scenario. */
export interface AgentOutput {
  output: string;
  toolCalls?: ToolCall[];
  usage?: Usage;
  metadata?: Record<string, unknown>;
}

/**
 * How RunLens treats tool responses across repeated runs.
 *
 * - `live`:   every run calls the real tool. Tool-result differences between
 *             runs are detected and reported as environment variance.
 * - `frozen`: the first response for each (tool, args) pair is cached and
 *             replayed for every later run, so only the model varies.
 */
export type ToolMode = "live" | "frozen";

export type ToolHandler = (args: any) => unknown | Promise<unknown>;

export interface ToolBox {
  /** Call a tool through RunLens so the call is recorded (and replayed in frozen mode). */
  call<T = unknown>(name: string, args?: unknown): Promise<T>;
}

export interface AgentContext {
  /** 0-based index of this execution within the batch. */
  runIndex: number;
  /** Tools routed through RunLens. Use these instead of calling tools directly. */
  tools: ToolBox;
  signal: AbortSignal;
}

export type AgentFn = (input: string, ctx: AgentContext) => Promise<AgentOutput>;

export interface AgentDefinition {
  /** Display name, e.g. "support-bot". */
  name: string;
  /** Model identifier, used for cross-model comparison. */
  model?: string;
  run: AgentFn;
  /** Tool implementations available to the agent through `ctx.tools`. */
  tools?: Record<string, ToolHandler>;
}

export interface Scenario {
  id: string;
  description?: string;
  input: string;
  criteria: Criterion[];
  tags?: string[];
}

export interface CriterionVerdict {
  pass: boolean;
  reason?: string;
}

export interface Criterion {
  id: string;
  description: string;
  check: (run: RunRecord) => boolean | CriterionVerdict | Promise<boolean | CriterionVerdict>;
}

export type RunStatus = "passed" | "failed" | "error";

/** Where RunLens thinks a failure came from. */
export type FailureSource = "model" | "environment" | "infrastructure";

export interface CriterionResult {
  id: string;
  description: string;
  pass: boolean;
  reason?: string;
}

/** One execution of one scenario against one agent. */
export interface RunRecord {
  index: number;
  status: RunStatus;
  output: string;
  toolCalls: ToolCall[];
  /** Tool names in call order joined with " → ", or "(no tools)". */
  toolPath: string;
  criteria: CriterionResult[];
  latencyMs: number;
  attempts: number;
  usage?: Usage;
  error?: string;
  failureSource?: FailureSource;
  responseCluster?: number;
  metadata?: Record<string, unknown>;
}

export interface Interval {
  low: number;
  high: number;
  /** Confidence level, e.g. 0.95. */
  level: number;
}

export type Stability = "stable-pass" | "stable-fail" | "flaky";

export interface ScenarioStats {
  runs: number;
  passed: number;
  failed: number;
  errors: number;
  /** passed / (runs - errors). Infrastructure errors are excluded from the denominator. */
  passRate: number;
  passRateInterval: Interval;
  /** Probability that at least one of k attempts passes (unbiased estimator). */
  passAtK: Record<string, number>;
  /** Probability that all k attempts pass: the consistency metric from tau-bench. */
  passHatK: Record<string, number>;
  stability: Stability;
  /** 0 when every run agrees, 1 at a 50/50 split. */
  flakiness: number;
  /** Runs needed to estimate this pass rate to +/- 5 points at 95% confidence. */
  runsFor5ptMargin: number;
  latencyMs: { p50: number; p95: number; mean: number };
  totalCostUsd?: number;
}

export interface ToolPathGroup {
  path: string;
  runs: number;
  passed: number;
  passRate: number;
  share: number;
}

export interface ToolPathAnalysis {
  distinctPaths: number;
  /** Shannon entropy (bits) of the path distribution. 0 = always the same path. */
  entropy: number;
  dominantPath: string;
  groups: ToolPathGroup[];
}

export interface ResponseCluster {
  id: number;
  size: number;
  passed: number;
  representative: string;
  runIndexes: number[];
}

export interface FailureCluster {
  id: number;
  label: string;
  failedCriteria: string[];
  toolPath: string;
  source: FailureSource;
  count: number;
  runIndexes: number[];
  exampleOutput: string;
  exampleReason?: string;
}

export interface EnvironmentVariance {
  tool: string;
  args: unknown;
  distinctResults: number;
  calls: number;
}

export interface ScenarioReport {
  scenarioId: string;
  description?: string;
  agent: string;
  model?: string;
  toolMode: ToolMode;
  stats: ScenarioStats;
  toolPaths: ToolPathAnalysis;
  responseClusters: ResponseCluster[];
  failureClusters: FailureCluster[];
  environmentVariance: EnvironmentVariance[];
  runs: RunRecord[];
}

export interface GateConfig {
  /** Fail when the lower bound of the pass-rate interval is below this value. */
  minPassRateLowerBound?: number;
  /** Fail when the point estimate is below this value. */
  minPassRate?: number;
  /** Fail when any scenario is flaky. */
  failOnFlaky?: boolean;
  /** Significance level for regression detection against a baseline. */
  regressionAlpha?: number;
}

export interface Regression {
  scenarioId: string;
  agent: string;
  baselinePassRate: number;
  currentPassRate: number;
  /** One-sided Fisher exact p-value for "current is worse than baseline". */
  pValue: number;
  significant: boolean;
}

export interface GateResult {
  passed: boolean;
  config: GateConfig;
  violations: string[];
  regressions: Regression[];
}

export interface SuiteReport {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  runsPerScenario: number;
  concurrency: number;
  toolMode: ToolMode;
  git?: { sha?: string; branch?: string };
  scenarios: ScenarioReport[];
  gate?: GateResult;
}
