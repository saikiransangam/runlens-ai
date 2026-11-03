# Methodology

RunLens answers one question: **how often does this agent do the right thing, and how sure are we?**
This page explains each number in a report and why it's computed that way.

## Pass rate and its confidence interval

Each (agent, scenario) pair is executed `n` times. A run passes when every criterion passes.
Runs that throw or time out are *infrastructure errors*: they're retried, reported separately,
and excluded from the pass-rate denominator. A crashed HTTP call says nothing about the model.

The interval is a **Wilson score interval**. The textbook normal approximation
(`p ± z·sqrt(p(1-p)/n)`) breaks down at the small `n` and extreme pass rates typical of agent
evals: at 20/20 it reports `[100%, 100%]`. Wilson gives `[83.9%, 100%]`, which is honest.

> 17/20 passing is not "85% reliable". It is "somewhere between 64% and 95%, probably".

`runsFor5ptMargin` tells you how many runs you would need to pin the estimate to ±5 points
(`n = z²·p(1-p)/E²`). At a pass rate of 85% that is 196 runs, which is why RunLens reports the interval
instead of pretending a 20-run sample is precise.

## pass@k and pass^k

- **pass@k**: probability that *at least one* of k attempts passes (Chen et al., 2021). This is
  useful when a human or verifier can pick the best of k.
- **pass^k**: probability that *all* k attempts pass (Yao et al., τ-bench, 2024). This is the
  number that matters for production agents, where every user conversation must go right.

Both use the unbiased combinatorial estimators (`C(c,k)/C(n,k)` for pass^k). An agent at
85% pass@1 has a pass^5 of about 44%: in more than half of all groups of five users, at least one gets a wrong answer.

## Stability and flakiness

- `stable-pass`: every run passed. `stable-fail`: none did. `flaky`: anything in between.
- `flakiness = 1 − |2p − 1|`: 0 when runs agree, 1 at a coin flip.

## Tool-path divergence

Each run's tool calls are reduced to a path (`lookupOrder → lookupPolicy → createReturnLabel`).
RunLens reports the distinct paths, their share, the pass rate *per path*, and the Shannon entropy
of the path distribution. A path that never passes points directly at the behavior to fix.

## Response clustering

Final answers are grouped with deterministic leader clustering, using token-set Jaccard similarity
by default or cosine similarity when you pass an `embed` function. Clusters that mix passing and failing
runs are worth reading: the agent *said* the same thing but *did* something different.

## Separating model, environment and infrastructure failures

Agent failures have three different causes, and blaming the model for all of them hides real bugs.

| Source | Detected when |
|---|---|
| infrastructure | the run threw or timed out (after retries) |
| environment | a tool returned something other than its most common result for the same arguments |
| model | the environment looked normal, so the agent's own behavior failed |

Two tool modes control this:

- **`frozen`** (default): the first result for each `(tool, args)` pair is cached and replayed
  to every other run. Only the model varies, so every remaining failure is a model failure.
- **`live`**: every run calls the real tool. RunLens records any `(tool, args)` pair that
  returned different results across runs (`environmentVariance`) and attributes failures accordingly.

Environment attribution is a heuristic. A run that both got stale data *and* made a model mistake
is labeled `environment`. Use frozen mode when you need a clean model-only measurement.

## Regression detection

`runlens compare baseline.json current.json` (or `--baseline` on `run`) uses a **one-sided Fisher
exact test** per (agent, scenario): "is the current pass rate lower than the baseline's?" Exact tests
are valid at small `n`, where a z-test is not. A drop from 17/20 to 16/20 gives p ≈ 0.5, which is noise and
does not fail the build. A drop from 19/20 to 8/20 gives p < 0.001 and fails it.

## The release gate

```ts
gate: {
  minPassRateLowerBound: 0.8, // the interval's lower bound must clear 80%
  minPassRate: 0.9,           // optional: point estimate threshold
  failOnFlaky: false,         // optional: any flaky scenario fails the gate
  regressionAlpha: 0.05,      // significance level for baseline comparison
}
```

Gating on the **lower bound** means a lucky small sample cannot pass, and gating regressions on
**significance** means noise cannot fail. Raising `runs` narrows the interval and makes the gate
both stricter and fairer.
