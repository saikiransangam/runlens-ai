import { describe, expect, it } from "vitest";
import {
  ReliabilityRunner,
  mustCallTool,
  mustContain,
  toJUnit,
  toMarkdown,
  type AgentDefinition,
  type Scenario,
} from "../src/index.js";

const scenario: Scenario = {
  id: "refund-window",
  input: "Can I return an item after 30 days?",
  criteria: [mustCallTool("lookupPolicy"), mustContain("30 days")],
};

/** Fails on every 4th run by skipping the policy lookup. */
const sometimesSkipsTool: AgentDefinition = {
  name: "sometimes-skips",
  tools: { lookupPolicy: () => ({ windowDays: 30 }) },
  async run(_input, ctx) {
    if (ctx.runIndex % 4 === 3) return { output: "Sure, returns are always accepted." };
    const policy = await ctx.tools.call<{ windowDays: number }>("lookupPolicy", { topic: "returns" });
    return { output: `Returns are accepted within ${policy.windowDays} days.` };
  },
};

describe("ReliabilityRunner", () => {
  it("computes pass rates, paths and failure clusters", async () => {
    const report = await new ReliabilityRunner({ runs: 20, concurrency: 4 }).evaluate(sometimesSkipsTool, scenario);
    expect(report.stats.passed).toBe(15);
    expect(report.stats.failed).toBe(5);
    expect(report.stats.stability).toBe("flaky");
    expect(report.toolPaths.distinctPaths).toBe(2);
    expect(report.toolPaths.groups.find((g) => g.path === "lookupPolicy")?.passRate).toBe(1);
    expect(report.failureClusters).toHaveLength(1);
    expect(report.failureClusters[0]!.source).toBe("model");
    expect(report.failureClusters[0]!.count).toBe(5);
    expect(report.responseClusters.length).toBe(2);
  });

  it("separates environment failures from model failures in live mode", async () => {
    let calls = 0;
    const agent: AgentDefinition = {
      name: "env-sensitive",
      tools: {
        // The "inventory API" returns a stale window every 5th call.
        lookupPolicy: () => ({ windowDays: ++calls % 5 === 0 ? 14 : 30 }),
      },
      async run(_input, ctx) {
        const p = await ctx.tools.call<{ windowDays: number }>("lookupPolicy", { topic: "returns" });
        return { output: `Returns are accepted within ${p.windowDays} days.` };
      },
    };
    const live = await new ReliabilityRunner({ runs: 20, concurrency: 1, toolMode: "live" }).evaluate(agent, scenario);
    expect(live.stats.failed).toBe(4);
    expect(live.environmentVariance).toHaveLength(1);
    expect(live.failureClusters.every((c) => c.source === "environment")).toBe(true);

    calls = 0;
    const frozen = await new ReliabilityRunner({ runs: 20, concurrency: 1, toolMode: "frozen" }).evaluate(agent, scenario);
    expect(frozen.stats.passed).toBe(20);
    expect(frozen.environmentVariance).toHaveLength(0);
  });

  it("records timeouts as infrastructure errors and retries them", async () => {
    let attempts = 0;
    const agent: AgentDefinition = {
      name: "slow",
      async run() {
        attempts++;
        await new Promise((r) => setTimeout(r, 50));
        return { output: "30 days" };
      },
    };
    const report = await new ReliabilityRunner({ runs: 3, timeoutMs: 10, retries: 1 }).evaluate(agent, {
      ...scenario,
      criteria: [mustContain("30 days")],
    });
    expect(report.stats.errors).toBe(3);
    expect(attempts).toBe(6);
    expect(report.failureClusters[0]!.source).toBe("infrastructure");
    expect(report.stats.passRate).toBe(0);
  });

  it("gates a suite and detects significant regressions against a baseline", async () => {
    const good: AgentDefinition = {
      name: "bot",
      tools: { lookupPolicy: () => ({ windowDays: 30 }) },
      async run(_i, ctx) {
        await ctx.tools.call("lookupPolicy", {});
        return { output: "Within 30 days." };
      },
    };
    const bad: AgentDefinition = { ...good, async run(_i, ctx) {
      if (ctx.runIndex % 2 === 0) return { output: "Any time!" };
      return good.run(_i, ctx);
    } };
    const runner = new ReliabilityRunner({ runs: 20 });
    const baseline = await runner.runSuite({ name: "base", agents: [good], scenarios: [scenario] });
    const current = await runner.runSuite({
      name: "current",
      agents: [bad],
      scenarios: [scenario],
      baseline,
      gate: { minPassRateLowerBound: 0.7 },
    });
    expect(current.gate?.passed).toBe(false);
    expect(current.gate?.regressions[0]?.significant).toBe(true);
    expect(toJUnit(current)).toContain("<failure");
    expect(toMarkdown(current)).toContain("Gate failed");
  });
});
