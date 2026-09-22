import type { ScriptKind, TwinAction, TwinContext } from "../types";
import type { GeminiOptions } from "../lib/gemini";
import { assertNoSecrets } from "../lib/sanitize";
import { runCharterTwin } from "./brain";
import { plannerAct } from "./planner";
import { sqlReviewerAct } from "./sql-reviewer";
import { runGenericTwin } from "./generic";

export async function runScriptedTwin(script: ScriptKind, ctx: TwinContext): Promise<TwinAction[]> {
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
      return runGenericTwin(ctx);
  }
}

export async function runTwin(
  script: ScriptKind,
  ctx: TwinContext,
  llm?: GeminiOptions,
  mode: "gemini" | "scripted" = llm?.apiKey ? "gemini" : "scripted",
): Promise<TwinAction[]> {
  assertNoSecrets({
    selfId: ctx.selfId,
    selfName: ctx.selfName,
    intent: ctx.intent,
    body: ctx.body,
  });

  if (mode === "scripted" || !llm?.apiKey) {
    return runScriptedTwin(script, ctx);
  }

  const generated = await runCharterTwin(ctx, llm);
  if (generated.length) return generated;
  return runScriptedTwin(script, ctx);
}

export async function runAnyTwin(
  ctx: TwinContext,
  llm?: GeminiOptions,
  mode: "gemini" | "scripted" = llm?.apiKey ? "gemini" : "scripted",
  script?: ScriptKind | null,
): Promise<TwinAction[]> {
  if (mode === "gemini" && llm?.apiKey) {
    const generated = await runCharterTwin(ctx, llm);
    if (generated.length) return generated;
  }
  if (script) return runScriptedTwin(script, ctx);
  return runGenericTwin(ctx, mode === "gemini" ? llm : undefined);
}
