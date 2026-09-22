import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { storeSessionId, type SessionOrg, type SessionUser } from "@/lib/session";

export function AccountPage({
  user,
  org,
  oidc,
  onSession,
}: {
  user: SessionUser | null;
  org: SessionOrg | null;
  oidc: boolean;
  onSession: (user: SessionUser | null, org: SessionOrg | null) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("demo@twinmeet.dev");
  const [password, setPassword] = useState("demo-pass");
  const [name, setName] = useState("Demo Owner");
  const [orgName, setOrgName] = useState("TwinMeet Demo");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const out =
        mode === "login"
          ? await api.login(email, password)
          : await api.register({ email, name, password, orgName });
      storeSessionId(out.session.id);
      onSession(out.user, out.org);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  async function enterDemo() {
    setBusy(true);
    setError(null);
    try {
      const out = await api.demoLogin();
      storeSessionId(out.session.id);
      onSession(out.user, out.org);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo login failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    onSession(null, null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-4">
        <div>
          <h1 className="font-serif text-3xl">Workspace</h1>
          <p className="mt-1 text-sm text-muted">
            Multi-tenant orgs, email login, Google OIDC when configured, and a seeded demo workspace.
            Rooms still work without login — this binds agents, memory, and billing to an org.
          </p>
        </div>
        {user && org ? (
          <Card>
            <CardHeader>
              <CardTitle>{user.name}</CardTitle>
              <CardDescription>
                {user.email} · {org.name} · {org.plan}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                <span className="text-muted">Org id. </span>
                <span className="font-mono">{org.id}</span>
              </p>
              <p>
                <span className="text-muted">Role. </span>
                {user.role}
              </p>
              <Button variant="outline" onClick={() => void logout()}>
                Sign out
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{mode === "login" ? "Sign in" : "Create a workspace"}</CardTitle>
              <CardDescription>Demo account is demo@twinmeet.dev / demo-pass.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {mode === "register" && (
                <>
                  <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                  <Input placeholder="Workspace name" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                </>
              )}
              <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && <p className="text-sm text-coral">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void submit()}>
                  {mode === "login" ? "Sign in" : "Create workspace"}
                </Button>
                <Button variant="teal" disabled={busy} onClick={() => void enterDemo()}>
                  Enter demo workspace
                </Button>
                {oidc && (
                  <Button variant="outline" onClick={() => (window.location.href = "/v1/auth/google")}>
                    Continue with Google
                  </Button>
                )}
              </div>
              <button
                className="text-xs text-muted hover:text-paper"
                onClick={() => setMode(mode === "login" ? "register" : "login")}
              >
                {mode === "login" ? "Need a new org? Register" : "Already have an account? Sign in"}
              </button>
            </CardContent>
          </Card>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>What login unlocks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted">
          <p>Each org owns twins, rooms, memory, federated peers, and a billing plan.</p>
          <p>Google OIDC is live when GOOGLE_CLIENT_ID / SECRET are set on the Worker.</p>
          <p>Without those keys, email + PBKDF2 sessions and the demo workspace are the product path.</p>
        </CardContent>
      </Card>
    </div>
  );
}
