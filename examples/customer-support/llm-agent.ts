import type { AgentDefinition, ToolHandler } from "@runlens/core";

/**
 * A real LLM support agent using any OpenAI-compatible chat completions API
 * with tool calling (OpenAI, OpenRouter, Together, vLLM, Ollama, ...).
 * Tool calls go through `ctx.tools` so RunLens records and (in frozen mode)
 * replays them.
 */
export function llmAgent(opts: {
  model: string;
  apiKey: string;
  baseUrl: string;
  tools: Record<string, ToolHandler>;
  temperature?: number;
}): AgentDefinition {
  const toolSpecs = [
    {
      type: "function",
      function: {
        name: "lookupOrder",
        description: "Look up an order by id. Returns item, deliveredDaysAgo and whether it was damaged.",
        parameters: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
      },
    },
    {
      type: "function",
      function: {
        name: "lookupPolicy",
        description: "Look up the store policy for a topic. Use topic 'returns' for the return policy.",
        parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
      },
    },
    {
      type: "function",
      function: {
        name: "createReturnLabel",
        description: "Create a prepaid return label for an order. Only call this if the return is allowed by policy.",
        parameters: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
      },
    },
  ];

  type Message = { role: string; content: string | null; tool_calls?: ToolCallMsg[]; tool_call_id?: string };
  type ToolCallMsg = { id: string; type: "function"; function: { name: string; arguments: string } };

  return {
    name: `support-bot (${opts.model})`,
    model: opts.model,
    tools: opts.tools,
    async run(input, ctx) {
      const messages: Message[] = [
        {
          role: "system",
          content:
            "You are a customer support agent for an online shop. Always check the order and the return policy with tools before answering. State the exact return window in days. Be concise.",
        },
        { role: "user", content: input },
      ];
      let inputTokens = 0;
      let outputTokens = 0;

      for (let step = 0; step < 6; step++) {
        const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          signal: ctx.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({
            model: opts.model,
            temperature: opts.temperature ?? 1,
            messages,
            tools: toolSpecs,
          }),
        });
        if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as {
          choices: { message: Message }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        inputTokens += body.usage?.prompt_tokens ?? 0;
        outputTokens += body.usage?.completion_tokens ?? 0;
        const msg = body.choices[0]!.message;
        messages.push(msg);
        if (!msg.tool_calls?.length) {
          return { output: msg.content ?? "", usage: { inputTokens, outputTokens } };
        }
        for (const call of msg.tool_calls) {
          let content: string;
          try {
            content = JSON.stringify(await ctx.tools.call(call.function.name, JSON.parse(call.function.arguments || "{}")));
          } catch (e) {
            content = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
          }
          messages.push({ role: "tool", tool_call_id: call.id, content });
        }
      }
      throw new Error("Agent did not finish within 6 steps");
    },
  };
}
