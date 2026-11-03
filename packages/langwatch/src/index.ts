import { criterion, type AgentContext, type AgentDefinition, type Criterion, type Scenario, type ToolCall } from "@runlens/core";

/**
 * Structural subset of `ScenarioResult` from `@langwatch/scenario`. Declared
 * here so this package does not force a specific Scenario version on users.
 */
export interface ScenarioResultLike {
  runId?: string;
  success: boolean;
  messages: ModelMessageLike[];
  reasoning?: string;
  metCriteria?: string[];
  unmetCriteria?: string[];
  inconclusiveCriteria?: string[];
  totalTime?: number;
}

type Part = { type: string; [key: string]: unknown };

export interface ModelMessageLike {
  role: string;
  content: string | Part[];
}

function textOf(content: string | Part[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

/** Extracts tool calls and their results from AI SDK-style messages (v4 and v5+ field names). */
export function extractToolCalls(messages: ModelMessageLike[]): ToolCall[] {
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const part of m.content) {
      if (part.type === "tool-call") {
        const call: ToolCall = { name: String(part.toolName), args: part.input ?? part.args };
        calls.push(call);
        if (typeof part.toolCallId === "string") byId.set(part.toolCallId, call);
      } else if (part.type === "tool-result" && typeof part.toolCallId === "string") {
        const call = byId.get(part.toolCallId);
        if (!call) continue;
        const output = part.output ?? part.result;
        // AI SDK v5+ wraps results as { type: "json" | "text" | "error-*", value }.
        if (output && typeof output === "object" && "type" in output && "value" in output) {
          const o = output as { type: string; value: unknown };
          if (o.type.startsWith("error")) call.error = String(o.value);
          else call.result = o.value;
        } else {
          call.result = output;
        }
      }
    }
  }
  return calls;
}

/** The last assistant message that has text, i.e. the agent's final answer. */
export function finalAnswer(messages: ModelMessageLike[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    const text = textOf(m.content);
    if (text.trim()) return text;
  }
  return "";
}

export interface FromScenarioOptions {
  /** Scenario id used in RunLens reports. */
  id: string;
  description?: string;
  /** Agent display name, e.g. the name of your AgentAdapter. */
  agent: string;
  model?: string;
  /**
   * The judge criteria passed to `scenario.judgeAgent({ criteria })`. Each one
   * becomes a RunLens criterion, so you get a pass rate per criterion.
   */
  criteria?: string[];
  /** Additional RunLens criteria checked on top of the Scenario judge. */
  extraCriteria?: Criterion[];
  /** Calls `scenario.run(...)` once and returns its result. */
  run: (ctx: Pick<AgentContext, "runIndex" | "signal">) => Promise<ScenarioResultLike>;
}

/**
 * Wraps a LangWatch Scenario simulation so RunLens can run it N times.
 *
 * Scenario owns the simulation (user simulator, judge, script); RunLens owns
 * repetition and statistics (pass-rate intervals, pass^k, tool-path divergence,
 * failure clustering, regression gating).
 */
export function fromScenario(opts: FromScenarioOptions): { agent: AgentDefinition; scenario: Scenario } {
  const agent: AgentDefinition = {
    name: opts.agent,
    ...(opts.model ? { model: opts.model } : {}),
    async run(_input, ctx) {
      const result = await opts.run({ runIndex: ctx.runIndex, signal: ctx.signal });
      return {
        output: finalAnswer(result.messages),
        toolCalls: extractToolCalls(result.messages),
        metadata: {
          scenarioRunId: result.runId,
          scenarioSuccess: result.success,
          reasoning: result.reasoning,
          metCriteria: result.metCriteria ?? [],
          unmetCriteria: result.unmetCriteria ?? [],
          inconclusiveCriteria: result.inconclusiveCriteria ?? [],
          transcript: result.messages.map((m) => ({ role: m.role, text: textOf(m.content) })),
        },
      };
    },
  };

  const judged: Criterion[] = (opts.criteria ?? []).map((c) =>
    criterion(c, (run) => {
      const met = (run.metadata?.metCriteria as string[] | undefined) ?? [];
      const inconclusive = (run.metadata?.inconclusiveCriteria as string[] | undefined) ?? [];
      if (met.includes(c)) return true;
      return {
        pass: false,
        reason: inconclusive.includes(c) ? "Judge could not decide from the transcript" : (run.metadata?.reasoning as string | undefined),
      };
    }),
  );

  const overall = criterion("Scenario judge verdict", (run) => ({
    pass: run.metadata?.scenarioSuccess === true,
    reason: run.metadata?.reasoning as string | undefined,
  }), "scenario-success");

  return {
    agent,
    scenario: {
      id: opts.id,
      ...(opts.description ? { description: opts.description } : {}),
      input: opts.description ?? opts.id,
      criteria: [overall, ...judged, ...(opts.extraCriteria ?? [])],
    },
  };
}
