export interface GeminiOptions {
  apiKey: string;
  model?: string;
}

export class GeminiHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GeminiHttpError";
  }
}

const FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-2.0-flash", "gemini-3.5-flash-lite"];

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string; code?: number };
}

export async function geminiGenerate(
  opts: GeminiOptions & {
    system: string;
    user: string;
    json?: boolean;
    maxOutputTokens?: number;
    temperature?: number;
  },
): Promise<string | null> {
  const models = unique([opts.model, ...FALLBACK_MODELS].filter((m): m is string => Boolean(m)));
  let lastError = "";
  let lastStatus = 0;

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": opts.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: opts.system }] },
            contents: [{ role: "user", parts: [{ text: opts.user }] }],
            generationConfig: {
              temperature: opts.temperature ?? 0.35,
              maxOutputTokens: opts.maxOutputTokens ?? 2048,
              responseMimeType: opts.json ? "application/json" : "text/plain",
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        },
      );
      const data = (await res.json()) as GeminiResponse;
      if (!res.ok) {
        lastError = data.error?.message || `HTTP ${res.status}`;
        lastStatus = res.status;
        if (res.status === 401 || res.status === 429) {
          throw new GeminiHttpError(res.status, lastError);
        }
        if (res.status === 404) continue;
        return null;
      }
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (text) return text;
    } catch (err) {
      if (err instanceof GeminiHttpError) throw err;
      lastError = err instanceof Error ? err.message : "gemini failed";
    }
  }

  if (lastError) {
    console.log(JSON.stringify({ level: "warn", message: "gemini.unavailable", status: lastStatus, detail: lastError.slice(0, 180) }));
  }
  return null;
}

export function twinMode(env: { TWIN_MODE?: string; GEMINI_API_KEY?: string }): "gemini" | "scripted" {
  if (env.TWIN_MODE === "scripted") return "scripted";
  return env.GEMINI_API_KEY ? "gemini" : "scripted";
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
