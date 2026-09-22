export interface GeminiOptions {
  apiKey: string;
  model?: string;
}

const FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string };
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
        if (res.status === 404) continue;
        return null;
      }
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (text) return text;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "gemini failed";
    }
  }

  if (lastError) {
    console.log(JSON.stringify({ level: "warn", message: "gemini.unavailable", detail: lastError.slice(0, 180) }));
  }
  return null;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
