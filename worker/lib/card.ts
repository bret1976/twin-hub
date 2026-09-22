import type { A2AAgentCard, AgentRecord, CapabilityRecord } from "../types";

export function toPublicAgent(agent: AgentRecord): AgentRecord {
  return { ...agent, callbackSecret: null };
}

export function toAgentCard(
  agent: AgentRecord,
  capabilities: CapabilityRecord[],
  origin: string,
): A2AAgentCard {
  const url = `${origin}/v1/agents/${agent.id}`;
  return {
    name: agent.name,
    description: agent.description,
    supportedInterfaces: [
      {
        url,
        protocolBinding: "HTTP+JSON",
        protocolVersion: "1.0",
        tenant: agent.id,
      },
    ],
    provider: {
      organization: "TwinMeet",
      url: origin,
    },
    version: agent.version,
    documentationUrl: `${origin}/METHOD.md`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: capabilities.map((cap) => ({
      id: cap.skillId,
      name: cap.name,
      description: cap.description,
      tags: cap.tags,
      examples: cap.examples,
      inputModes: ["text/plain", "application/json"],
      outputModes: ["text/plain", "application/json"],
    })),
  };
}
