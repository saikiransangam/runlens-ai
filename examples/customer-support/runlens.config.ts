import { defineConfig } from "@runlens/core";
import { llmAgent } from "./llm-agent.js";
import { createTools, scenarios } from "./shop.js";
import { profiles, simulatedAgent } from "./simulated-agents.js";

/**
 * Cross-model comparison. Tools run live against a slightly flaky order
 * service (5% stale responses), so the report shows environment failures
 * separately from model failures.
 *
 * To add real models, set an OpenAI-compatible endpoint:
 *   RUNLENS_LLM_MODELS=gpt-4.1-mini,gpt-4.1 OPENAI_API_KEY=... pnpm reliability
 *   RUNLENS_LLM_MODELS=anthropic/claude-haiku-4.5 RUNLENS_LLM_BASE_URL=https://openrouter.ai/api/v1 OPENAI_API_KEY=... pnpm reliability
 */
const tools = createTools({ flakyRate: 0.05 });

const llmModels = (process.env.RUNLENS_LLM_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
const llmAgents = llmModels.map((model) =>
  llmAgent({
    model,
    apiKey: process.env.OPENAI_API_KEY ?? "",
    baseUrl: process.env.RUNLENS_LLM_BASE_URL ?? "https://api.openai.com/v1",
    tools,
  }),
);

export default defineConfig({
  name: "customer-support: model comparison",
  agents: [...profiles.map((p) => simulatedAgent(p, tools)), ...llmAgents],
  scenarios,
  runs: 30,
  concurrency: 8,
  toolMode: "live",
  gate: { minPassRateLowerBound: 0.8 },
});
