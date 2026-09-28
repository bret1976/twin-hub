/**
 * Room minutes + export (original TwinMeet code).
 *
 * Idea inspiration (not vendored):
 * - bijelic/agent-room (MIT): structured room artifacts like [DECISION]/[TODO]/[STATUS]/[RESULT]
 * - meeting-minutes structuring CLIs (MIT): decisions / actions / markdown export shape
 *
 * Pure extractors over TwinMeet RoomSnapshot — no LLM required, works offline.
 */

import type { ArtifactRecord, JointSummary, RoomMessage, RoomSnapshot } from "../types";

export type MinutesItemKind = "decision" | "todo" | "status" | "result" | "question" | "note";

export interface MinutesItem {
  kind: MinutesItemKind;
  text: string;
  authorName: string;
  messageId: string;
  createdAt: string;
  source: "tag" | "proposal" | "artifact" | "vote" | "summary" | "heuristic";
}

export interface RoomMinutes {
  version: "minutes-v1";
  roomId: string;
  intent: string;
  status: string;
  generatedAt: string;
  startedAt: string;
  participants: string[];
  roundCount: number;
  messageCount: number;
  overview: string;
  decisions: MinutesItem[];
  actionItems: MinutesItem[];
  statusUpdates: MinutesItem[];
  results: MinutesItem[];
  openQuestions: MinutesItem[];
  artifacts: Array<{ id: string; kind: string; authorId: string; preview: string; createdAt: string }>;
  votes: Array<{ voterName: string; subject: string; decision: string; createdAt: string }>;
  summary: JointSummary | null;
  timeline: Array<{ seq: number; authorName: string; type: string; body: string; createdAt: string }>;
}

const TAG_RE =
  /\[\s*(DECISION|TODO|ACTION|STATUS|RESULT|QUESTION|NOTE)\s*\]\s*[:\-–—]?\s*(.+)/gi;

const HEURISTIC_DECISION =
  /\b(we (?:will|should|agreed|decide|decided)|let'?s (?:go with|ship|use)|approved|consensus)\b/i;
const HEURISTIC_TODO =
  /\b(todo|action item|follow[- ]?up|i(?:'| wi)?ll (?:take|own|handle)|please (?:add|fix|ship))\b/i;
const HEURISTIC_QUESTION = /\?$|\b(open question|unclear|need(?:s)? clarification)\b/i;

export function buildRoomMinutes(room: RoomSnapshot): RoomMinutes {
  const messages = room.messages.filter((m) => m.type !== "audit");
  const participants = unique(
    room.members.filter((m) => m.role === "twin" || m.role === "human").map((m) => m.name),
  );
  const tagged: MinutesItem[] = [];
  for (const m of messages) {
    tagged.push(...extractTaggedItems(m));
  }

  const fromProposals = messages
    .filter((m) => m.type === "proposal")
    .map((m) => item("decision", stripTags(m.body), m, "proposal"));

  const fromArtifacts = room.artifacts.map((a) =>
    item(
      "result",
      artifactPreview(a),
      {
        id: a.messageId || a.id,
        authorName: memberName(room, a.authorId),
        createdAt: a.createdAt,
      },
      "artifact",
    ),
  );

  const fromVotes = room.votes
    .filter((v) => v.decision === "approve")
    .map((v) =>
      item(
        "decision",
        `Vote approved on ${v.subject} by ${v.voterName}`,
        { id: `vote-${v.voterId}-${v.createdAt}`, authorName: v.voterName, createdAt: v.createdAt },
        "vote",
      ),
    );

  const fromSummary: MinutesItem[] = room.summary?.narrative
    ? [
        item(
          "note",
          room.summary.narrative,
          {
            id: "summary",
            authorName: `summary:${room.summary.generatedBy}`,
            createdAt: room.createdAt,
          },
          "summary",
        ),
      ]
    : [];

  const heuristics: MinutesItem[] = [];
  for (const m of messages) {
    if (m.type === "system" || m.type === "audit") continue;
    if (tagged.some((t) => t.messageId === m.id)) continue;
    if (m.type === "proposal") continue;
    const body = m.body.trim();
    if (body.length < 12) continue;
    if (HEURISTIC_TODO.test(body)) heuristics.push(item("todo", body, m, "heuristic"));
    else if (HEURISTIC_QUESTION.test(body)) heuristics.push(item("question", body, m, "heuristic"));
    else if (HEURISTIC_DECISION.test(body) && m.type === "chat") {
      heuristics.push(item("decision", body, m, "heuristic"));
    }
  }

  const all = [...tagged, ...fromProposals, ...fromArtifacts, ...fromVotes, ...fromSummary, ...heuristics];
  const decisions = filterKind(all, "decision");
  const actionItems = filterKind(all, "todo");
  const statusUpdates = filterKind(all, "status");
  const results = filterKind(all, "result");
  const openQuestions = filterKind(all, "question");

  const overview = buildOverview({
    intent: room.intent,
    status: room.status,
    participants,
    decisions,
    actionItems,
    results,
    summary: room.summary,
  });

  return {
    version: "minutes-v1",
    roomId: room.id,
    intent: room.intent,
    status: room.status,
    generatedAt: new Date().toISOString(),
    startedAt: room.createdAt,
    participants,
    roundCount: room.roundCount,
    messageCount: messages.length,
    overview,
    decisions,
    actionItems,
    statusUpdates,
    results,
    openQuestions,
    artifacts: room.artifacts.map((a) => ({
      id: a.id,
      kind: a.kind,
      authorId: a.authorId,
      preview: artifactPreview(a),
      createdAt: a.createdAt,
    })),
    votes: room.votes.map((v) => ({
      voterName: v.voterName,
      subject: v.subject,
      decision: v.decision,
      createdAt: v.createdAt,
    })),
    summary: room.summary,
    timeline: messages.map((m) => ({
      seq: m.seq,
      authorName: m.authorName,
      type: m.type,
      body: m.body,
      createdAt: m.createdAt,
    })),
  };
}

export function formatMinutesMarkdown(minutes: RoomMinutes): string {
  const lines: string[] = [
    `# TwinMeet room minutes`,
    ``,
    `- **Room:** \`${minutes.roomId}\``,
    `- **Intent:** ${minutes.intent || "(none)"}`,
    `- **Status:** ${minutes.status}`,
    `- **Started:** ${minutes.startedAt}`,
    `- **Generated:** ${minutes.generatedAt}`,
    `- **Rounds:** ${minutes.roundCount}`,
    `- **Messages:** ${minutes.messageCount}`,
    `- **Participants:** ${minutes.participants.join(", ") || "none"}`,
    ``,
    `## Overview`,
    ``,
    minutes.overview,
    ``,
  ];

  pushSection(lines, "Decisions", minutes.decisions);
  pushSection(lines, "Action items", minutes.actionItems);
  pushSection(lines, "Results", minutes.results);
  pushSection(lines, "Status updates", minutes.statusUpdates);
  pushSection(lines, "Open questions", minutes.openQuestions);

  if (minutes.artifacts.length) {
    lines.push(`## Artifacts`, ``);
    for (const a of minutes.artifacts) {
      lines.push(`- **${a.kind}** (${a.id}): ${a.preview}`);
    }
    lines.push(``);
  }

  if (minutes.votes.length) {
    lines.push(`## Votes`, ``);
    for (const v of minutes.votes) {
      lines.push(`- ${v.voterName}: ${v.decision} on ${v.subject} (${v.createdAt})`);
    }
    lines.push(``);
  }

  if (minutes.summary?.narrative) {
    lines.push(`## Joint summary`, ``, minutes.summary.narrative, ``);
  }

  lines.push(`## Transcript`, ``);
  for (const row of minutes.timeline) {
    lines.push(`- **${row.authorName}** [${row.type}] (${row.createdAt}): ${row.body}`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`_Generated by TwinMeet minutes-v1 (local extractors; no secrets)._`);
  lines.push(``);
  return lines.join("\n");
}

export function formatMinutesText(minutes: RoomMinutes): string {
  return formatMinutesMarkdown(minutes)
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "");
}

export function formatMinutesJson(minutes: RoomMinutes): string {
  return `${JSON.stringify(minutes, null, 2)}\n`;
}

export function exportMinutes(
  minutes: RoomMinutes,
  format: "md" | "json" | "txt" = "md",
): { body: string; contentType: string; filename: string } {
  const safeId = minutes.roomId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48) || "room";
  if (format === "json") {
    return {
      body: formatMinutesJson(minutes),
      contentType: "application/json; charset=utf-8",
      filename: `twinmeet-minutes-${safeId}.json`,
    };
  }
  if (format === "txt") {
    return {
      body: formatMinutesText(minutes),
      contentType: "text/plain; charset=utf-8",
      filename: `twinmeet-minutes-${safeId}.txt`,
    };
  }
  return {
    body: formatMinutesMarkdown(minutes),
    contentType: "text/markdown; charset=utf-8",
    filename: `twinmeet-minutes-${safeId}.md`,
  };
}

function extractTaggedItems(m: RoomMessage): MinutesItem[] {
  const out: MinutesItem[] = [];
  const re = new RegExp(TAG_RE.source, TAG_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(m.body)) !== null) {
    const raw = match[1].toUpperCase();
    const kind: MinutesItemKind =
      raw === "TODO" || raw === "ACTION"
        ? "todo"
        : raw === "DECISION"
          ? "decision"
          : raw === "STATUS"
            ? "status"
            : raw === "RESULT"
              ? "result"
              : raw === "QUESTION"
                ? "question"
                : "note";
    const text = match[2].trim();
    if (text) out.push(item(kind, text, m, "tag"));
  }
  return out;
}

function item(
  kind: MinutesItemKind,
  text: string,
  meta: { id: string; authorName: string; createdAt: string },
  source: MinutesItem["source"],
): MinutesItem {
  return {
    kind,
    text: text.trim().slice(0, 2000),
    authorName: meta.authorName,
    messageId: meta.id,
    createdAt: meta.createdAt,
    source,
  };
}

function filterKind(items: MinutesItem[], kind: MinutesItemKind): MinutesItem[] {
  const seen = new Set<string>();
  const out: MinutesItem[] = [];
  for (const it of items) {
    if (it.kind !== kind) continue;
    const key = `${it.kind}|${it.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function pushSection(lines: string[], title: string, items: MinutesItem[]): void {
  lines.push(`## ${title}`, ``);
  if (!items.length) {
    lines.push(`_None captured._`, ``);
    return;
  }
  for (const it of items) {
    lines.push(`- ${it.text} — _${it.authorName}_ (${it.source})`);
  }
  lines.push(``);
}

function buildOverview(input: {
  intent: string;
  status: string;
  participants: string[];
  decisions: MinutesItem[];
  actionItems: MinutesItem[];
  results: MinutesItem[];
  summary: JointSummary | null;
}): string {
  if (input.summary?.narrative) return input.summary.narrative;
  const bits = [
    `Meeting on “${input.intent || "untitled"}” is ${input.status}.`,
    input.participants.length ? `Participants: ${input.participants.join(", ")}.` : "",
    `${input.decisions.length} decision(s), ${input.actionItems.length} action item(s), ${input.results.length} result(s) captured from the transcript.`,
  ];
  return bits.filter(Boolean).join(" ");
}

function artifactPreview(a: ArtifactRecord): string {
  try {
    const body = a.body as Record<string, unknown>;
    const preferred = ["summary", "index", "ddl", "rationale", "kind", "title"];
    for (const key of preferred) {
      const v = body[key];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 280);
    }
    return JSON.stringify(body).slice(0, 280);
  } catch {
    return a.kind;
  }
}

function memberName(room: RoomSnapshot, authorId: string): string {
  return room.members.find((m) => m.id === authorId)?.name || authorId;
}

function stripTags(body: string): string {
  return body.replace(/\[\s*(DECISION|TODO|ACTION|STATUS|RESULT|QUESTION|NOTE)\s*\]\s*[:\-–—]?\s*/gi, "").trim() || body.trim();
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}
