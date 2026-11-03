import { fisherRegressionPValue } from "./statistics.js";
import type { GateConfig, GateResult, Regression, SuiteReport } from "./types.js";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Compares each (agent, scenario) pair against the baseline with a one-sided Fisher exact test. */
export function findRegressions(current: SuiteReport, baseline: SuiteReport, alpha = 0.05): Regression[] {
  const regressions: Regression[] = [];
  for (const cur of current.scenarios) {
    const base = baseline.scenarios.find((b) => b.scenarioId === cur.scenarioId && b.agent === cur.agent);
    if (!base) continue;
    const bTotal = base.stats.passed + base.stats.failed;
    const cTotal = cur.stats.passed + cur.stats.failed;
    if (bTotal === 0 || cTotal === 0) continue;
    const pValue = fisherRegressionPValue(base.stats.passed, bTotal, cur.stats.passed, cTotal);
    regressions.push({
      scenarioId: cur.scenarioId,
      agent: cur.agent,
      baselinePassRate: base.stats.passRate,
      currentPassRate: cur.stats.passRate,
      pValue,
      significant: cur.stats.passRate < base.stats.passRate && pValue < alpha,
    });
  }
  return regressions;
}

/**
 * Decides whether a suite is releasable. Thresholds apply to the lower bound
 * of the confidence interval where possible, so a lucky small sample cannot
 * pass the gate, and regressions must be statistically significant, so noise
 * cannot fail it.
 */
export function evaluateGate(suite: SuiteReport, gate: GateConfig, baseline?: SuiteReport): GateResult {
  const violations: string[] = [];
  for (const s of suite.scenarios) {
    const name = `${s.agent} / ${s.scenarioId}`;
    if (gate.minPassRateLowerBound !== undefined && s.stats.passRateInterval.low < gate.minPassRateLowerBound) {
      violations.push(
        `${name}: pass-rate lower bound ${pct(s.stats.passRateInterval.low)} is below ${pct(gate.minPassRateLowerBound)}`,
      );
    }
    if (gate.minPassRate !== undefined && s.stats.passRate < gate.minPassRate) {
      violations.push(`${name}: pass rate ${pct(s.stats.passRate)} is below ${pct(gate.minPassRate)}`);
    }
    if (gate.failOnFlaky && s.stats.stability === "flaky") {
      violations.push(`${name}: flaky (${s.stats.passed}/${s.stats.passed + s.stats.failed} passed)`);
    }
  }
  const regressions = baseline ? findRegressions(suite, baseline, gate.regressionAlpha ?? 0.05) : [];
  for (const r of regressions.filter((r) => r.significant)) {
    violations.push(
      `${r.agent} / ${r.scenarioId}: regressed from ${pct(r.baselinePassRate)} to ${pct(r.currentPassRate)} (p=${r.pValue.toFixed(3)})`,
    );
  }
  return { passed: violations.length === 0, config: gate, violations, regressions };
}
