import { defineConfig } from "@runlens/core";
import { llmAgent } from "./llm-agent.js";
import { createTools, scenarios } from "./shop.js";

/**
 * Real-model comparison with frozen tools, so every difference between runs
 * comes from the model. Requires an OpenAI-compatible key:
 *
 *   OPENAI_API_KEY=... pnpm --filter customer-support-example run reliability:llm
 *   RUNLENS_LLM_MODELS=a,b RUNLENS_LLM_BASE_URL=https://openrouter.ai/api/v1 OPENAI_API_KEY=... pnpm ...
 */
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY to run real models");

const models = (process.env.RUNLENS_LLM_MODELS ?? "gpt-4.1-mini,gpt-5.4-nano,gpt-5.4-mini")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const tools = createTools();

export default defineConfig({
  name: "customer-support: real models",
  agents: models.map((model) =>
    llmAgent({ model, apiKey, baseUrl: process.env.RUNLENS_LLM_BASE_URL ?? "https://api.openai.com/v1", tools }),
  ),
  scenarios,
  runs: 30,
  concurrency: 6,
  timeoutMs: 90_000,
  retries: 2,
  toolMode: "frozen",
  gate: { minPassRateLowerBound: 0.8 },
});
