import { defineConfig } from "@runlens/core";
import { llmAgent } from "./llm-agent.js";
import { createTools, scenarios } from "./shop.js";

/**
 * Real-model comparison with frozen tools, so every difference between runs
 * comes from the model. Uses OpenRouter when OPENROUTER_API_KEY is set (one
 * key, many providers), otherwise OpenAI:
 *
 *   OPENROUTER_API_KEY=... pnpm --filter customer-support-example run reliability:llm
 *   OPENAI_API_KEY=...     pnpm --filter customer-support-example run reliability:llm
 *   RUNLENS_LLM_MODELS=openai/gpt-5.4,anthropic/claude-sonnet-5.5 OPENROUTER_API_KEY=... pnpm ...
 */
const openRouterKey = process.env.OPENROUTER_API_KEY;
const apiKey = openRouterKey ?? process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENROUTER_API_KEY or OPENAI_API_KEY to run real models");

const baseUrl = process.env.RUNLENS_LLM_BASE_URL ?? (openRouterKey ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");
const defaultModels = openRouterKey
  ? "openai/gpt-5.4-nano,anthropic/claude-haiku-5.5,google/gemini-3.1-flash-lite,qwen/qwen3.7-flash"
  : "gpt-4.1-mini,gpt-5.4-nano,gpt-5.4-mini";
const models = (process.env.RUNLENS_LLM_MODELS ?? defaultModels)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const tools = createTools();

export default defineConfig({
  name: "customer-support: real models",
  agents: models.map((model) =>
    llmAgent({ model, apiKey, baseUrl, tools }),
  ),
  // Optional comma-separated filter, e.g. RUNLENS_SCENARIOS=late-return
  scenarios: process.env.RUNLENS_SCENARIOS
    ? scenarios.filter((s) => process.env.RUNLENS_SCENARIOS!.split(",").includes(s.id))
    : scenarios,
  runs: 30,
  concurrency: 6,
  timeoutMs: 90_000,
  retries: 2,
  toolMode: "frozen",
  gate: { minPassRateLowerBound: 0.8 },
});
