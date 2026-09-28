import { sanitizePeerText } from "../lib/sanitize";
import type { RoomMessage, TwinAction, TwinContext } from "../types";

/** A chat line from the person in the room, not from a twin. */
export function isHumanMessage(message: RoomMessage, ctx: TwinContext): boolean {
  if (message.type === "system" || message.type === "audit") return false;
  if (message.authorId === "human") return true;
  if (message.authorName.trim().toLowerCase() === "human" || message.authorName.trim().toLowerCase() === "you") {
    return true;
  }
  return !ctx.members.some((member) => member.id === message.authorId);
}

/** The newest human question or instruction this twin has not answered yet. */
export function latestUnansweredHuman(ctx: TwinContext): RoomMessage | null {
  let last: RoomMessage | null = null;
  let index = -1;
  ctx.transcript.forEach((message, i) => {
    if (!isHumanMessage(message, ctx)) return;
    if (message.type !== "chat" && message.type !== "proposal") return;
    if (!message.body.trim()) return;
    last = message;
    index = i;
  });
  if (!last || index < 0) return null;
  const answered = ctx.transcript.slice(index + 1).some((message) => message.authorId === ctx.selfId);
  return answered ? null : last;
}

const STOP = new Set([
  "the", "a", "an", "to", "of", "and", "or", "for", "in", "on", "is", "it", "this", "that",
  "what", "please", "exactly", "answer", "you", "your", "me", "my", "do", "does", "can",
  "could", "would", "should", "with", "from", "about", "into", "keep", "going", "then",
  "one", "sentence",
]);

/** A reply counts only if it actually takes up the human's words or arithmetic. */
export function replyAddresses(reply: string, instruction: string): boolean {
  const sum = instruction.match(/(-?\d+)\s*\+\s*(-?\d+)/);
  if (sum) return reply.includes(String(Number(sum[1]) + Number(sum[2])));
  const words = (instruction.toLowerCase().match(/[a-z0-9+]{3,}/g) || []).filter((word) => !STOP.has(word));
  if (words.length === 0) return reply.trim().length > 0;
  const blob = reply.toLowerCase();
  const hits = words.filter((word) => blob.includes(word));
  return hits.length >= Math.min(2, words.length);
}

export function scriptedHumanReply(ctx: TwinContext, human: RoomMessage): TwinAction {
  const said = sanitizePeerText(human.body, 700);
  const sum = said.match(/(-?\d+)\s*\+\s*(-?\d+)/);
  const math = sum ? ` ${sum[1]} + ${sum[2]} is ${Number(sum[1]) + Number(sum[2])}.` : "";
  const peer = ctx.members.find((member) => member.role === "twin" && member.id !== ctx.selfId);
  const sql = /sql|index|postgres|ddl/i.test(`${ctx.selfName} ${ctx.purpose ?? ""} ${ctx.selfId}`);
  if (sql) {
    return {
      type: "chat",
      body: `Taking your instruction as a constraint: ${said}${math} I will not execute SQL. I'll apply that on the next pass of the review.`,
    };
  }
  return {
    type: "chat",
    body: peer
      ? `You asked: ${said}${math} I'll keep the room on that, and ${peer.name} should answer it directly before we wrap up.`
      : `You asked: ${said}${math} I'll answer that before we wrap up.`,
  };
}

/**
 * A turn that only tries to close the room has not answered the person.
 * Force a spoken reply and drop the resolve until a later turn.
 */
export function addressHumanTurn(ctx: TwinContext, actions: TwinAction[]): TwinAction[] {
  const human = latestUnansweredHuman(ctx);
  if (!human) return actions;
  const open = actions.filter((action) => action.type !== "request_resolve" && action.type !== "needs_human");
  const addressed = open.some(
    (action) =>
      (action.type === "chat" || action.type === "proposal" || action.type === "artifact") &&
      replyAddresses(action.body, human.body),
  );
  if (addressed) return open;
  return [
    scriptedHumanReply(ctx, human),
    ...open.filter((action) => action.type !== "chat" && action.type !== "proposal"),
  ];
}
