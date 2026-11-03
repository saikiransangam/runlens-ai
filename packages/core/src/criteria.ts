import type { Criterion, CriterionVerdict, RunRecord } from "./types.js";

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function criterion(
  description: string,
  check: Criterion["check"],
  id = slug(description),
): Criterion {
  return { id, description, check };
}

/** Passes when the output contains every given phrase (case-insensitive). */
export function mustContain(...phrases: string[]): Criterion {
  return criterion(`Mentions ${phrases.map((p) => `"${p}"`).join(", ")}`, (run) => {
    const out = run.output.toLowerCase();
    const missing = phrases.filter((p) => !out.includes(p.toLowerCase()));
    return { pass: missing.length === 0, reason: missing.length ? `Missing: ${missing.join(", ")}` : undefined };
  });
}

/** Passes when the output contains none of the given phrases (case-insensitive). */
export function mustNotContain(...phrases: string[]): Criterion {
  return criterion(`Never says ${phrases.map((p) => `"${p}"`).join(", ")}`, (run) => {
    const out = run.output.toLowerCase();
    const found = phrases.filter((p) => out.includes(p.toLowerCase()));
    return { pass: found.length === 0, reason: found.length ? `Found: ${found.join(", ")}` : undefined };
  });
}

export function mustMatch(pattern: RegExp, description = `Matches ${pattern}`): Criterion {
  return criterion(description, (run) => pattern.test(run.output));
}

export function mustCallTool(name: string): Criterion {
  return criterion(`Calls ${name}`, (run) => ({
    pass: run.toolCalls.some((c) => c.name === name),
    reason: `Tool path was: ${run.toolPath}`,
  }));
}

export function mustNotCallTool(name: string): Criterion {
  return criterion(`Does not call ${name}`, (run) => ({
    pass: !run.toolCalls.some((c) => c.name === name),
    reason: `Tool path was: ${run.toolPath}`,
  }));
}

/** Passes when the given tools appear in this relative order (other calls may be interleaved). */
export function toolOrder(...names: string[]): Criterion {
  return criterion(`Calls ${names.join(" before ")}`, (run) => {
    let i = 0;
    for (const call of run.toolCalls) if (call.name === names[i]) i++;
    return { pass: i === names.length, reason: `Tool path was: ${run.toolPath}` };
  });
}

export type CompleteFn = (prompt: string) => Promise<string>;

const JUDGE_PROMPT = `You are a strict evaluator of an AI agent's behavior.
Decide whether the agent's final answer satisfies the criterion. Judge only the
criterion; do not reward style. If the transcript does not contain enough
evidence, the criterion is NOT met.

Criterion: {criterion}

User input:
{input}

Tool calls (name, args, result):
{tools}

Agent's final answer:
{output}

Respond with only JSON: {"pass": true|false, "reason": "<one sentence>"}`;

/**
 * An LLM-as-judge criterion. Provider-agnostic: pass any function that sends a
 * prompt to a model and returns its text (see `openAICompatible`).
 */
export function llmJudge(description: string, opts: { complete: CompleteFn; input?: string; id?: string }): Criterion {
  return criterion(
    description,
    async (run: RunRecord): Promise<CriterionVerdict> => {
      const prompt = JUDGE_PROMPT.replace("{criterion}", description)
        .replace("{input}", opts.input ?? (run.metadata?.input as string) ?? "")
        .replace(
          "{tools}",
          run.toolCalls.length
            ? run.toolCalls.map((c) => `- ${c.name}(${JSON.stringify(c.args)}) -> ${JSON.stringify(c.result)}`).join("\n")
            : "(none)",
        )
        .replace("{output}", run.output);
      const text = await opts.complete(prompt);
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return { pass: false, reason: `Judge returned no JSON: ${text.slice(0, 120)}` };
      try {
        const parsed = JSON.parse(match[0]) as { pass?: unknown; reason?: unknown };
        return { pass: parsed.pass === true, reason: typeof parsed.reason === "string" ? parsed.reason : undefined };
      } catch {
        return { pass: false, reason: `Judge returned invalid JSON: ${match[0].slice(0, 120)}` };
      }
    },
    opts.id,
  );
}

/**
 * Minimal client for any OpenAI-compatible chat completions endpoint
 * (OpenAI, OpenRouter, Together, vLLM, Ollama, ...).
 */
export function openAICompatible(opts: {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
}): CompleteFn {
  const baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  return async (prompt) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature ?? 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Judge request failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? "";
  };
}
