import type { TwinAction, TwinContext } from "../types";
import { signHmac } from "./auth";
import { sanitizePeerText } from "./sanitize";

export async function callTwinWebhook(
  url: string,
  secret: string | null,
  ctx: TwinContext & { roomId: string; event: string },
  publicBase?: string,
): Promise<TwinAction[]> {
  const target = url.startsWith("/") ? `${publicBase || ""}${url}` : url;
  if (!target.startsWith("http")) return [];
  const body = JSON.stringify({
    event: ctx.event,
    roomId: ctx.roomId,
    selfId: ctx.selfId,
    selfName: ctx.selfName,
    intent: ctx.intent,
    body: ctx.body,
    transcript: ctx.transcript.slice(-12).map((m) => ({
      type: m.type,
      authorId: m.authorId,
      authorName: m.authorName,
      body: sanitizePeerText(m.body, 1500),
    })),
  });
  const ts = String(Date.now());
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-twinmeet-timestamp": ts,
  };
  if (secret) headers["x-twinmeet-signature"] = await signHmac(secret, `${ts}.${body}`);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(target, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = (await res.json()) as { actions?: TwinAction[] };
      return Array.isArray(data.actions) ? data.actions.slice(0, 3) : [];
    } catch {
      /* retry */
    }
  }
  return [];
}
