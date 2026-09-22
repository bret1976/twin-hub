import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, type FederatedPeer } from "@/lib/api";

export function FederationPage() {
  const [cardUrl, setCardUrl] = useState("/.well-known/agent-card.json");
  const [peers, setPeers] = useState<FederatedPeer[]>([]);
  const [platform, setPlatform] = useState<Record<string, unknown> | null>(null);
  const [tools, setTools] = useState<Array<{ name: string; description: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [p, t, c] = await Promise.all([api.peers(), api.mcpTools(), api.a2aCard()]);
      setPeers(p.peers);
      setTools(t.tools);
      setPlatform(c);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Federation load failed");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function add() {
    setBusy(true);
    try {
      const url = cardUrl.startsWith("/") ? `${window.location.origin}${cardUrl}` : cardUrl;
      await api.addPeer(url);
      setCardUrl("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">A2A + MCP</h1>
        <p className="mt-1 text-sm text-muted">
          TwinMeet speaks A2A JSON-RPC at /v1/a2a and an MCP tool runtime at /v1/mcp. Import a peer
          Agent Card to federate it into this org.
        </p>
      </div>
      {error && <p className="text-sm text-coral">{error}</p>}
      <Card>
        <CardHeader>
          <CardTitle>Import peer card</CardTitle>
          <CardDescription>Absolute URL, or the local well-known card.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input value={cardUrl} onChange={(e) => setCardUrl(e.target.value)} />
          <Button disabled={busy || !cardUrl.trim()} onClick={() => void add()}>
            Fetch card
          </Button>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>MCP tools</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {tools.map((t) => (
              <p key={t.name}>
                <span className="font-mono text-gold">{t.name}</span> — {t.description}
              </p>
            ))}
            {tools.length === 0 && <p className="text-muted">No tools advertised.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Platform Agent Card</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto font-mono text-xs text-paper-2">
              {platform ? JSON.stringify(platform, null, 2) : "Loading…"}
            </pre>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-3">
        {peers.map((peer) => (
          <Card key={peer.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{peer.name}</CardTitle>
                <Badge variant="teal">federated</Badge>
              </div>
              <CardDescription>{peer.cardUrl}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
