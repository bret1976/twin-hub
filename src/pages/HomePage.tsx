import { useState } from "react";
import { MicButton } from "@/components/MicButton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { api, DEMO_INTENT, SAMPLE_DDL } from "@/lib/api";

const EXAMPLES = [
  { label: "Review a SQL table", intent: DEMO_INTENT, body: SAMPLE_DDL },
  { label: "Plan a weekend trip", intent: "Plan a 2-day weekend in Portland for two people who like coffee and hiking.", body: "" },
  { label: "Name a side project", intent: "Help pick a name and one-sentence pitch for a tool that watches two AIs talk until they agree.", body: "" },
];

export function HomePage({
  onOpened,
  onFindTwin,
}: {
  onOpened: (roomId: string) => void;
  onFindTwin: () => void;
}) {
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
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-2xl flex-col items-center justify-center px-3 py-6 text-center sm:min-h-[calc(100dvh-5rem)] sm:px-4">
      <div className="mb-8 flex items-center gap-3">
        <Face name="NeedHelp" tone="gold" />
        <Face name="HasSkill" tone="teal" />
      </div>
      <h1 className="max-w-xl text-2xl font-medium tracking-tight sm:text-4xl">
        Two twins walk into a room. They leave a decision.
      </h1>
      <p className="mt-3 max-w-md text-sm text-muted">
        You pick the topic, or tap the mic and ask out loud. Planner and Specialist go back and forth
        until they agree. You can jump in anytime — type or speak.
      </p>

      <button
        type="button"
        onClick={onFindTwin}
        className="mt-6 rounded-full border border-teal/70 px-6 py-2.5 text-sm text-teal hover:bg-teal/10"
      >
        Find a twin
      </button>

      <form
        className="mt-8 w-full rounded-3xl border border-rule bg-ink-2 p-3 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
        onSubmit={(e) => {
          e.preventDefault();
          void start(intent);
        }}
      >
        <Textarea
          className="min-h-24 border-0 bg-transparent px-3 py-2 text-base focus:border-transparent"
          placeholder="What should they figure out? Type it, or tap the mic and speak."
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void start(intent);
            }
          }}
        />
        <div className="flex flex-col gap-2 px-1 pb-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <MicButton disabled={busy} value={intent} onChange={setIntent} onFinal={(text) => void start(text)} />
            <p className="text-xs text-muted">Tap the mic, or type</p>
          </div>
          <Button type="submit" disabled={busy} className="w-full sm:w-auto">
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
