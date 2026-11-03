import type { AgentDefinition, ToolHandler } from "@runlens/core";
import { rng, type Order, type POLICY } from "./shop.js";

/**
 * Failure tendencies of a simulated model. Each value is the per-run
 * probability of that mistake. Real LLMs fail in the same ways; simulating
 * them lets the example run in CI without API keys and with known ground truth.
 */
export interface Profile {
  name: string;
  model: string;
  /** Answers from memory instead of calling lookupPolicy (and guesses a 60-day window). */
  skipPolicyLookup: number;
  /** Approves a return that is outside the window. */
  ignoreWindow: number;
  /** Creates the return label before checking the policy. */
  labelBeforePolicy: number;
  /** Treats a damaged item like a normal return (misses the 90-day exception). */
  missDamagedException: number;
  /** Leaves out where the refund goes. */
  omitRefundMethod: number;
  latencyMs: [number, number];
  costPerRunUsd: number;
}

export const profiles: Profile[] = [
  {
    name: "support-bot",
    model: "sim-large",
    skipPolicyLookup: 0.02,
    ignoreWindow: 0.03,
    labelBeforePolicy: 0,
    missDamagedException: 0.03,
    omitRefundMethod: 0,
    latencyMs: [60, 160],
    costPerRunUsd: 0.0042,
  },
  {
    name: "support-bot",
    model: "sim-medium",
    skipPolicyLookup: 0.1,
    ignoreWindow: 0.15,
    labelBeforePolicy: 0.05,
    missDamagedException: 0.2,
    omitRefundMethod: 0.1,
    latencyMs: [40, 110],
    costPerRunUsd: 0.0011,
  },
  {
    name: "support-bot",
    model: "sim-small",
    skipPolicyLookup: 0.2,
    ignoreWindow: 0.1,
    labelBeforePolicy: 0.25,
    missDamagedException: 0.35,
    omitRefundMethod: 0.2,
    latencyMs: [20, 70],
    costPerRunUsd: 0.0003,
  },
];

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });

export function simulatedAgent(p: Profile, tools: Record<string, ToolHandler>): AgentDefinition {
  return {
    name: `${p.name} (${p.model})`,
    model: p.model,
    tools,
    async run(input, ctx) {
      const r = rng(`${p.model}:${input}:${ctx.runIndex}`);
      const orderId = input.match(/A-\d{4}/)?.[0] ?? "";
      await sleep(p.latencyMs[0] + r() * (p.latencyMs[1] - p.latencyMs[0]), ctx.signal);

      const order = await ctx.tools.call<Order>("lookupOrder", { orderId });
      let labelUrl: string | undefined;
      if (r() < p.labelBeforePolicy) {
        labelUrl = (await ctx.tools.call<{ labelUrl: string }>("createReturnLabel", { orderId })).labelUrl;
      }
      const policy =
        r() < p.skipPolicyLookup ? undefined : await ctx.tools.call<typeof POLICY>("lookupPolicy", { topic: "returns" });

      const damagedCase = order.damaged && r() >= p.missDamagedException;
      const window = damagedCase ? (policy?.damagedWindowDays ?? 60) : (policy?.windowDays ?? 60);
      let eligible = order.deliveredDaysAgo <= window;
      if (!eligible && r() < p.ignoreWindow) eligible = true;

      const usage = {
        inputTokens: Math.round(900 + r() * 400),
        outputTokens: Math.round(80 + r() * 120),
        costUsd: p.costPerRunUsd,
      };
      const windowText = damagedCase ? `${window} days for damaged items` : `${window} days`;

      if (!eligible) {
        return {
          output: `I'm sorry, order ${orderId} was delivered ${order.deliveredDaysAgo} days ago, which is outside our return window of ${windowText}, so I can't create a return label for it.`,
          usage,
        };
      }
      if (!labelUrl) {
        labelUrl = (await ctx.tools.call<{ labelUrl: string }>("createReturnLabel", { orderId })).labelUrl;
      }
      const refund = r() < p.omitRefundMethod ? "" : ` Your refund goes to your ${policy?.refundMethod ?? "original payment method"} once the item arrives.`;
      return {
        output: `Good news: your ${order.item} is within our return window of ${windowText}. Here is your return label: ${labelUrl}.${refund}`,
        usage,
      };
    },
  };
}
