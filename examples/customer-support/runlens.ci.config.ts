import { defineConfig } from "@runlens/core";
import { createTools, scenarios } from "./shop.js";
import { profiles, simulatedAgent } from "./simulated-agents.js";

/**
 * Release gate for the production agent. Tools are frozen so only the model
 * varies, and the gate uses the lower confidence bound so a lucky small
 * sample cannot pass.
 */
const production = profiles.find((p) => p.model === "sim-large")!;

export default defineConfig({
  name: "customer-support: release gate",
  agents: [simulatedAgent(production, createTools())],
  scenarios,
  runs: 40,
  concurrency: 8,
  toolMode: "frozen",
  gate: { minPassRateLowerBound: 0.8, regressionAlpha: 0.05 },
});
