import type { Interval, Stability } from "./types.js";

const Z_BY_LEVEL: Record<string, number> = { "0.9": 1.6449, "0.95": 1.96, "0.99": 2.5758 };

export function zForLevel(level: number): number {
  const z = Z_BY_LEVEL[String(level)];
  if (z === undefined) throw new Error(`Unsupported confidence level ${level}; use 0.9, 0.95 or 0.99`);
  return z;
}

/**
 * Wilson score interval for a binomial proportion. Unlike the normal
 * approximation it behaves well at small n and at 0% / 100% pass rates,
 * which is exactly where agent test suites live.
 */
export function wilsonInterval(successes: number, trials: number, level = 0.95): Interval {
  if (trials === 0) return { low: 0, high: 1, level };
  const z = zForLevel(level);
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half), level };
}

/** C(n, k) / C(m, k) computed as a running product to avoid overflow. */
function chooseRatio(n: number, m: number, k: number): number {
  if (k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r *= (n - i) / (m - i);
  return r;
}

/**
 * Unbiased estimate of pass@k from n samples with c successes
 * (Chen et al., 2021): probability that at least one of k attempts passes.
 */
export function passAtK(n: number, c: number, k: number): number {
  if (k > n) throw new Error(`k (${k}) cannot exceed n (${n})`);
  if (n - c < k) return 1;
  return 1 - chooseRatio(n - c, n, k);
}

/**
 * Unbiased estimate of pass^k (Yao et al., tau-bench, 2024): probability that
 * all k independent attempts pass. This is the consistency metric that matters
 * when every user conversation must go right, not just one of them.
 */
export function passHatK(n: number, c: number, k: number): number {
  if (k > n) throw new Error(`k (${k}) cannot exceed n (${n})`);
  return chooseRatio(c, n, k);
}

/** 0 when all runs agree, 1 at an even pass/fail split. */
export function flakiness(passed: number, total: number): number {
  if (total === 0) return 0;
  const p = passed / total;
  return 1 - Math.abs(2 * p - 1);
}

export function classifyStability(passed: number, total: number): Stability {
  if (total === 0 || passed === 0) return "stable-fail";
  if (passed === total) return "stable-pass";
  return "flaky";
}

/**
 * Runs needed to estimate a pass rate to within +/- margin at the given
 * confidence. Uses p = 0.5 (worst case) when no estimate is supplied.
 */
export function requiredRuns(margin: number, estimatedRate = 0.5, level = 0.95): number {
  const z = zForLevel(level);
  const p = Math.min(Math.max(estimatedRate, 0.01), 0.99);
  return Math.ceil((z * z * p * (1 - p)) / (margin * margin));
}

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/**
 * One-sided Fisher exact test: p-value for the hypothesis that the current
 * pass rate is lower than the baseline. Exact, so it is valid for the small
 * run counts typical of agent evals where a z-test is not.
 */
export function fisherRegressionPValue(
  baselinePassed: number,
  baselineTotal: number,
  currentPassed: number,
  currentTotal: number,
): number {
  const total = baselineTotal + currentTotal;
  const totalPassed = baselinePassed + currentPassed;
  const lo = Math.max(0, currentTotal - (total - totalPassed));
  const logDenom = logChoose(total, currentTotal);
  let p = 0;
  for (let x = lo; x <= currentPassed; x++) {
    p += Math.exp(logChoose(totalPassed, x) + logChoose(total - totalPassed, currentTotal - x) - logDenom);
  }
  return Math.min(1, p);
}

export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx]!;
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

export function entropyBits(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h === 0 ? 0 : h;
}
