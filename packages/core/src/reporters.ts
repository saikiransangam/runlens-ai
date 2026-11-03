import type { ScenarioReport, SuiteReport } from "./types.js";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const interval = (s: ScenarioReport) =>
  `${pct(s.stats.passRateInterval.low)}–${pct(s.stats.passRateInterval.high)}`;

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

export function toJSON(suite: SuiteReport): string {
  return JSON.stringify(suite, null, 2);
}

/**
 * JUnit XML: one test case per (agent, scenario). A case fails when the gate
 * flagged it; otherwise flaky cases pass with their statistics in system-out,
 * so CI dashboards show the numbers without turning noise into red builds.
 */
export function toJUnit(suite: SuiteReport): string {
  const violations = suite.gate?.violations ?? [];
  const cases = suite.scenarios.map((s) => {
    const name = `${s.agent} / ${s.scenarioId}`;
    const mine = violations.filter((v) => v.startsWith(`${name}:`));
    const time = (s.stats.latencyMs.mean / 1000).toFixed(3);
    const out = `pass rate ${pct(s.stats.passRate)} (95% CI ${interval(s)}), ${s.stats.passed}/${s.stats.passed + s.stats.failed} passed, ${s.stats.errors} errors, ${s.stats.stability}`;
    const failure = mine.length
      ? `<failure message="${escapeXml(mine.join("; "))}">${escapeXml(
          s.failureClusters.map((c) => `[${c.source}] x${c.count}: ${c.label}`).join("\n"),
        )}</failure>`
      : "";
    return `    <testcase classname="${escapeXml(s.agent)}" name="${escapeXml(s.scenarioId)}" time="${time}">${failure}<system-out>${escapeXml(out)}</system-out></testcase>`;
  });
  const failures = suite.scenarios.filter((s) => violations.some((v) => v.startsWith(`${s.agent} / ${s.scenarioId}:`))).length;
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${escapeXml(suite.name)}" tests="${suite.scenarios.length}" failures="${failures}">
  <testsuite name="${escapeXml(suite.name)}" tests="${suite.scenarios.length}" failures="${failures}" timestamp="${suite.createdAt}">
${cases.join("\n")}
  </testsuite>
</testsuites>
`;
}

/** Markdown summary, suitable for $GITHUB_STEP_SUMMARY or a PR comment. */
export function toMarkdown(suite: SuiteReport): string {
  const lines: string[] = [];
  const status = suite.gate ? (suite.gate.passed ? "✅ Gate passed" : "❌ Gate failed") : "No gate configured";
  lines.push(`## RunLens reliability report: ${suite.name}`, "");
  lines.push(`${status} · ${suite.runsPerScenario} runs per scenario · tools ${suite.toolMode}`, "");
  lines.push("| Agent | Scenario | Pass rate | 95% CI | pass^5 | Stability | Tool paths | Top failure |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const s of suite.scenarios) {
    const top = s.failureClusters[0];
    lines.push(
      `| ${s.agent}${s.model ? ` (${s.model})` : ""} | ${s.scenarioId} | ${pct(s.stats.passRate)} | ${interval(s)} | ${
        s.stats.passHatK["5"] !== undefined ? pct(s.stats.passHatK["5"]) : "–"
      } | ${s.stats.stability} | ${s.toolPaths.distinctPaths} | ${top ? `${top.label} (${top.source}, ×${top.count})` : "–"} |`,
    );
  }
  if (suite.gate?.violations.length) {
    lines.push("", "### Gate violations", ...suite.gate.violations.map((v) => `- ${v}`));
  }
  const sig = suite.gate?.regressions.filter((r) => r.significant) ?? [];
  if (sig.length) {
    lines.push("", "### Significant regressions");
    for (const r of sig) {
      lines.push(`- ${r.agent} / ${r.scenarioId}: ${pct(r.baselinePassRate)} → ${pct(r.currentPassRate)} (p=${r.pValue.toFixed(3)})`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Compact console table. */
export function toConsole(suite: SuiteReport): string {
  const rows = suite.scenarios.map((s) => [
    s.agent,
    s.scenarioId,
    `${s.stats.passed}/${s.stats.passed + s.stats.failed}`,
    pct(s.stats.passRate),
    interval(s),
    s.stats.stability,
    String(s.toolPaths.distinctPaths),
    String(s.failureClusters.length),
  ]);
  const header = ["agent", "scenario", "passed", "rate", "95% CI", "stability", "paths", "failure clusters"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  const out = [fmt(header), fmt(widths.map((w) => "-".repeat(w))), ...rows.map(fmt)];
  if (suite.gate) {
    out.push("", suite.gate.passed ? "Gate: PASSED" : "Gate: FAILED");
    for (const v of suite.gate.violations) out.push(`  - ${v}`);
  }
  return out.join("\n");
}
