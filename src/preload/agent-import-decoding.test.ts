// @vitest-environment node

import {
  decodeAgentImportResult,
  decodeInstanceTransferResult,
  decodeRemoteInstanceTransferResult,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";

// The preload decodes these results with the same contracts decoders. A remote import or transfer
// lists the host's agents, and a newer host can run an agent on a provider that this OpenBot does not
// know. The host has already done the import, so the result must still decode.

const AGENT = {
  id: "agent-1",
  name: "Ada",
  title: "Researcher",
  description: "",
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  notifications: true,
  threadId: null,
  workspacePath: "/Users/ada/OpenBot/Agents/Ada",
  preview: "",
  updatedAt: null,
  avatarSeed: "agent-1",
  avatarHue: null,
  avatarUrl: null,
};

const FOREIGN_AGENT = { ...AGENT, id: "agent-2", provider: "omp", model: "omp/default" };

const IMPORT_RESULT = { skipped: [], channels: [], skippedChannels: [], warnings: [] };
const TRANSFER_RESULT = { skipped: [], signIn: [], warnings: [] };

describe("agent import result decoding", () => {
  it("keeps an agent on a provider that this build does not know", () => {
    const result = decodeAgentImportResult({ ...IMPORT_RESULT, agents: [AGENT, FOREIGN_AGENT] });
    expect(result.agents.map((agent) => agent.provider)).toEqual(["codex", "omp"]);
  });

  it("rejects an agent whose provider is not a provider id", () => {
    expect(() => decodeAgentImportResult({ ...IMPORT_RESULT, agents: [{ ...AGENT, provider: "Not An Id" }] })).toThrow(
      "Invalid import result.",
    );
  });
});

describe("instance transfer result decoding", () => {
  it("keeps an agent on a provider that this build does not know", () => {
    const result = decodeInstanceTransferResult({ ...TRANSFER_RESULT, agents: [AGENT, FOREIGN_AGENT] });
    expect(result.agents.map((agent) => agent.provider)).toEqual(["codex", "omp"]);
  });

  it("rejects an agent whose provider is not a provider id", () => {
    expect(() =>
      decodeInstanceTransferResult({ ...TRANSFER_RESULT, agents: [{ ...AGENT, provider: "Not An Id" }] }),
    ).toThrow("Invalid transfer result.");
  });

  it("keeps a local sign-in list closed", () => {
    expect(() => decodeInstanceTransferResult({ ...TRANSFER_RESULT, agents: [], signIn: ["omp"] })).toThrow(
      "Invalid transfer result.",
    );
  });

  it("keeps only the remote sign-ins that this build can start", () => {
    const result = decodeRemoteInstanceTransferResult({
      ...TRANSFER_RESULT,
      agents: [{ agentId: "agent-2", name: "Ada" }],
      signIn: ["claude", "omp"],
    });
    expect(result.signIn).toEqual(["claude"]);
  });

  it("rejects a remote sign-in that is not a provider id", () => {
    expect(() =>
      decodeRemoteInstanceTransferResult({ ...TRANSFER_RESULT, agents: [], signIn: ["claude", "Not An Id"] }),
    ).toThrow("Invalid transfer result.");
  });
});
