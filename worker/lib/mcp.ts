import type { Registry } from "../durable-objects/registry";
import type { Env } from "../types";
import { DEMO_ORG_ID } from "../types";
import { toPublicAgent } from "./card";
import { embedText } from "./embeddings";
import { json, parseTags, readJson } from "./http";

interface JsonRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: "twinmeet_discover",
    description: "Rank Digital Twins by intent and tags (hybrid BM25 + embeddings).",
    inputSchema: {
      type: "object",
      properties: {
        intent: { type: "string" },
        tags: { type: "string", description: "Comma-separated tags" },
      },
      required: ["intent"],
    },
  },
  {
    name: "twinmeet_list_agents",
    description: "List registered twins and their charters.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "twinmeet_propose_meeting",
    description: "Propose a meeting between two twins.",
    inputSchema: {
      type: "object",
      properties: {
        requesterId: { type: "string" },
        inviteeId: { type: "string" },
        intent: { type: "string" },
        body: { type: "string" },
        tags: { type: "string" },
      },
      required: ["requesterId", "inviteeId", "intent"],
    },
  },
  {
    name: "twinmeet_room_snapshot",
    description: "Read a room transcript, votes, speaker graph, and artifacts.",
    inputSchema: {
      type: "object",
      properties: { roomId: { type: "string" } },
      required: ["roomId"],
    },
  },
  {
    name: "twinmeet_post_message",
    description: "Post a human chat message into a room.",
    inputSchema: {
      type: "object",
      properties: { roomId: { type: "string" }, body: { type: "string" } },
      required: ["roomId", "body"],
    },
  },
  {
    name: "twinmeet_approve",
    description: "Approve or reject a pending resolve gate.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: { type: "string" },
        decision: { type: "string", enum: ["approve", "reject"] },
      },
      required: ["roomId"],
    },
  },
  {
    name: "twinmeet_vote",
    description: "Cast a room vote on an artifact or resolve.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: { type: "string" },
        subject: { type: "string", enum: ["artifact", "resolve"] },
        decision: { type: "string", enum: ["approve", "reject"] },
      },
      required: ["roomId"],
    },
  },
  {
    name: "twinmeet_memory",
    description: "Search org memory from resolved meetings.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
    },
  },
];

export async function handleMcp(
  request: Request,
  env: Env,
  registry: DurableObjectStub<Registry>,
  orgId = DEMO_ORG_ID,
): Promise<Response> {
  if (request.method === "GET") {
    return json({
      protocolVersion: "2025-03-26",
      serverInfo: { name: "twinmeet", version: "1.0.0" },
      tools: TOOLS,
    });
  }
  const rpc = await readJson<JsonRpc>(request);
  const id = rpc.id ?? null;
  const method = rpc.method || "";
  const params = rpc.params ?? {};

  try {
    const result = await dispatchMcp(method, params, registry, env, orgId);
    return json({ jsonrpc: "2.0", id, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "MCP error";
    return json({ jsonrpc: "2.0", id, error: { code: -32603, message } }, 200);
  }
}

async function dispatchMcp(
  method: string,
  params: Record<string, unknown>,
  registry: DurableObjectStub<Registry>,
  env: Env,
  orgId: string,
): Promise<unknown> {
  if (method === "initialize" || method === "notifications/initialized") {
    return {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "twinmeet", version: "1.0.0" },
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOLS };
  if (method === "resources/list") return { resources: [] };
  if (method === "tools/call") {
    const name = String(params.name ?? "");
    const args = isRecord(params.arguments) ? params.arguments : params;
    const text = await callTool(name, args, registry, env, orgId);
    return { content: [{ type: "text", text }] };
  }
  throw new Error(`Unknown MCP method: ${method || "(missing)"}`);
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  registry: DurableObjectStub<Registry>,
  env: Env,
  orgId: string,
): Promise<string> {
  if (name === "twinmeet_discover") {
    const intent = String(args.intent ?? "");
    const tags = parseTags(String(args.tags ?? ""));
    const embedding = intent && env.GEMINI_API_KEY ? await embedText(env.GEMINI_API_KEY, intent) : null;
    const results = await registry.discover(intent, tags, embedding, orgId);
    return JSON.stringify(
      results.map((hit) => ({ ...hit, agent: toPublicAgent(hit.agent) })),
      null,
      2,
    );
  }
  if (name === "twinmeet_list_agents") {
    const agents = (await registry.listAgents(orgId)).map(toPublicAgent);
    return JSON.stringify(agents, null, 2);
  }
  if (name === "twinmeet_propose_meeting") {
    const meeting = await registry.proposeMeeting({
      requesterId: String(args.requesterId ?? ""),
      inviteeId: String(args.inviteeId ?? ""),
      orgId,
      intent: String(args.intent ?? ""),
      body: typeof args.body === "string" ? args.body : "",
      tags: parseTags(typeof args.tags === "string" ? args.tags : ""),
    });
    return JSON.stringify(meeting, null, 2);
  }
  if (name === "twinmeet_room_snapshot") {
    const roomId = String(args.roomId ?? "");
    const stub = env.ROOM.getByName(roomId) as unknown as { getSnapshot(): Promise<unknown> };
    return JSON.stringify(await stub.getSnapshot(), null, 2);
  }
  if (name === "twinmeet_post_message") {
    const roomId = String(args.roomId ?? "");
    const stub = env.ROOM.getByName(roomId) as unknown as {
      postMessage(input: { authorId: string; authorName: string; type: "chat"; body: string }): Promise<unknown>;
    };
    const message = await stub.postMessage({
      authorId: "human",
      authorName: "Human",
      type: "chat",
      body: String(args.body ?? ""),
    });
    return JSON.stringify(message, null, 2);
  }
  if (name === "twinmeet_approve") {
    const roomId = String(args.roomId ?? "");
    const decision = args.decision === "reject" ? "reject" : "approve";
    const stub = env.ROOM.getByName(roomId) as unknown as {
      approve(actorId: string, decision: "approve" | "reject"): Promise<unknown>;
    };
    return JSON.stringify(await stub.approve("human", decision), null, 2);
  }
  if (name === "twinmeet_vote") {
    const roomId = String(args.roomId ?? "");
    const stub = env.ROOM.getByName(roomId) as unknown as {
      vote(voterId: string, subject: "artifact" | "resolve", decision: "approve" | "reject"): Promise<unknown>;
    };
    return JSON.stringify(
      await stub.vote(
        "human",
        args.subject === "resolve" ? "resolve" : "artifact",
        args.decision === "reject" ? "reject" : "approve",
      ),
      null,
      2,
    );
  }
  if (name === "twinmeet_memory") {
    const query = String(args.query ?? "");
    const embedding = query && env.GEMINI_API_KEY ? await embedText(env.GEMINI_API_KEY, query) : null;
    return JSON.stringify(await registry.listMemory(orgId, embedding), null, 2);
  }
  throw new Error(`Unknown tool: ${name}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
