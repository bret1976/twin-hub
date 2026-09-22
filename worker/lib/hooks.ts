import type { TwinAction } from "../types";
import { verifyHmac } from "./auth";
import { error, json, readJson } from "./http";

const ECHO_SECRET = "callback-demo-secret";

interface HookBody {
  event?: string;
  roomId?: string;
  selfId?: string;
  selfName?: string;
  intent?: string;
  body?: string;
  transcript?: Array<{ type?: string; authorId?: string; body?: string }>;
}

export async function handleEchoTwin(request: Request): Promise<Response> {
  const raw = await request.text();
  const ts = request.headers.get("x-twinmeet-timestamp") || "";
  const sig = request.headers.get("x-twinmeet-signature") || "";
  if (sig && !(await verifyHmac(ECHO_SECRET, `${ts}.${raw}`, sig))) {
    return error(401, "Invalid TwinMeet callback signature");
  }
  let payload: HookBody = {};
  try {
    payload = raw.trim() ? (JSON.parse(raw) as HookBody) : await readJson<HookBody>(request);
  } catch {
    payload = {};
  }
  const transcript = payload.transcript ?? [];
  const hasArtifact = transcript.some((m) => m.type === "artifact");
  const mine = transcript.filter((m) => m.authorId === payload.selfId).length;
  const actions: TwinAction[] = [];
  if (mine === 0) {
    actions.push({
      type: "chat",
      body: `${payload.selfName || "RemotePeer"} is on the floor via HMAC callback. Intent received: ${String(payload.intent || "").slice(0, 180)}`,
    });
  } else if (hasArtifact) {
    actions.push({
      type: "vote",
      body: "RemotePeer approves the artifact over the signed callback.",
      subject: "artifact",
      decision: "approve",
    });
  }
  return json({ actions });
}
