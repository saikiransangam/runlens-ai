import {
  criterion,
  mustCallTool,
  mustContain,
  mustNotCallTool,
  toolOrder,
  type Scenario,
  type ToolHandler,
} from "@runlens/core";

/** A tiny fake store backend shared by every agent in this example. */
export interface Order {
  orderId: string;
  item: string;
  deliveredDaysAgo: number;
  damaged: boolean;
}

export const ORDERS: Record<string, Order> = {
  "A-1001": { orderId: "A-1001", item: "Wireless headphones", deliveredDaysAgo: 40, damaged: false },
  "A-1002": { orderId: "A-1002", item: "Running shoes", deliveredDaysAgo: 10, damaged: false },
  "A-1003": { orderId: "A-1003", item: "Ceramic vase", deliveredDaysAgo: 45, damaged: true },
};

export const POLICY = { windowDays: 30, damagedWindowDays: 90, refundMethod: "original payment method" };

/** Deterministic PRNG so simulated agents produce reproducible reports. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tool implementations. With `flakyRate > 0` the order service sometimes
 * returns stale delivery data, which is the kind of environment failure
 * RunLens attributes separately from model failures in live tool mode.
 */
export function createTools(opts: { flakyRate?: number; seed?: string } = {}): Record<string, ToolHandler> {
  const random = rng(opts.seed ?? "env");
  return {
    lookupOrder: ({ orderId }: { orderId: string }) => {
      const order = ORDERS[orderId];
      if (!order) throw new Error(`Order ${orderId} not found`);
      if (opts.flakyRate && random() < opts.flakyRate) return { ...order, deliveredDaysAgo: 3 };
      return order;
    },
    lookupPolicy: ({ topic }: { topic: string }) => {
      if (topic !== "returns") throw new Error(`No policy for ${topic}`);
      return POLICY;
    },
    createReturnLabel: ({ orderId }: { orderId: string }) => ({ orderId, labelUrl: `https://shop.example/labels/${orderId}.pdf` }),
  };
}

export const scenarios: Scenario[] = [
  {
    id: "late-return",
    description: "Customer asks to return an undamaged item 40 days after delivery.",
    input: "Hi, my order A-1001 arrived 40 days ago. Can I still return it?",
    tags: ["returns", "policy-boundary"],
    criteria: [
      mustCallTool("lookupPolicy"),
      mustContain("30 days"),
      mustNotCallTool("createReturnLabel"),
      criterion("Does not promise a refund", (run) => !/\b(refund (is|will be) (issued|processed)|you('| a)re eligible)\b/i.test(run.output)),
    ],
  },
  {
    id: "in-window-return",
    description: "Customer asks to return an item 10 days after delivery.",
    input: "Order A-1002 came 10 days ago and the shoes don't fit. How do I send them back?",
    tags: ["returns", "happy-path"],
    criteria: [
      toolOrder("lookupOrder", "lookupPolicy", "createReturnLabel"),
      mustContain("label"),
      mustContain("original payment method"),
    ],
  },
  {
    id: "damaged-item",
    description: "Damaged item reported 45 days after delivery; the damaged-goods window (90 days) applies.",
    input: "My vase from order A-1003 arrived cracked. I only unpacked it now, 45 days later. What can I do?",
    tags: ["returns", "exception"],
    criteria: [
      mustCallTool("lookupPolicy"),
      mustCallTool("createReturnLabel"),
      mustContain("90 days"),
    ],
  },
];
