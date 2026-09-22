import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type Agent, type Capability } from "@/lib/api";

export function RegistryPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [caps, setCaps] = useState<Capability[]>([]);
  const [card, setCard] = useState<{ id: string; json: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
