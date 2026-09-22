import type { Registry } from "../durable-objects/registry";
import type { A2AAgentCard, Env } from "../types";
import { DEMO_ORG_ID, PLANNER_ID } from "../types";
import { toAgentCard } from "./card";
import { embedText } from "./embeddings";
import { json, newId, readJson } from "./http";

interface JsonRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export function platformCard(origin: string): A2AAgentCard {
  return {
    name: "TwinMeet",
    description: "Rooms + registry for Digital Twins. MCP=tools, A2A=peers, TwinMeet=rooms+registry.",
    supportedInterfaces: [
      {
        url: `${origin}/v1/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: "0.3.0",
      },
      {
        url: `${origin}/v1/mcp`,
        protocolBinding: "JSONRPC",
        protocolVersion: "2025-03-26",
      },
    ],
    provider: { organization: "TwinMeet", url: origin },
    version: "1.0.0",
    documentationUrl: `${origin}/METHOD.md`,
    capabilities: {
      streaming: true,
      pushNotifications: true,
      extendedAgentCard: true,
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "discover",
        name: "Discover peers",
        description: "Rank twins by intent, tags, and embeddings.",
        tags: ["discover", "registry"],
      },
      {
        id: "meet",
        name: "Propose a meeting",
        description: "Create a MeetingRequest from an A2A message. Accept is a separate consent step.",
        tags: ["room", "meeting"],
      },
    ],
  };
}

export async function handleA2A(
  request: Request,
  env: Env,
  registry: DurableObjectStub<Registry>,
  origin: string,
  orgId = DEMO_ORG_ID,
): Promise<Response> {
  if (request.method === "GET") {
    return json(platformCard(origin));
  }
  const rpc = await readJson<JsonRpc>(request);
  const id = rpc.id ?? null;
  const method = rpc.method || "";
  const params = rpc.params ?? {};

  try {
    const result = await dispatchA2A(method, params, registry, origin, env, orgId);
    return json({ jsonrpc: "2.0", id, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "A2A error";
    return json({ jsonrpc: "2.0", id, error: { code: -32603, message } }, 200);
  }
}

async function dispatchA2A(
  method: string,
  params: Record<string, unknown>,
  registry: DurableObjectStub<Registry>,
  origin: string,
  env: Env,
  orgId: string,
): Promise<unknown> {
  if (method === "agent/getAuthenticatedExtendedCard" || method === "agent/card") {
    const agentId = typeof params.agentId === "string" ? params.agentId : "";
    if (agentId) {
      const agent = await registry.getAgent(agentId);
      if (!agent) throw new Error("Agent not found");
      const caps = await registry.listCapabilities(agent.id);
      return toAgentCard(agent, caps, origin);
    }
    return platformCard(origin);
  }

  if (method === "message/send" || method === "tasks/send") {
    const text = extractText(params);
    const agentId = typeof params.agentId === "string" ? params.agentId : null;
    const taskId = await registry.saveTask(orgId, agentId, {
      method,
      text,
      params,
      publicUrl: env.PUBLIC_URL || origin,
    });
    const embedding = text && env.GEMINI_API_KEY ? await embedText(env.GEMINI_API_KEY, text) : null;
    const results = text ? await registry.discover(text, [], embedding, orgId) : [];
    let meeting = null;
    if (params.meet === true && results[0]) {
      const requesterId = typeof params.requesterId === "string" ? params.requesterId : PLANNER_ID;
      const inviteeId = typeof params.inviteeId === "string" ? params.inviteeId : results[0].agent.id;
      meeting = await registry.proposeMeeting({
        requesterId,
        inviteeId,
        orgId,
        intent: text || results[0].agent.purpose,
        body: typeof params.body === "string" ? params.body : "",
        tags: results[0].matchedTags,
      });
    }
    const payload = {
      text,
      results: results.map((hit) => ({
        agentId: hit.agent.id,
        name: hit.agent.name,
        score: hit.score,
        matchedTags: hit.matchedTags,
      })),
      meeting,
    };
    await registry.updateTask(taskId, "completed", payload);
    return {
      id: taskId,
      contextId: newId("ctx"),
      status: { state: "completed", timestamp: new Date().toISOString() },
      kind: "task",
      artifacts: [
        {
          name: "discover",
          parts: [{ kind: "data", data: payload }],
        },
      ],
      history: text ? [{ role: "user", parts: [{ kind: "text", text }] }] : [],
    };
  }

  if (method === "tasks/get") {
    const taskId = String(params.id ?? params.taskId ?? "");
    const task = (await registry.getTask(taskId)) as { id: string; status: string; payload: unknown } | null;
    if (!task) throw new Error("Task not found");
    return { id: task.id, status: { state: task.status }, kind: "task", payload: task.payload };
  }

  if (method === "tasks/list") {
    return { tasks: await registry.listTasks(orgId) };
  }

  if (method === "tasks/cancel") {
    const taskId = String(params.id ?? params.taskId ?? "");
    const task = (await registry.getTask(taskId)) as { id: string; status: string; payload: unknown } | null;
    if (!task) throw new Error("Task not found");
    await registry.updateTask(taskId, "canceled");
    return { id: task.id, status: { state: "canceled" }, kind: "task" };
  }

  throw new Error(`Unknown A2A method: ${method || "(missing)"}`);
}

function extractText(params: Record<string, unknown>): string {
  const message = isRecord(params.message) ? params.message : params;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const texts = parts
    .map((p) => (isRecord(p) ? String(p.text ?? p.content ?? "") : ""))
    .filter(Boolean);
  if (texts.length) return texts.join("\n");
  if (typeof message.text === "string") return message.text;
  if (typeof params.text === "string") return params.text;
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
