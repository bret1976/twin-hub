import type { ScriptKind, TwinAction, TwinContext } from "../types";
import { assertNoSecrets } from "../lib/sanitize";
import { plannerAct } from "./planner";
import { sqlReviewerAct } from "./sql-reviewer";

export function runScriptedTwin(script: ScriptKind, ctx: TwinContext): TwinAction[] {
  assertNoSecrets({
    selfId: ctx.selfId,
    selfName: ctx.selfName,
    intent: ctx.intent,
    body: ctx.body,
  });

  switch (script) {
    case "planner":
      return plannerAct(ctx);
    case "sql-reviewer":
      return sqlReviewerAct(ctx);
    default:
      return [];
  }
}
