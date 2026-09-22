import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { api, DEMO_INTENT, SAMPLE_DDL } from "@/lib/api";

const EXAMPLES = [
  { label: "Review a SQL table", intent: DEMO_INTENT, body: SAMPLE_DDL },
  { label: "Plan a weekend trip", intent: "Plan a 2-day weekend in Portland for two people who like coffee and hiking.", body: "" },
  { label: "Name a side project", intent: "Help pick a name and one-sentence pitch for a tool that watches two AIs talk until they agree.", body: "" },
];

export function HomePage({ onOpened }: { onOpened: (roomId: string) => void }) {
  const [intent, setIntent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(problem: string, body = "") {
    if (!problem.trim()) {
      setError("Type something for them to talk about.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const started = await api.startMeeting({
        intent: problem.trim(),
        body,
        tags: body ? ["sql", "postgres"] : [],
      });
      if (started.room?.id) onOpened(started.room.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the chat");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-4 text-center">
      <div className="mb-8 flex items-center gap-3">
        <Face name="NeedHelp" tone="gold" />
        <Face name="HasSkill" tone="teal" />
      </div>
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Let the bots talk it out.</h1>
      <p className="mt-3 max-w-md text-sm text-muted">
        You pick the topic. Planner and Specialist go back and forth like two Grok bots until they
        agree. You can jump in anytime.
      </p>

      <form
        className="mt-8 w-full rounded-3xl border border-rule bg-ink-2 p-3 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
        onSubmit={(e) => {
          e.preventDefault();
          void start(intent);
        }}
      >
        <Textarea
          className="min-h-24 border-0 bg-transparent px-3 py-2 text-base focus:border-transparent"
          placeholder="What should they figure out?"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void start(intent);
            }
          }}
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-1">
          <p className="text-xs text-muted">Enter to start · Shift+Enter for a new line</p>
          <Button type="submit" disabled={busy}>
            {busy ? "Waking them up…" : "Let them talk"}
          </Button>
        </div>
      </form>
      {error && <p className="mt-3 text-sm text-coral">{error}</p>}

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            disabled={busy}
            onClick={() => void start(ex.intent, ex.body)}
            className="rounded-full border border-rule px-3 py-1.5 text-xs text-paper-2 hover:border-teal/50 hover:text-paper"
          >
            {ex.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Face({ name, tone }: { name: string; tone: "gold" | "teal" }) {
  return (
    <div
      className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold ${
        tone === "gold" ? "bg-gold/20 text-gold" : "bg-teal/20 text-teal"
      }`}
      title={name}
    >
      {name.slice(0, 1)}
    </div>
  );
}
