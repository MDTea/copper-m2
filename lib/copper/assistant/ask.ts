"use server";

// Module 2: the server action the Ask Copper chat calls. It streams the
// conversation to the model through callStream (lib/ai/call.ts), with or
// without the tools, and sends back each step as it happens, so the panel can
// show Copper thinking and using its tools. The contract is in
// specs/module-2/spec.md.
import { stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type { Progress, Step } from "@/lib/copper/assistant/progress";
import { copperTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per question. */
const MAX_STEPS = 5;

const APOLOGY = "Sorry, I couldn't answer that just now. Please try again.";

export async function askCopper(
  request: AskCopperRequest,
): Promise<AskCopperResult> {
  const { live, update, done } = createLive<Progress>();

  const steps: Step[] = [];
  let reply = "";

  // A fresh copy each time, so earlier updates never change underneath the panel.
  const snapshot = (status: Progress["status"]): Progress => ({
    steps: steps.map((step) => ({ ...step })),
    reply,
    status,
  });
  const toolStep = (id: string) =>
    steps.find((step) => step.type === "tool" && step.id === id);

  // Read the stream in the background, so the panel gets `progress` right away.
  void (async () => {
    try {
      const messages = request.messages.map(({ role, content }) => ({
        role,
        content,
      }));
      // With tools off the model gets only the conversation: no instructions
      // (they'd tell it to use tools it doesn't have) and no tools.
      const result = callStream(
        { module: 2, feature: "ask-copper" },
        request.useTools
          ? {
              instructions: COPPER_INSTRUCTIONS,
              messages,
              tools: copperTools,
              stopWhen: stepCountIs(MAX_STEPS),
              providerOptions: THOUGHT_SUMMARIES,
            }
          : { messages, providerOptions: THOUGHT_SUMMARIES },
      );

      let failed = false;
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "reasoning-delta": {
            const last = steps.at(-1);
            if (last?.type === "thinking") last.text += part.text;
            else steps.push({ type: "thinking", text: part.text });
            break;
          }
          case "tool-input-start":
            // Added as soon as the name is known, before the input is.
            steps.push({
              type: "tool",
              id: part.id,
              name: part.toolName,
              state: "calling",
            });
            break;
          case "tool-call": {
            const step = toolStep(part.toolCallId);
            if (step?.type === "tool") step.input = part.input;
            else
              steps.push({
                type: "tool",
                id: part.toolCallId,
                name: part.toolName,
                state: "calling",
                input: part.input,
              });
            break;
          }
          case "tool-result": {
            const step = toolStep(part.toolCallId);
            if (step?.type === "tool") {
              step.output = part.output;
              step.state = "done";
            }
            break;
          }
          case "tool-error": {
            const step = toolStep(part.toolCallId);
            if (step?.type === "tool") {
              step.output =
                part.error instanceof Error
                  ? part.error.message
                  : String(part.error);
              step.state = "error";
            }
            break;
          }
          case "text-delta":
            reply += part.text;
            break;
          case "error":
            failed = true;
            break;
          default:
            continue;
        }
        update(snapshot("working"));
      }

      // Only an empty reply is replaced, never a real one.
      if (!reply.trim()) reply = APOLOGY;
      done(snapshot(failed ? "error" : "done"));
    } catch {
      if (!reply.trim()) reply = APOLOGY;
      done(snapshot("error"));
    }
  })();

  return { progress: live };
}
