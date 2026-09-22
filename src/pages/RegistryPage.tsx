import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { api, type Agent, type Capability } from "@/lib/api";

export function RegistryPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [caps, setCaps] = useState<Capability[]>([]);
  const [card, setCard] = useState<{ id: string; json: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    purpose: "",
    description: "",
    tags: "general",
    runtime: "generic" as Agent["runtime"],
    callbackUrl: "",
  });

  async function load() {
    try {
      const list = await api.agents();
      setAgents(list.agents);
      const allCaps: Capability[] = [];
      for (const agent of list.agents) {
        const detail = await api.agent(agent.id);
        allCaps.push(...detail.capabilities);
      }
      setCaps(allCaps);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load registry");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function seed() {
    setBusy(true);
    try {
      await api.seed();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setBusy(false);
    }
  }

  async function showCard(id: string) {
    const json = await api.card(id);
    setCard({ id, json });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Agent registry</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Digital Twins publish a charter and A2A-shaped Agent Card. Discovery matches intent to
            skills — MCP equips an agent; TwinMeet seats them in a room.
          </p>
        </div>
        <Button onClick={() => void seed()} disabled={busy}>
          {busy ? "Seeding…" : "Seed demo twins"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Register a twin</CardTitle>
          <CardDescription>Scripted, generic (Gemini charter), or HTTP callback runtime.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          <Input
            className="sm:col-span-2"
            placeholder="Purpose / charter"
            value={form.purpose}
            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
          />
          <Textarea
            className="sm:col-span-2 min-h-20"
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <select
            className="h-9 rounded-md border border-rule bg-ink px-3 text-sm"
            value={form.runtime}
            onChange={(e) => setForm({ ...form, runtime: e.target.value as Agent["runtime"] })}
          >
            <option value="generic">generic (any charter)</option>
            <option value="scripted">scripted</option>
            <option value="http">http callback</option>
          </select>
          {form.runtime === "http" && (
            <Input
              placeholder="Callback URL"
              value={form.callbackUrl}
              onChange={(e) => setForm({ ...form, callbackUrl: e.target.value })}
            />
          )}
          <div className="sm:col-span-2">
            <Button
              variant="outline"
              disabled={busy || !form.name || !form.purpose || !form.description}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  try {
                    await api.createAgent({
                      name: form.name,
                      purpose: form.purpose,
                      description: form.description,
                      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
                      runtime: form.runtime,
                      script: form.runtime === "generic" ? "generic" : null,
                      callbackUrl: form.callbackUrl || null,
                    });
                    setForm({ name: "", purpose: "", description: "", tags: "general", runtime: "generic", callbackUrl: "" });
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Create failed");
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              Create twin
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-coral">{error}</p>}

      {agents.length === 0 && !error && (
        <Card>
          <CardContent className="py-10 text-center text-muted">
            Registry is empty. Seed NeedHelp (planning) and HasSkill (sql, postgres) to run the demo.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {agents.map((agent) => {
          const skills = caps.filter((c) => c.agentId === agent.id);
          return (
            <Card key={agent.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle>{agent.name}</CardTitle>
                  <Badge variant={agent.script === "planner" ? "gold" : "teal"}>{agent.id}</Badge>
                </div>
                <CardDescription>{agent.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  <span className="text-muted">Purpose. </span>
                  {agent.purpose}
                </p>
                <p>
                  <span className="text-muted">Non-goals. </span>
                  {agent.nonGoals}
                </p>
                <p>
                  <span className="text-muted">Boundaries. </span>
                  {agent.boundaries}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {agent.tags.map((tag) => (
                    <Badge key={tag} variant="mute">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <ul className="space-y-1 text-muted">
                  {skills.map((skill) => (
                    <li key={skill.id}>
                      <span className="text-paper">{skill.name}</span> — {skill.description}
                    </li>
                  ))}
                </ul>
                <Button variant="outline" size="sm" onClick={() => void showCard(agent.id)}>
                  Export Agent Card
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {card && (
        <Card>
          <CardHeader>
            <CardTitle>A2A Agent Card — {card.id}</CardTitle>
            <CardDescription>GET /v1/agents/{card.id}/card</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-ink p-3 font-mono text-xs text-paper-2">
              {JSON.stringify(card.json, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
