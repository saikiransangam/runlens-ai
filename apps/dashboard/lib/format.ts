import type { FailureSource, Stability } from "@runlens/core";

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
export const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)}s` : `${Math.round(x)}ms`);
export const usd = (x: number) => `$${x < 0.01 ? x.toFixed(4) : x.toFixed(2)}`;

export const stabilityStatus: Record<Stability, { status: string; label: string }> = {
  "stable-pass": { status: "good", label: "Stable pass" },
  flaky: { status: "warning", label: "Flaky" },
  "stable-fail": { status: "critical", label: "Stable fail" },
};

export const sourceStatus: Record<FailureSource, { status: string; label: string }> = {
  model: { status: "critical", label: "Model" },
  environment: { status: "serious", label: "Environment" },
  infrastructure: { status: "warning", label: "Infrastructure" },
};

/** Series color by entity (agent), assigned in first-seen order so it never depends on rank. */
export function agentColors(agents: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of agents) if (!map.has(a)) map.set(a, `var(--series-${(map.size % 8) + 1})`);
  return map;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
