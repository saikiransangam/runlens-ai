import { ReliabilityRunner } from "@runlens/core";
import { describe, expect, it } from "vitest";
import { extractToolCalls, finalAnswer, fromScenario, type ScenarioResultLike } from "../src/index.js";

const CRITERION = "Agent states the 30-day return window";

/** Mimics a Scenario result: the agent skips the policy tool on odd runs. */
function fakeScenarioRun(runIndex: number): ScenarioResultLike {
  const usesTool = runIndex % 2 === 0;
  return {
    runId: `run-${runIndex}`,
    success: usesTool,
    reasoning: usesTool ? "Policy cited" : "Agent guessed the policy",
    metCriteria: usesTool ? [CRITERION] : [],
    unmetCriteria: usesTool ? [] : [CRITERION],
    messages: [
      { role: "user", content: "Can I return this after 40 days?" },
      ...(usesTool
        ? [
            {
              role: "assistant",
              content: [{ type: "tool-call", toolCallId: "t1", toolName: "lookup_policy", input: { topic: "returns" } }],
            },
            {
              role: "tool",
              content: [
                { type: "tool-result", toolCallId: "t1", toolName: "lookup_policy", output: { type: "json", value: { days: 30 } } },
              ],
            },
          ]
        : []),
      { role: "assistant", content: [{ type: "text", text: usesTool ? "Returns close after 30 days." : "Sure, no problem!" }] },
    ],
  };
}

describe("extractToolCalls", () => {
  it("pairs tool calls with their results", () => {
    const calls = extractToolCalls(fakeScenarioRun(0).messages);
    expect(calls).toEqual([{ name: "lookup_policy", args: { topic: "returns" }, result: { days: 30 } }]);
  });

  it("reads the final assistant text", () => {
    expect(finalAnswer(fakeScenarioRun(1).messages)).toBe("Sure, no problem!");
  });
});

describe("fromScenario", () => {
  it("turns repeated Scenario runs into a reliability report", async () => {
    const { agent, scenario } = fromScenario({
      id: "late-return",
      agent: "support-agent",
      criteria: [CRITERION],
      run: async ({ runIndex }) => fakeScenarioRun(runIndex),
    });
    const report = await new ReliabilityRunner({ runs: 10 }).evaluate(agent, scenario);
    expect(report.stats.passed).toBe(5);
    expect(report.toolPaths.groups.map((g) => g.path).sort()).toEqual(["(no tools)", "lookup_policy"]);
    expect(report.toolPaths.groups.find((g) => g.path === "lookup_policy")?.passRate).toBe(1);
    expect(report.failureClusters[0]?.failedCriteria).toContain("scenario-success");
  });
});
