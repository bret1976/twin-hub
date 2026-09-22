import type { ScriptKind, TwinAction, TwinContext } from "../types";
import type { GeminiOptions } from "../lib/gemini";
import { assertNoSecrets } from "../lib/sanitize";
import { detectPhase, generateTwinActions } from "./llm";
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

export async function runTwin(
  script: ScriptKind,
  ctx: TwinContext,
  llm?: GeminiOptions,
): Promise<TwinAction[]> {
  const fallback = runScriptedTwin(script, ctx);
  if (!llm?.apiKey) return fallback;

  try {
    const generated = await generateTwinActions(script, ctx, llm);
    if (!generated) return fallback;
    return mergeActions(script, ctx, generated, fallback);
  } catch {
    return fallback;
  }
}

function mergeActions(
  script: ScriptKind,
  ctx: TwinContext,
  generated: TwinAction[],
  fallback: TwinAction[],
): TwinAction[] {
  const phase = detectPhase(script, ctx);
  const actions = [...generated];

  if (script === "sql-reviewer" && phase === "review" && !actions.some((a) => a.type === "artifact")) {
    const artifact = fallback.find((a) => a.type === "artifact");
    if (artifact) actions.push(artifact);
  }

  if (script === "planner" && phase === "accept" && !actions.some((a) => a.type === "request_resolve")) {
    actions.push({ type: "request_resolve", body: "Requesting human approval to resolve." });
  }

  return actions.length ? actions : fallback;
}
