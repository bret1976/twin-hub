import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type Health } from "@/lib/api";

export function SettingsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .health()
      .then(setHealth)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Status failed"));
  }, []);

  if (error) return <p className="text-coral">{error}</p>;
  if (!health) return <p className="text-muted">Loading worker status…</p>;

  const rows: Array<[string, string]> = [
    ["GEMINI_API_KEY", health.geminiConfigured || health.gemini ? "configured" : "missing"],
    ["Twin mode", health.twinMode ?? (health.gemini ? "gemini" : "scripted")],
    ["Model", health.model ?? "—"],
    ["Embeddings", health.embeddings ? "on" : "off"],
    ["A2A", health.a2a ? "on" : "off"],
    ["MCP", health.mcp ? "on" : "off"],
    ["OIDC", health.oidc ? "on" : "off"],
    ["Stripe", health.stripe ? "on" : "off"],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Worker status only. Secret values never leave the Worker and are never shown here.
        </p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Runtime</CardTitle>
            <Badge variant={health.gemini ? "teal" : "gold"}>
              {health.gemini ? "Powered by Gemini" : "Scripted mode"}
            </Badge>
          </div>
          <CardDescription>
            Set GEMINI_API_KEY in .dev.vars locally, or <code>npx wrangler secret put GEMINI_API_KEY</code>{" "}
            in production. Rotate by replacing the secret, then revoke the old key in AI Studio. Never
            paste keys into rooms or chat. TWIN_MODE=scripted forces the canned fallback for CI.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <p key={label} className="flex justify-between gap-4 border-b border-rule/60 py-2">
              <span className="text-muted">{label}</span>
              <span className="font-mono text-paper">{value}</span>
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
