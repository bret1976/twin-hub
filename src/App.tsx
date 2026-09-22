import { useCallback, useEffect, useState } from "react";
import { AccountPage } from "@/pages/AccountPage";
import { BillingPage } from "@/pages/BillingPage";
import { DiscoverPage } from "@/pages/DiscoverPage";
import { FederationPage } from "@/pages/FederationPage";
import { MeetingsPage } from "@/pages/MeetingsPage";
import { MemoryPage } from "@/pages/MemoryPage";
import { RegistryPage } from "@/pages/RegistryPage";
import { RoomPage } from "@/pages/RoomPage";
import { api, type Health } from "@/lib/api";
import { clearStoredSession, getStoredSessionId, type SessionOrg, type SessionUser } from "@/lib/session";

type Route = "registry" | "discover" | "meetings" | "room" | "account" | "billing" | "memory" | "federation";

function parseHash(): { route: Route; roomId: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (raw.startsWith("rooms/")) return { route: "room", roomId: raw.slice("rooms/".length) };
  if (raw === "discover") return { route: "discover", roomId: null };
  if (raw === "meetings") return { route: "meetings", roomId: null };
  if (raw === "account") return { route: "account", roomId: null };
  if (raw === "billing") return { route: "billing", roomId: null };
  if (raw === "memory") return { route: "memory", roomId: null };
  if (raw === "federation") return { route: "federation", roomId: null };
  return { route: "registry", roomId: null };
}

export default function App() {
  const [{ route, roomId }, setLoc] = useState(parseHash);
  const [health, setHealth] = useState<Health>({ ok: true });
  const [user, setUser] = useState<SessionUser | null>(null);
  const [org, setOrg] = useState<SessionOrg | null>(null);

  useEffect(() => {
    const onHash = () => setLoc(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    void api.health().then(setHealth).catch(() => undefined);
    if (!getStoredSessionId()) return;
    void api
      .me()
      .then((res) => {
        setUser(res.user);
        setOrg(res.org);
        if (!res.user) clearStoredSession();
      })
      .catch(() => undefined);
  }, []);

  const onSession = useCallback((nextUser: SessionUser | null, nextOrg: SessionOrg | null) => {
    setUser(nextUser);
    setOrg(nextOrg);
    if (!nextUser) clearStoredSession();
  }, []);

  const onOrg = useCallback((next: SessionOrg) => {
    setOrg(next);
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
            <p className="text-xs text-muted">
              MCP=tools, A2A=peers, TwinMeet=rooms+registry
              {health.gemini ? ` · Gemini ${health.model ?? "live"}` : " · scripted twins"}
              {org ? ` · ${org.name} (${org.plan})` : ""}
            </p>
          </div>
          <nav className="flex flex-wrap gap-1">
            {(
              [
                ["registry", "Registry"],
                ["discover", "Discover"],
                ["meetings", "Meetings"],
                ["memory", "Memory"],
                ["federation", "A2A/MCP"],
                ["billing", "Billing"],
                ["account", user ? "Workspace" : "Sign in"],
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
        {route === "memory" && <MemoryPage />}
        {route === "federation" && <FederationPage />}
        {route === "billing" && <BillingPage org={org} onOrg={onOrg} />}
        {route === "account" && (
          <AccountPage user={user} org={org} oidc={Boolean(health.oidc)} onSession={onSession} />
        )}
        {route === "room" && roomId && <RoomPage roomId={roomId} />}
      </main>
    </div>
  );
}
