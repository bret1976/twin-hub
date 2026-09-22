import { geminiGenerate } from "./gemini";
import type { ArtifactRecord, JointSummary, RoomMember, RoomMessage } from "../types";

export function templateSummary(input: {
  intent: string;
  members: RoomMember[];
  messages: RoomMessage[];
  artifacts: ArtifactRecord[];
  resolved: boolean;
  rounds: number;
}): JointSummary {
  const artifact = input.artifacts[0]?.body ?? null;
  const speakers = input.members.filter((m) => m.role === "twin").map((m) => m.name);
  const lastProposal = [...input.messages].reverse().find((m) => m.type === "proposal");
  const narrative = [
    `Problem: ${input.intent}`,
    `Participants: ${speakers.join(", ") || "none"}.`,
    artifact
      ? `Artifact: ${JSON.stringify(artifact)}`
      : "Artifact: none produced.",
    lastProposal ? `Closing proposal: ${lastProposal.body}` : "",
    input.resolved
      ? `Resolved after ${input.rounds} rounds with a human-approved joint summary.`
      : `Not resolved. Room stopped after ${input.rounds} rounds.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    problem: input.intent,
    participants: speakers,
    artifact,
    resolved: input.resolved,
    rounds: input.rounds,
    narrative,
    generatedBy: "template",
  };
}

export async function generateSummary(
  input: {
    intent: string;
    members: RoomMember[];
    messages: RoomMessage[];
    artifacts: ArtifactRecord[];
    resolved: boolean;
    rounds: number;
  },
  keys?: { geminiKey?: string; openaiKey?: string; model?: string },
): Promise<JointSummary> {
  const fallback = templateSummary(input);
  const transcript = input.messages
    .map((m) => `${m.authorName} [${m.type}]: ${m.body}`)
    .join("\n");
  const artifact = input.artifacts[0]?.body ?? null;

  if (keys?.geminiKey) {
    const narrative = await geminiGenerate({
      apiKey: keys.geminiKey,
      model: keys.model,
      temperature: 0.2,
      maxOutputTokens: 700,
      system:
        "Write a concise joint meeting summary for TwinMeet. Mention the problem, who met, the artifact, and that a human approved resolve. No secrets, no tool calls, no markdown headings.",
      user: `Intent: ${input.intent}\nParticipants: ${fallback.participants.join(", ")}\nArtifact: ${JSON.stringify(artifact)}\nTranscript:\n${transcript}`,
    });
    if (narrative) return { ...fallback, narrative, generatedBy: "gemini" };
  }

  if (!keys?.openaiKey) return fallback;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${keys.openaiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: keys.model || "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "Write a concise joint meeting summary. Return plain prose, no secrets, no tool calls.",
          },
          {
            role: "user",
            content: `Intent: ${input.intent}\nTranscript:\n${transcript}`,
          },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const narrative = data.choices?.[0]?.message?.content?.trim();
    if (!narrative) return fallback;
    return { ...fallback, narrative, generatedBy: "llm" };
  } catch {
    return fallback;
  }
}
