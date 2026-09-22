import type { AgentRecord, CapabilityRecord, DiscoverHit } from "../types";

const STOP = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "for",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "is",
  "are",
  "be",
  "with",
  "one",
  "from",
  "it",
  "as",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_+]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function termFreq(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tokens) map.set(t, (map.get(t) ?? 0) + 1);
  return map;
}

function bm25(
  query: string[],
  doc: string[],
  df: Map<string, number>,
  nDocs: number,
  avgDl: number,
): number {
  const k1 = 1.2;
  const b = 0.75;
  const tf = termFreq(doc);
  const dl = doc.length || 1;
  let score = 0;
  const seen = new Set<string>();
  for (const q of query) {
    if (seen.has(q)) continue;
    seen.add(q);
    const f = tf.get(q) ?? 0;
    if (!f) continue;
    const nq = df.get(q) ?? 0;
    const idf = Math.log(1 + (nDocs - nq + 0.5) / (nq + 0.5));
    const denom = f + k1 * (1 - b + b * (dl / (avgDl || 1)));
    score += idf * ((f * (k1 + 1)) / denom);
  }
  return score;
}

function jaccard(a: string[], b: string[]): { score: number; matched: string[] } {
  const A = new Set(a.map((t) => t.toLowerCase()));
  const B = new Set(b.map((t) => t.toLowerCase()));
  const matched = [...A].filter((t) => B.has(t));
  const union = new Set([...A, ...B]);
  if (union.size === 0) return { score: 0, matched };
  return { score: matched.length / union.size, matched };
}

function docTokens(agent: AgentRecord, caps: CapabilityRecord[]): string[] {
  const parts = [
    agent.name,
    agent.description,
    agent.purpose,
    ...agent.tags,
    ...caps.flatMap((c) => [c.name, c.description, c.skillId, ...c.tags, ...c.examples]),
  ];
  return tokenize(parts.join(" "));
}

export function discoverAgents(
  agents: AgentRecord[],
  capsByAgent: Map<string, CapabilityRecord[]>,
  intent: string,
  tags: string[],
  limit = 3,
): DiscoverHit[] {
  const queryTokens = tokenize(intent);
  const docs = agents.map((agent) => {
    const caps = capsByAgent.get(agent.id) ?? [];
    return { agent, caps, tokens: docTokens(agent, caps) };
  });

  const df = new Map<string, number>();
  let totalLen = 0;
  for (const doc of docs) {
    totalLen += doc.tokens.length;
    const unique = new Set(doc.tokens);
    for (const t of unique) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const avgDl = docs.length ? totalLen / docs.length : 1;

  const keywordRaw = docs.map((doc) =>
    bm25(queryTokens, doc.tokens, df, docs.length, avgDl),
  );
  const maxKw = Math.max(1e-9, ...keywordRaw);

  const hits: DiscoverHit[] = docs.map((doc, i) => {
    const agentTags = [
      ...doc.agent.tags,
      ...doc.caps.flatMap((c) => c.tags),
    ];
    const tagQuery = tags.length ? tags : queryTokens.filter((t) => agentTags.includes(t));
    const { score: tagScore, matched } = jaccard(tagQuery, agentTags);
    const keywordScore = keywordRaw[i] / maxKw;
    const score = 0.55 * tagScore + 0.45 * keywordScore;
    return {
      agent: doc.agent,
      capabilities: doc.caps,
      score,
      tagScore,
      keywordScore,
      matchedTags: matched,
    };
  });

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
