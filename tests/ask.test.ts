// @vitest-environment node
import type { LanguageModelV4StreamPart as ModelStreamPart } from "@ai-sdk/provider";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLive } from "@/lib/ai/live";
import { askCopper } from "@/lib/copper/assistant/ask";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type { Progress } from "@/lib/copper/assistant/progress";

let model: MockLanguageModelV4;
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => () => model,
}));

type Part = Parameters<typeof convertArrayToReadableStream<ModelStreamPart>>[0][number];

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const finish = (reason: "stop" | "tool-calls"): Part => ({
  type: "finish",
  finishReason: { unified: reason, raw: undefined },
  usage,
});

const says = (text: string, thinking?: string): Part[] => [
  ...(thinking
    ? ([
        { type: "reasoning-start", id: "r1" },
        { type: "reasoning-delta", id: "r1", delta: thinking },
        { type: "reasoning-end", id: "r1" },
      ] as Part[])
    : []),
  { type: "text-start", id: "t1" },
  ...text.split(" ").map(
    (word, i): Part => ({ type: "text-delta", id: "t1", delta: i === 0 ? word : ` ${word}` }),
  ),
  { type: "text-end", id: "t1" },
  finish("stop"),
];

const calls = (toolName: string, input: unknown): Part[] => [
  { type: "tool-input-start", id: "call-1", toolName },
  { type: "tool-input-end", id: "call-1" },
  { type: "tool-call", toolCallId: "call-1", toolName, input: JSON.stringify(input) },
  finish("tool-calls"),
];

function modelStreaming(...steps: Part[][]) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream(steps[step++] ?? says("")),
    }),
  });
}

async function updatesOf(request: Parameters<typeof askCopper>[0]) {
  const { progress } = await askCopper(request);
  const updates: Progress[] = [];
  for await (const update of readLive(progress)) updates.push(update);
  return updates;
}

const ask = { messages: [{ role: "user", content: "How much?" }] as const };

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("askCopper", () => {
  it("runs a tool, then replies, adding the tool step before its input is known", async () => {
    model = modelStreaming(
      calls("calculate_cost", {
        products: ["copper-home"],
        plan: "copper-plus",
        billing: "annual",
        years: 2,
      }),
      says("That is $307", "Working it out"),
    );
    const updates = await updatesOf({ ...ask, messages: [...ask.messages], useTools: true });

    const first = updates.find((u) => u.steps.some((s) => s.type === "tool"))!;
    expect(first.steps[0]).toMatchObject({ name: "calculate_cost", state: "calling" });
    expect(first.steps[0]).not.toHaveProperty("input");

    const last = updates.at(-1)!;
    expect(last.status).toBe("done");
    expect(last.reply).toBe("That is $307");
    expect(last.steps.filter((s) => s.type === "tool")).toHaveLength(1);
    expect(last.steps).toContainEqual(expect.objectContaining({ type: "thinking" }));
    expect(last.steps.find((s) => s.type === "tool")).toMatchObject({
      state: "done",
      output: { totalUsd: 307 },
    });
  });

  it("sends each update as a fresh copy, with a reply that only grows", async () => {
    model = modelStreaming(says("one two three", "Thinking"));
    const updates = await updatesOf({ ...ask, messages: [...ask.messages], useTools: false });
    const thinking = updates.filter((u) => u.steps.length).map((u) => u.steps[0]);
    expect(new Set(thinking).size).toBe(thinking.length);
    updates.reduce((prev, u) => {
      expect(u.reply.startsWith(prev)).toBe(true);
      return u.reply;
    }, "");
    expect(updates.at(-1)!.reply).toBe("one two three");
  });

  it("gives the model the instructions and all four tools only when tools are on", async () => {
    model = modelStreaming(says("hi"));
    await updatesOf({ ...ask, messages: [...ask.messages], useTools: true });
    const on = model.doStreamCalls[0];
    expect(on.tools?.map((t) => t.name).sort()).toEqual([
      "calculate_cost",
      "check_availability",
      "get_prices",
      "get_products",
    ]);
    expect(JSON.stringify(on.prompt)).toContain(COPPER_INSTRUCTIONS.trim().slice(0, 30));

    model = modelStreaming(says("hi"));
    await updatesOf({ ...ask, messages: [...ask.messages], useTools: false });
    const off = model.doStreamCalls[0];
    expect(off.tools ?? []).toHaveLength(0);
    expect(off.prompt.some((m) => m.role === "system")).toBe(false);
  });

  it("logs the question as module 2, ask-copper", async () => {
    const info = vi.mocked(console.info);
    model = modelStreaming(says("hi"));
    await updatesOf({ ...ask, messages: [...ask.messages], useTools: false });
    const row = JSON.parse(
      info.mock.calls.find((c) => c[0] === "[ai_calls]")![1] as string,
    );
    expect(row).toMatchObject({ module: 2, feature: "ask-copper", ok: true });
  });

  it("apologizes, still done, when the reply is empty", async () => {
    model = modelStreaming(says(""));
    const last = (await updatesOf({ ...ask, messages: [...ask.messages], useTools: false })).at(-1)!;
    expect(last.status).toBe("done");
    expect(last.reply).not.toBe("");
  });

  it("ends in error with an apology when the model throws", async () => {
    model = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("boom");
      },
    });
    const last = (await updatesOf({ ...ask, messages: [...ask.messages], useTools: false })).at(-1)!;
    expect(last.status).toBe("error");
    expect(last.reply).not.toBe("");
  });
});
