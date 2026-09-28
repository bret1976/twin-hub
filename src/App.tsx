import { useCallback, useEffect, useState } from "react";
import { AccountPage } from "@/pages/AccountPage";
import { BillingPage } from "@/pages/BillingPage";
import { DiscoverPage } from "@/pages/DiscoverPage";
import { FederationPage } from "@/pages/FederationPage";
import { HomePage } from "@/pages/HomePage";
import { LandingPage } from "@/pages/LandingPage";
import { MeetingsPage } from "@/pages/MeetingsPage";
import { MemoryPage } from "@/pages/MemoryPage";
import { RegistryPage } from "@/pages/RegistryPage";
import { RoomPage } from "@/pages/RoomPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { api, type Health } from "@/lib/api";
import { clearStoredSession, getStoredSessionId, type SessionOrg, type SessionUser } from "@/lib/session";

type Route =
  | "landing"
  | "home"
  | "registry"
  | "discover"
  | "meetings"
  | "room"
  | "account"
  | "billing"
  | "memory"
  | "federation"
  | "settings";

function parseHash(): { route: Route; roomId: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (!raw) return { route: "landing", roomId: null };
  if (raw === "chat") return { route: "home", roomId: null };
  if (raw.startsWith("rooms/")) return { route: "room", roomId: raw.slice("rooms/".length) };
  if (raw === "discover") return { route: "discover", roomId: null };
  if (raw === "meetings") return { route: "meetings", roomId: null };
  if (raw === "account") return { route: "account", roomId: null };
  if (raw === "billing") return { route: "billing", roomId: null };
  if (raw === "memory") return { route: "memory", roomId: null };
  if (raw === "federation") return { route: "federation", roomId: null };
  if (raw === "settings") return { route: "settings", roomId: null };
  if (raw === "registry") return { route: "registry", roomId: null };
  return { route: "home", roomId: null };
}

export default function App() {
  const [{ route, roomId }, setLoc] = useState(parseHash);
  const [health, setHealth] = useState<Health>({ ok: true });
  const [user, setUser] = useState<SessionUser | null>(null);
  const [org, setOrg] = useState<SessionOrg | null>(null);
  const [more, setMore] = useState(false);

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
    setMore(false);
    if (next === "room" && id) {
      window.location.hash = `#/rooms/${id}`;
      return;
    }
    window.location.hash = next === "home" ? "#/chat" : next === "landing" ? "#" : `#/${next}`;
  }

  if (route === "landing") {
    return <LandingPage onEnter={() => go("home")} />;
  }

  const chatMode = route === "home" || route === "room";

  return (
    <div className="min-h-screen bg-ink">
      <header className="border-b border-rule/80 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between gap-2 px-3 sm:h-20 sm:px-4">
          <button type="button" onClick={() => go("landing")} className="min-w-0 text-left" aria-label="eglu home">
            <p
              className="text-3xl font-semibold leading-none tracking-tight text-white sm:text-4xl"
              style={{
                textShadow:
                  "0 0 8px rgba(120, 255, 245, 0.95), 0 0 18px rgba(0, 230, 220, 0.75), 0 0 36px rgba(0, 190, 200, 0.45)",
              }}
            >
              eglu
            </p>
          </button>
          <div className="relative flex shrink-0 items-center gap-2 sm:gap-3">
            {route === "room" && (
              <button type="button" onClick={() => go("home")} className="text-sm text-teal">
                New chat
              </button>
            )}
            <button
              type="button"
              onClick={() => go("meetings")}
              className={`text-sm ${route === "meetings" ? "text-paper" : "text-muted hover:text-paper"}`}
            >
              History
            </button>
            <button
              type="button"
              onClick={() => setMore((v) => !v)}
              className="text-sm text-muted hover:text-paper"
              aria-label="More"
            >
              More
            </button>
            {more && (
              <div className="absolute right-0 top-9 z-10 w-40 rounded-xl border border-rule bg-ink-2 py-1 text-sm shadow-lg">
                {(
                  [
                    ["settings", "Settings"],
                    ["registry", "Twins"],
                    ["discover", "Find a twin"],
                    ["memory", "Memory"],
                    ["federation", "A2A / MCP"],
                    ["billing", "Billing"],
                    ["account", user ? "Account" : "Sign in"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => go(key)}
                    className="block w-full px-3 py-1.5 text-left text-paper-2 hover:bg-ink"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={chatMode ? "" : "mx-auto max-w-2xl px-4 py-8"}>
        {route === "home" && <HomePage onOpened={(id) => go("room", id)} onFindTwin={() => go("discover")} />}
        {route === "registry" && <RegistryPage />}
        {route === "discover" && <DiscoverPage onOpened={(id) => go("room", id)} />}
        {route === "meetings" && <MeetingsPage onOpened={(id) => go("room", id)} />}
        {route === "memory" && <MemoryPage />}
        {route === "federation" && <FederationPage />}
        {route === "settings" && <SettingsPage />}
        {route === "billing" && <BillingPage org={org} onOrg={onOrg} />}
        {route === "account" && (
          <AccountPage user={user} org={org} oidc={Boolean(health.oidc)} onSession={onSession} />
        )}
        {route === "room" && roomId && <RoomPage roomId={roomId} onHome={() => go("home")} />}
      </main>
    </div>
  );
}
