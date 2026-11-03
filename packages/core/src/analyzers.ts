import { entropyBits } from "./statistics.js";
import type {
  EnvironmentVariance,
  FailureCluster,
  FailureSource,
  ResponseCluster,
  RunRecord,
  ToolCall,
  ToolPathAnalysis,
} from "./types.js";

export const NO_TOOLS = "(no tools)";

/** JSON.stringify with sorted object keys, so equal values hash equally. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function toolPathOf(calls: ToolCall[]): string {
  return calls.length === 0 ? NO_TOOLS : calls.map((c) => c.name).join(" → ");
}

/** Groups runs by the sequence of tools they called and the pass rate of each path. */
export function analyzeToolPaths(runs: RunRecord[]): ToolPathAnalysis {
  const scored = runs.filter((r) => r.status !== "error");
  const byPath = new Map<string, { runs: number; passed: number }>();
  for (const r of scored) {
    const g = byPath.get(r.toolPath) ?? { runs: 0, passed: 0 };
    g.runs++;
    if (r.status === "passed") g.passed++;
    byPath.set(r.toolPath, g);
  }
  const groups = [...byPath.entries()]
    .map(([path, g]) => ({
      path,
      runs: g.runs,
      passed: g.passed,
      passRate: g.passed / g.runs,
      share: scored.length ? g.runs / scored.length : 0,
    }))
    .sort((a, b) => b.runs - a.runs);
  return {
    distinctPaths: groups.length,
    entropy: entropyBits(groups.map((g) => g.runs)),
    dominantPath: groups[0]?.path ?? NO_TOOLS,
    groups,
  };
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export interface ClusterOptions {
  /** Similarity at or above which two responses share a cluster. */
  threshold?: number;
  /** Optional embedding function for semantic clustering. Falls back to lexical Jaccard. */
  embed?: EmbedFn;
}

/**
 * Leader clustering of responses: each response joins the most similar
 * existing cluster if it clears the threshold, otherwise starts a new one.
 * Deterministic for a fixed run order, which keeps reports reproducible.
 */
export async function clusterResponses(runs: RunRecord[], opts: ClusterOptions = {}): Promise<ResponseCluster[]> {
  const scored = runs.filter((r) => r.status !== "error");
  if (scored.length === 0) return [];
  const threshold = opts.threshold ?? (opts.embed ? 0.9 : 0.6);

  let similarity: (i: number, j: number) => number;
  if (opts.embed) {
    const vectors = await opts.embed(scored.map((r) => r.output));
    similarity = (i, j) => cosine(vectors[i]!, vectors[j]!);
  } else {
    const sets = scored.map((r) => tokens(r.output));
    similarity = (i, j) => jaccard(sets[i]!, sets[j]!);
  }

  const leaders: number[] = [];
  const members: number[][] = [];
  scored.forEach((_, i) => {
    let best = -1;
    let bestSim = threshold;
    leaders.forEach((leader, c) => {
      const s = similarity(i, leader);
      if (s >= bestSim) {
        bestSim = s;
        best = c;
      }
    });
    if (best === -1) {
      leaders.push(i);
      members.push([i]);
    } else {
      members[best]!.push(i);
    }
  });

  const clusters = members
    .map((idxs) => ({
      size: idxs.length,
      passed: idxs.filter((i) => scored[i]!.status === "passed").length,
      representative: scored[idxs[0]!]!.output,
      runIndexes: idxs.map((i) => scored[i]!.index),
    }))
    .sort((a, b) => b.size - a.size)
    .map((c, id) => ({ id, ...c }));

  for (const c of clusters) {
    for (const idx of c.runIndexes) {
      const run = runs.find((r) => r.index === idx);
      if (run) run.responseCluster = c.id;
    }
  }
  return clusters;
}

/**
 * Finds tool calls that received different results for identical arguments
 * across runs. In live mode this is how RunLens separates "the world changed"
 * from "the model changed its mind".
 */
export function detectEnvironmentVariance(runs: RunRecord[]): EnvironmentVariance[] {
  const byKey = new Map<string, { tool: string; args: unknown; results: Set<string>; calls: number }>();
  for (const r of runs) {
    for (const call of r.toolCalls) {
      const key = `${call.name}::${stableStringify(call.args)}`;
      const entry = byKey.get(key) ?? { tool: call.name, args: call.args, results: new Set<string>(), calls: 0 };
      entry.results.add(call.error ? `error:${call.error}` : stableStringify(call.result));
      entry.calls++;
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()]
    .filter((e) => e.results.size > 1)
    .map((e) => ({ tool: e.tool, args: e.args, distinctResults: e.results.size, calls: e.calls }));
}

/** Returns the modal (most common) result per (tool, args) key. */
function modalResults(runs: RunRecord[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const r of runs) {
    for (const call of r.toolCalls) {
      const key = `${call.name}::${stableStringify(call.args)}`;
      const value = call.error ? `error:${call.error}` : stableStringify(call.result);
      const m = counts.get(key) ?? new Map<string, number>();
      m.set(value, (m.get(value) ?? 0) + 1);
      counts.set(key, m);
    }
  }
  const modal = new Map<string, string>();
  for (const [key, m] of counts) {
    modal.set(key, [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
  }
  return modal;
}

/**
 * Labels every non-passing run with a likely source:
 * - infrastructure: the run threw or timed out
 * - environment: a tool returned something other than its usual result
 * - model: the environment looked normal, so the agent's own behavior failed
 */
export function attributeFailures(runs: RunRecord[]): void {
  const modal = modalResults(runs);
  for (const r of runs) {
    if (r.status === "passed") continue;
    let source: FailureSource;
    if (r.status === "error") {
      source = "infrastructure";
    } else {
      const deviated = r.toolCalls.some((call) => {
        const key = `${call.name}::${stableStringify(call.args)}`;
        const value = call.error ? `error:${call.error}` : stableStringify(call.result);
        return modal.get(key) !== value;
      });
      source = deviated ? "environment" : "model";
    }
    r.failureSource = source;
  }
}

/** Groups failing runs by (source, unmet criteria, tool path). */
export function clusterFailures(runs: RunRecord[]): FailureCluster[] {
  const groups = new Map<string, RunRecord[]>();
  for (const r of runs) {
    if (r.status === "passed") continue;
    const failed = r.criteria.filter((c) => !c.pass).map((c) => c.id).sort();
    const key =
      r.status === "error"
        ? `infrastructure::${(r.error ?? "error").slice(0, 80)}`
        : `${r.failureSource}::${failed.join(",")}::${r.toolPath}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return [...groups.values()]
    .map((list) => {
      const first = list[0]!;
      const failedCriteria = first.criteria.filter((c) => !c.pass).map((c) => c.id);
      const source = first.failureSource ?? "model";
      const label =
        first.status === "error"
          ? `Run error: ${first.error ?? "unknown"}`
          : `${failedCriteria.map((id) => first.criteria.find((c) => c.id === id)?.description ?? id).join("; ")}`;
      return {
        label,
        failedCriteria,
        toolPath: first.toolPath,
        source,
        count: list.length,
        runIndexes: list.map((r) => r.index),
        exampleOutput: first.output,
        exampleReason: first.criteria.find((c) => !c.pass)?.reason ?? first.error,
      };
    })
    .sort((a, b) => b.count - a.count)
    .map((c, id) => ({ id, ...c }));
}
