"use client";

// Ask Copper: the floating chat panel. Tools on and tools off are two separate
// conversations, each sent with only its own history.
import { ArrowUpIcon, MessageCircleIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AskCopperTurn, type Turn } from "@/components/copper/ask-copper-turn";
import { SetupRequired } from "@/components/setup-required";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { readLive } from "@/lib/ai/live";
import { askCopper, type ChatMessage } from "@/lib/copper/assistant/ask";
import type { Progress } from "@/lib/copper/assistant/progress";

const STARTERS = [
  "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  "Is Copper Notes in Night Sky in stock?",
  "Is Copper Plus cheaper monthly or yearly?",
];

type Chats = { on: Turn[]; off: Turn[] };

export function AskCopper({ aiConfigured }: { aiConfigured: boolean }) {
  const [open, setOpen] = useState(false);
  const [useTools, setUseTools] = useState(true);
  const [chats, setChats] = useState<Chats>({ on: [], off: [] });
  const [draft, setDraft] = useState("");
  const nextId = useRef(0);
  const body = useRef<HTMLDivElement>(null);

  const mode = useTools ? "on" : "off";
  const turns = chats[mode];
  const busy = turns.some((t) => t.progress.status === "working");

  // The header's Ask Copper link opens the panel, as does loading the site at
  // /#ask. Listening for the click too means the link works again when the
  // address already ends in #ask (no hashchange fires then).
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.('a[href$="#ask"]');
      if (link) setOpen(true);
    };
    const onHash = () => {
      if (window.location.hash === "#ask") setOpen(true);
    };
    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  // Keep the newest step in view.
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [turns, open]);

  const patch = (which: keyof Chats, id: number, progress: Progress) =>
    setChats((prev) => ({
      ...prev,
      [which]: prev[which].map((t) => (t.id === id ? { ...t, progress } : t)),
    }));

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const which = mode;
    const id = nextId.current++;
    const messages: ChatMessage[] = [
      ...turns
        .filter((t) => t.progress.status === "done")
        .flatMap((t): ChatMessage[] => [
          { role: "user", content: t.question },
          { role: "assistant", content: t.progress.reply },
        ]),
      { role: "user", content: question },
    ];
    setDraft("");
    setChats((prev) => ({
      ...prev,
      [which]: [
        ...prev[which],
        { id, question, progress: { steps: [], reply: "", status: "working" } },
      ],
    }));
    try {
      const { progress } = await askCopper({ messages, useTools });
      for await (const update of readLive(progress)) patch(which, id, update);
    } catch {
      patch(which, id, {
        steps: [],
        reply: "Sorry, I couldn't answer that just now. Please try again.",
        status: "error",
      });
    }
  }

  return (
    <>
      <Button
        data-testid="ask-copper-launcher"
        onClick={() => setOpen(true)}
        size="lg"
        className="fixed right-4 bottom-4 z-40 rounded-full shadow-lg"
      >
        <MessageCircleIcon />
        Ask Copper
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          data-testid="ask-copper"
          showCloseButton={false}
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          <header className="bg-chart-5 text-background">
            <div className="flex items-center gap-3 p-4">
              <span className="bg-primary flex size-10 shrink-0 items-center justify-center rounded-full">
                <Image
                  src="/assets/brand/copper-mascot.png"
                  alt="Copper the mascot"
                  width={32}
                  height={32}
                  className="size-8 object-contain"
                />
              </span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-background">Ask Copper</SheetTitle>
                <SheetDescription className="text-background/80">
                  Prices, totals and stock, checked with tools.
                </SheetDescription>
              </div>
              <SheetClose asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-background hover:bg-background/10 hover:text-background"
                >
                  <XIcon />
                  <span className="sr-only">Close</span>
                </Button>
              </SheetClose>
            </div>
            {aiConfigured ? (
              <div className="flex items-center gap-3 bg-background/10 px-4 py-2">
                <span className="text-sm font-medium">Use tools</span>
                <span className="text-xs text-background/70">
                  {useTools ? "Checks every answer" : "Model guesses alone"}
                </span>
                <Switch
                  aria-label="Use tools"
                  checked={useTools}
                  onCheckedChange={setUseTools}
                  className="ml-auto"
                />
              </div>
            ) : null}
          </header>

          {aiConfigured ? (
            <>
              <div
                ref={body}
                className="bg-secondary flex-1 space-y-5 overflow-y-auto p-4"
              >
                {turns.map((turn) => (
                  <AskCopperTurn
                    key={turn.id}
                    turn={turn}
                    useTools={useTools}
                  />
                ))}
                {!busy ? (
                  <div className="flex flex-col items-start gap-2">
                    {STARTERS.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => send(starter)}
                        className="bg-card hover:border-primary rounded-xl border px-3 py-2 text-left text-sm"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(draft);
                }}
                className="bg-background flex items-center gap-2 border-t p-3"
              >
                <Input
                  aria-label="Your question"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ask about prices or stock…"
                  className="rounded-full"
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send"
                  disabled={busy}
                  className="rounded-full"
                >
                  <ArrowUpIcon />
                </Button>
              </form>
            </>
          ) : (
            <div className="bg-secondary flex-1 overflow-y-auto p-4">
              <SetupRequired service="ai" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
