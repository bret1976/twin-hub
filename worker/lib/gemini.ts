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
const IMAGE_MODELS = ["gemini-2.5-flash-image", "gemini-2.0-flash-preview-image-generation"];

interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<GeminiPart> };
    finishReason?: string;
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
  error?: { message?: string; code?: number };
}

export interface LiveSource {
  title: string;
  url: string;
}

type GenerateAttempt =
  | { ok: true; text: string }
  | { ok: false; status: number; message: string; next: "model" | "plain" | "fatal" | "empty" };

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
    const first = await generateOnce(opts, model, true);
    const attempt = !first.ok && first.next === "plain" ? await generateOnce(opts, model, false) : first;
    if (attempt.ok) return attempt.text;
    lastError = attempt.message;
    lastStatus = attempt.status;
    if (attempt.next === "fatal") throw new GeminiHttpError(attempt.status, attempt.message);
  }

  if (lastError) {
    console.log(JSON.stringify({ level: "warn", message: "gemini.unavailable", status: lastStatus, detail: lastError.slice(0, 180) }));
  }
  return null;
}

const TRANSCRIBE_PROMPT =
  "Write down the words the person says in this audio, verbatim. Output only those words. Do not answer the person. Do not describe the audio. If you cannot hear words, output nothing at all.";

/** A one-word "No" is the model saying it heard nothing, not the person's question. */
function isNonTranscript(text: string): boolean {
  return /^(no|nope|none|n\/a|silence|empty|nothing|no speech|no audio|there is no speech|i (did not|didn't|cannot|can't) hear( any)?( speech| words| audio)?)\.?$/i.test(
    text.trim(),
  );
}

/** Transcribe a microphone clip. Returns "" when the clip has no usable speech. */
export async function geminiTranscribe(
  apiKey: string,
  audioBase64: string,
  mimeType: string,
  model?: string,
): Promise<string | null> {
  const models = unique([model, ...FALLBACK_MODELS].filter((m): m is string => Boolean(m)));
  const data = audioBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  const longClip = data.length > 16_000;
  let lastError = "";
  let lastStatus = 0;

  const prompts = longClip
    ? [
        TRANSCRIBE_PROMPT,
        "The recording contains a person speaking more than one sentence. Write every word you can hear, in order. Output only those words.",
      ]
    : [TRANSCRIBE_PROMPT];

  let heardNothing = false;
  for (const prompt of prompts) {
    for (const name of models) {
      try {
        const text = await transcribeOnce(apiKey, name, mimeType, data, prompt);
        if (text == null) continue;
        if (text && !isNonTranscript(text)) return text;
        heardNothing = true;
        if (!longClip) return text;
        break;
      } catch (err) {
        if (err instanceof GeminiHttpError) {
          if (err.status === 401 || err.status === 429) throw err;
          lastError = err.message;
          lastStatus = err.status;
          continue;
        }
        lastError = err instanceof Error ? err.message : "transcribe failed";
      }
    }
  }
  if (heardNothing) return "";

  if (lastError) {
    console.log(
      JSON.stringify({ level: "warn", message: "gemini.transcribe", status: lastStatus, detail: lastError.slice(0, 180) }),
    );
  }
  return null;
}

async function transcribeOnce(
  apiKey: string,
  model: string,
  mimeType: string,
  data: string,
  prompt: string,
): Promise<string | null> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType, data } }, { text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024,
      },
    }),
  });
  const body = (await res.json()) as GeminiResponse;
  if (!res.ok) {
    throw new GeminiHttpError(res.status, body.error?.message || `HTTP ${res.status}`);
  }
  return partText(body)
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/```$/, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

async function generateOnce(
  opts: GeminiOptions & {
    system: string;
    user: string;
    json?: boolean;
    maxOutputTokens?: number;
    temperature?: number;
  },
  model: string,
  thinking: boolean,
): Promise<GenerateAttempt> {
  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.35,
    maxOutputTokens: opts.maxOutputTokens ?? 2048,
    responseMimeType: opts.json ? "application/json" : "text/plain",
  };
  if (thinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": opts.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [{ text: opts.user }] }],
        generationConfig,
      }),
    });
    const data = (await res.json()) as GeminiResponse;
    if (!res.ok) {
      const message = data.error?.message || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 429) return { ok: false, status: res.status, message, next: "fatal" };
      if (res.status === 400 && thinking) return { ok: false, status: res.status, message, next: "plain" };
      return { ok: false, status: res.status, message, next: "model" };
    }
    const text = partText(data);
    if (!text) return { ok: false, status: 200, message: "empty", next: "empty" };
    return { ok: true, text };
  } catch (err) {
    if (err instanceof GeminiHttpError) throw err;
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "gemini failed",
      next: "model",
    };
  }
}

function partText(data: GeminiResponse): string {
  return (data.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

/** Draw one picture from a prompt. Returns null when no image model accepts the request. */
export async function geminiImage(
  apiKey: string,
  prompt: string,
): Promise<{ mimeType: string; data: string } | null> {
  let lastError = "";
  for (const model of IMAGE_MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        signal: AbortSignal.timeout(45_000),
      });
      const body = (await res.json()) as GeminiResponse;
      if (!res.ok) {
        lastError = body.error?.message || `HTTP ${res.status}`;
        if (res.status === 401 || res.status === 429) throw new GeminiHttpError(res.status, lastError);
        continue;
      }
      for (const part of body.candidates?.[0]?.content?.parts ?? []) {
        const mime = part.inlineData?.mimeType || part.inline_data?.mime_type;
        const data = part.inlineData?.data || part.inline_data?.data;
        if (mime && data) return { mimeType: mime, data };
      }
      lastError = "no image in response";
    } catch (err) {
      if (err instanceof GeminiHttpError) throw err;
      lastError = err instanceof Error ? err.message : "image failed";
    }
  }
  if (lastError) {
    console.log(JSON.stringify({ level: "warn", message: "gemini.image", detail: lastError.slice(0, 180) }));
  }
  return null;
}

/** Live web brief. Sources are the only figures a twin may cite. */
export async function geminiResearch(
  apiKey: string,
  query: string,
  model?: string,
): Promise<{ brief: string; sources: LiveSource[] }> {
  const models = unique([model, "gemini-2.0-flash", "gemini-3.5-flash"].filter((m): m is string => Boolean(m)));
  for (const name of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Search the live web and summarize only facts you can tie to a result for: ${query}. Omit any number you cannot support. Do not estimate.`,
                },
              ],
            },
          ],
          tools: [{ googleSearch: {} }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json()) as GeminiResponse;
      if (!res.ok) continue;
      const brief = partText(body);
      const sources = (body.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
        .map((chunk) => ({
          title: chunk.web?.title || chunk.web?.uri || "Source",
          url: chunk.web?.uri || "",
        }))
        .filter((source) => source.url.startsWith("http"));
      if (brief || sources.length) return { brief, sources };
    } catch {
      /* try the next model */
    }
  }
  return { brief: "", sources: [] };
}

export function twinMode(env: { TWIN_MODE?: string; GEMINI_API_KEY?: string }): "gemini" | "scripted" {
  if (env.TWIN_MODE === "scripted") return "scripted";
  return env.GEMINI_API_KEY ? "gemini" : "scripted";
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
