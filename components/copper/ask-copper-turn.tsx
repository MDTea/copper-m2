// One question and its answer in the Ask Copper panel, drawn as a line of
// stations on a rail: the tools Copper can use, what it was thinking, the
// tool it called (what it sent, what came back), and then the reply.
import {
  BrainIcon,
  TriangleAlertIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import {
  formatUsd,
  getPlans,
  getProducts,
  type Plan,
} from "@/lib/copper/catalog";
import {
  TOOL_LABELS,
  type Progress,
  type ToolStep,
} from "@/lib/copper/assistant/progress";
import type {
  Availability,
  CostBreakdown,
  Prices,
  ProductList,
} from "@/lib/copper/assistant/tools";
import { cn } from "@/lib/utils";

export type Turn = { id: number; question: string; progress: Progress };

const LABEL = "text-xs font-semibold tracking-wider uppercase";

/** Renders the **bold** and `code` marks of a thought summary. */
function Markdown({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return (
        <code key={i} className="font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    return part;
  });
}

function Station({
  icon: Icon,
  nodeClass,
  label,
  children,
}: {
  icon?: LucideIcon;
  nodeClass: string;
  label?: string;
  children?: ReactNode;
}) {
  return (
    <div className="relative pl-9">
      <span
        className={cn(
          "ring-secondary absolute top-0 left-0 flex size-6 items-center justify-center rounded-full text-white ring-4",
          nodeClass,
        )}
      >
        {Icon ? <Icon className="size-3.5" /> : null}
      </span>
      {label ? (
        <p className={cn(LABEL, "text-muted-foreground pt-1")}>{label}</p>
      ) : null}
      {children}
    </div>
  );
}

function dots() {
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="bg-primary size-1 animate-bounce rounded-full"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

const productName = (id: string) =>
  getProducts().find((p) => p.id === id)?.name ?? id;
const planName = (id: Plan["id"]) =>
  getPlans().find((p) => p.id === id)?.name ?? id;

function sentRows(step: ToolStep): [string, string][] | string {
  const input = (step.input ?? {}) as Record<string, unknown>;
  if (step.name === "get_prices")
    return "Nothing, it just asked for the price list";
  if (step.name === "get_products")
    return "Nothing, it just asked what Copper sells";
  if (step.name === "calculate_cost") {
    const products = (input.products as string[] | undefined) ?? [];
    return [
      [
        "Products",
        products.length ? products.map(productName).join(", ") : "None",
      ],
      ["Plan", planName(input.plan as Plan["id"])],
      ["Billing", String(input.billing ?? "")],
      ["Years", String(input.years ?? "")],
    ];
  }
  return [
    ["Product", productName(String(input.product ?? ""))],
    ["Color", input.color ? String(input.color) : "Every color"],
  ];
}

const date = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function Pill({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium text-black",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Came({ step }: { step: ToolStep }) {
  if (step.state === "error")
    return <p className="text-sm">{String(step.output)}</p>;

  if (step.name === "calculate_cost") {
    const cost = step.output as CostBreakdown;
    return (
      <div className="space-y-1 text-sm">
        {cost.lines.map((line, i) => (
          <div key={i} className="flex justify-between gap-3">
            <span>{line.item}</span>
            <span>{formatUsd(line.usd)}</span>
          </div>
        ))}
        <div className="border-primary/40 flex items-baseline justify-between border-t pt-1">
          <span className="font-medium">Total</span>
          <span className="text-primary text-xl font-bold">
            {formatUsd(cost.totalUsd)}
          </span>
        </div>
      </div>
    );
  }

  if (step.name === "get_products") {
    const { products } = step.output as ProductList;
    return (
      <div className="space-y-2 text-sm">
        {products.map((p) => (
          <div key={p.id}>
            <div className="flex justify-between gap-3 font-medium">
              <span>{p.name}</span>
              <span>{formatUsd(p.priceUsd)}</span>
            </div>
            <p className="text-muted-foreground text-xs">{p.type}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {p.colors.map((c) => (
                <Pill key={c} className="bg-accent/30 text-foreground">
                  {c}
                </Pill>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (step.name === "get_prices") {
    const prices = step.output as Prices;
    return (
      <div className="space-y-1 text-sm">
        {prices.products.map((p) => (
          <div key={p.id} className="flex justify-between gap-3">
            <span>{p.name}</span>
            <span>{formatUsd(p.priceUsd)}</span>
          </div>
        ))}
        {prices.plans
          .filter((p) => p.monthlyUsd > 0)
          .map((p) => (
            <div key={p.id} className="flex justify-between gap-3">
              <span>{p.name}</span>
              <span>
                {formatUsd(p.monthlyUsd)}/mo · {formatUsd(p.annualUsd)}/yr
              </span>
            </div>
          ))}
      </div>
    );
  }

  const stock = step.output as Availability;
  if (stock.status === "unavailable")
    return <p className="text-sm">{stock.message}</p>;
  if (stock.status === "not_a_color")
    return (
      <p className="text-sm">
        {stock.product} doesn&rsquo;t come in {stock.color}. Its colors are{" "}
        {stock.colors.join(", ")}.
      </p>
    );
  return (
    <div className="space-y-1 text-sm">
      {stock.colors.map((c) => (
        <div key={c.color} className="flex items-center justify-between gap-3">
          <span>{c.color}</span>
          {c.stock === "in_stock" ? (
            <Pill className="bg-accent">In stock</Pill>
          ) : c.stock === "low_stock" ? (
            <Pill className="bg-chart-4">Low stock</Pill>
          ) : (
            <Pill className="bg-chart-3">
              Back-ordered until {date(c.restockDate ?? "")}
            </Pill>
          )}
        </div>
      ))}
    </div>
  );
}

function ToolCard({ step, number }: { step: ToolStep; number: number }) {
  const running = step.state === "calling";
  const sent = step.input === undefined ? null : sentRows(step);
  return (
    <div
      data-testid="tool-call"
      data-tool={step.name}
      className="bg-card mt-1.5 overflow-hidden rounded-lg border text-sm"
    >
      <div className="bg-accent text-accent-foreground flex items-center gap-2 px-3 py-1.5">
        <span className="font-mono font-bold">{step.name}()</span>
        <span className="rounded bg-white/30 px-1.5 text-xs">
          tool {number}
        </span>
        <span className="ml-auto text-xs">{TOOL_LABELS[step.name]}</span>
      </div>
      <div className="p-3">
        <p className={cn(LABEL, "text-muted-foreground mb-1")}>
          → What Copper sent
        </p>
        {sent === null ? (
          <p className="text-muted-foreground text-sm italic">
            filling in the details…
          </p>
        ) : typeof sent === "string" ? (
          <p className="text-sm">{sent}</p>
        ) : (
          <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5">
            {sent.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-muted-foreground">{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="bg-accent/10 border-t p-3">
        <p className={cn(LABEL, "text-muted-foreground mb-1")}>
          ← What came back
        </p>
        {running || step.output === undefined ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner className="size-3.5" />
            the app is running the code…
          </p>
        ) : (
          <Came step={step} />
        )}
      </div>
    </div>
  );
}

function statusText(progress: Progress, useTools: boolean) {
  if (progress.reply) return "Writing the answer…";
  if (!useTools) return "Answering from memory…";
  if (progress.steps.length) return "Deciding what to do next…";
  return "Reading your question…";
}

export function AskCopperTurn({
  turn,
  useTools,
}: {
  turn: Turn;
  useTools: boolean;
}) {
  const { progress } = turn;
  const working = progress.status === "working";
  const used = new Set(
    progress.steps.flatMap((s) => (s.type === "tool" ? [s.name] : [])),
  );
  const nodeTone = useTools
    ? "bg-primary text-primary-foreground"
    : "bg-chart-3";

  return (
    <div className="space-y-3">
      <div className="bg-primary text-primary-foreground ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm">
        {turn.question}
      </div>

      <div className="relative space-y-4">
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-3 bottom-3 left-[11px] w-0.5",
            useTools
              ? "from-primary via-accent to-accent bg-linear-to-b"
              : "bg-chart-3",
          )}
        />

        <Station
          nodeClass={nodeTone}
          label={
            useTools ? "Tools Copper can use" : "Tools given to Copper: none"
          }
        >
          <div className="mt-1 flex flex-wrap gap-1.5">
            {Object.keys(TOOL_LABELS).map((name) => (
              <span
                key={name}
                className={cn(
                  "rounded-full px-2 py-0.5 font-mono text-xs",
                  !useTools
                    ? "text-muted-foreground bg-muted line-through"
                    : used.has(name)
                      ? "bg-accent font-bold"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {name}
              </span>
            ))}
          </div>
          {!useTools ? (
            <p className="text-muted-foreground mt-1 text-xs">
              Copper has to answer from memory alone.
            </p>
          ) : null}
        </Station>

        {progress.steps.map((step, i) =>
          step.type === "thinking" ? (
            <Station
              key={i}
              icon={BrainIcon}
              nodeClass={
                useTools ? "bg-primary text-primary-foreground" : "bg-chart-3"
              }
              label="Copper is thinking"
            >
              <p
                data-testid="thinking"
                className="text-muted-foreground mt-1 border-l-2 pl-3 text-sm italic"
              >
                <Markdown text={step.text} />
              </p>
            </Station>
          ) : (
            <Station
              key={step.id}
              icon={WrenchIcon}
              nodeClass="bg-accent text-accent-foreground"
              label={
                step.state === "calling"
                  ? "Copper is calling a tool"
                  : "Copper called a tool"
              }
            >
              <ToolCard
                step={step}
                number={
                  progress.steps.slice(0, i).filter((s) => s.type === "tool")
                    .length + 1
                }
              />
            </Station>
          ),
        )}

        {working ? (
          <Station nodeClass="bg-card text-foreground border">
            <p className="text-muted-foreground flex items-center gap-2 pt-0.5 text-sm">
              {dots()}
              {statusText(progress, useTools)}
            </p>
          </Station>
        ) : null}
      </div>

      {progress.reply ? (
        <div className="bg-card max-w-[90%] rounded-2xl rounded-tl-sm border p-3 text-sm shadow-sm">
          <p className="text-primary mb-1 text-xs font-semibold">Copper</p>
          {!useTools ? (
            <div className="border-chart-3 bg-chart-3/10 mb-2 rounded-md border p-2 text-xs">
              <p className="flex items-center gap-1 font-semibold">
                <TriangleAlertIcon className="size-3.5" />
                Answered without tools: may be made up
              </p>
              <p className="mt-0.5">
                With tools off, Copper can&rsquo;t see today&rsquo;s prices or
                stock. The AI only has what it learned in training, so it fills
                the gaps with guesses that sound right. That&rsquo;s a
                hallucination.
              </p>
            </div>
          ) : null}
          <p className="whitespace-pre-wrap">
            {progress.reply}
            {working ? (
              <span className="bg-primary ml-0.5 inline-block h-4 w-0.5 animate-pulse align-middle" />
            ) : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}
