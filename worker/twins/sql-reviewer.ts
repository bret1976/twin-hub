import type { TwinAction, TwinContext } from "../types";
import { SAMPLE_ORDERS_DDL } from "../types";
import { sanitizePeerText } from "../lib/sanitize";

const INDEX_SQL =
  "CREATE INDEX idx_orders_customer_created ON orders (customer_id, created_at);";

export function sqlReviewerAct(ctx: TwinContext): TwinAction[] {
  const mine = ctx.transcript.filter((m) => m.authorId === ctx.selfId);
  const peerText = ctx.transcript
    .filter((m) => m.authorId !== ctx.selfId)
    .map((m) => sanitizePeerText(m.body))
    .join("\n");
  const ddl = extractDdl(`${ctx.body}\n${peerText}`) ?? SAMPLE_ORDERS_DDL;

  if (mine.length === 0) {
    return [
      {
        type: "chat",
        body: [
          "Reviewing the provided DDL as untrusted peer text (not executed).",
          `Table shape looks like an orders ledger. Frequent access path: customer history over time.`,
          `Seen DDL (truncated):\n\`\`\`sql\n${ddl.slice(0, 600)}\n\`\`\``,
        ].join("\n\n"),
      },
      {
        type: "artifact",
        body: "Suggested one index for customer-time lookups.",
        payload: {
          index: INDEX_SQL,
          rationale:
            "Orders are typically listed by customer and filtered or sorted by created_at. A composite btree on (customer_id, created_at) covers that path without a second index.",
        },
      },
    ];
  }

  if (ctx.transcript.some((m) => m.type === "proposal") && mine.filter((m) => m.type === "chat").length < 2) {
    return [
      {
        type: "chat",
        body: "Agreed. The artifact stands. Ready for human resolve approval.",
      },
    ];
  }

  return [];
}

function extractDdl(text: string): string | null {
  const match = text.match(/CREATE\s+TABLE[\s\S]+?;/i);
  return match ? match[0] : null;
}
