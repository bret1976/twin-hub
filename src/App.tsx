import { useEffect, useState } from "react";
import { DiscoverPage } from "@/pages/DiscoverPage";
import { MeetingsPage } from "@/pages/MeetingsPage";
import { RegistryPage } from "@/pages/RegistryPage";
import { RoomPage } from "@/pages/RoomPage";

type Route = "registry" | "discover" | "meetings" | "room";

function parseHash(): { route: Route; roomId: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (raw.startsWith("rooms/")) return { route: "room", roomId: raw.slice("rooms/".length) };
  if (raw === "discover") return { route: "discover", roomId: null };
  if (raw === "meetings") return { route: "meetings", roomId: null };
  return { route: "registry", roomId: null };
}

export default function App() {
  const [{ route, roomId }, setLoc] = useState(parseHash);

  useEffect(() => {
    const onHash = () => setLoc(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function go(next: Route, id?: string) {
    if (next === "room" && id) {
      window.location.hash = `#/rooms/${id}`;
      return;
    }
    window.location.hash = `#/${next}`;
  }

  return (
    <div className="min-h-screen bg-ink">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-serif text-xl tracking-tight">TwinMeet</p>
            <p className="text-xs text-muted">MCP=tools, A2A=peers, TwinMeet=rooms+registry</p>
          </div>
          <nav className="flex flex-wrap gap-1">
            {(
              [
                ["registry", "Registry"],
                ["discover", "Discover"],
                ["meetings", "Meetings"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => go(key)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  route === key ? "bg-ink-2 text-gold" : "text-muted hover:text-paper"
                }`}
              >
                {label}
              </button>
            ))}
            {roomId && (
              <button onClick={() => go("room", roomId)} className="rounded-md px-3 py-1.5 text-sm text-teal">
                Live room
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {route === "registry" && <RegistryPage />}
        {route === "discover" && <DiscoverPage onOpened={(id) => go("room", id)} />}
        {route === "meetings" && <MeetingsPage onOpened={(id) => go("room", id)} />}
        {route === "room" && roomId && <RoomPage roomId={roomId} />}
      </main>
    </div>
  );
}
