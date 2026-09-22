import type { DiscoverHit, AgentRecord, CapabilityRecord } from "../types";
import { discoverAgents } from "./discover";

export async function embedText(apiKey: string, text: string): Promise<number[] | null> {
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, 8000) }] },
        }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    return data.embedding?.values ?? null;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

export async function discoverHybrid(
  agents: AgentRecord[],
  capsByAgent: Map<string, CapabilityRecord[]>,
  intent: string,
  tags: string[],
  queryEmbedding: number[] | null,
  limit = 5,
): Promise<DiscoverHit[]> {
  const lexical = discoverAgents(agents, capsByAgent, intent, tags, agents.length || 3);
  if (!queryEmbedding) return lexical.slice(0, limit);

  return lexical
    .map((hit) => {
      const vec = hit.agent.embedding;
      const semantic = vec ? Math.max(0, cosine(queryEmbedding, vec)) : 0;
      return {
        ...hit,
        score: 0.6 * hit.score + 0.4 * semantic,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
