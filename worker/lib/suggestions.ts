import { geminiGenerate } from "./gemini";

export interface FollowUp {
  title: string;
  instruction: string;
}

export function fallbackFollowUps(intent: string): FollowUp[] {
  const topic = intent.replace(/\s+/g, " ").trim().slice(0, 140) || "this chat";
  return [
    {
      title: "Draw a map of this",
      instruction: `Draw an illustrated map of the requirements and the plan from this chat about: ${topic}`,
    },
    {
      title: "Write the full document",
      instruction: `Write a complete document the user can open that covers every decision in this chat about: ${topic}`,
    },
    {
      title: "Pull live sources",
      instruction: `Search live sources and write a sourced brief on the facts behind this chat about: ${topic}. Do not invent numbers.`,
    },
    {
      title: "Make a checklist",
      instruction: `Turn what was decided in this chat into a step-by-step checklist document for: ${topic}`,
    },
  ];
}

/** Four next jobs the two bots can actually perform from this chat. */
export async function suggestFollowUps(input: {
  apiKey?: string;
  model?: string;
  intent: string;
  narrative: string;
}): Promise<FollowUp[]> {
  const backup = fallbackFollowUps(input.intent);
  if (!input.apiKey) return backup;
  const raw = await geminiGenerate({
    apiKey: input.apiKey,
    model: input.model,
    json: true,
    temperature: 0.3,
    maxOutputTokens: 800,
    system: [
      "Return JSON only: {\"suggestions\":[{\"title\":\"\",\"instruction\":\"\"}]}",
      "Exactly 4 suggestions.",
      "Each title is under 8 words.",
      "Each instruction is one imperative the two bots can do inside this app: draw an image or map, write a document, search live sources and write a brief, or turn the result into a checklist, schedule, shot list, or email draft.",
      "Name specific things from THIS chat. Do not suggest booking, paying, emailing a real person, or using an account.",
    ].join(" "),
    user: `Chat topic: ${input.intent}\n\nWhat they agreed:\n${input.narrative.slice(0, 1800)}`,
  }).catch(() => null);
  const parsed = parseFollowUps(raw);
  if (parsed.length >= 4) return parsed.slice(0, 4);
  return [...parsed, ...backup].slice(0, 4);
}

function parseFollowUps(raw: string | null): FollowUp[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/, "")) as {
      suggestions?: Array<{ title?: string; instruction?: string }>;
    };
    return (parsed.suggestions ?? [])
      .map((item) => ({
        title: String(item.title || "").trim(),
        instruction: String(item.instruction || "").trim(),
      }))
      .filter((item) => item.title && item.instruction);
  } catch {
    return [];
  }
}
