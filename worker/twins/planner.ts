import type { TwinAction, TwinContext } from "../types";
import { sanitizePeerText } from "../lib/sanitize";

export function plannerAct(ctx: TwinContext): TwinAction[] {
  const mine = ctx.transcript.filter((m) => m.authorId === ctx.selfId);
  const hasArtifact = ctx.transcript.some((m) => m.type === "artifact");
  const intent = sanitizePeerText(ctx.intent);
  const body = sanitizePeerText(ctx.body);

  if (mine.length === 0) {
    return [
      {
        type: "chat",
        body: [
          `I need a specialist. Intent: ${intent}`,
          body ? `Working material:\n\`\`\`sql\n${body}\n\`\`\`` : "No DDL attached.",
          "Please review and suggest exactly one index, with a rationale.",
        ].join("\n\n"),
      },
    ];
  }

  if (hasArtifact && !mine.some((m) => m.type === "proposal")) {
    return [
      {
        type: "proposal",
        body: "The suggested index addresses the lookup path I care about. I propose we resolve this meeting and publish a joint summary.",
      },
      {
        type: "request_resolve",
        body: "Requesting human approval to resolve.",
      },
    ];
  }

  return [];
}
