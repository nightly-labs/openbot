import type { AgentModelOption, AgentStatus, AttachmentSummary, ConversationPage } from "@openbot/contracts/ipc";
import { TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { STORY_AGENT_STATUS, STORY_AGENT_SUMMARIES } from "../../preview/fixtures";
import { WebAgentSettings } from "./WebAgentSettings";
import type { WebWorkspaceRuntime } from "./web-runtime";

const EMPTY_PAGE: ConversationPage = {
  agentId: "agent",
  threadId: "thread",
  activeTurnId: null,
  revision: 1,
  messages: [],
  references: {},
  pageInfo: { hasOlder: false, olderCursor: null },
};

function model(id: string, name: string): AgentModelOption {
  return {
    provider: "codex",
    id,
    name,
    description: name,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  };
}

function runtimeFixture(
  overrides: {
    models?: () => Promise<AgentModelOption[]>;
    status?: () => Promise<AgentStatus>;
    createAgent?: WebWorkspaceRuntime["createAgent"];
  } = {},
) {
  const defaultAgent = STORY_AGENT_SUMMARIES[0];
  if (!defaultAgent) throw new Error("The fixture needs one agent.");
  const models = vi.fn(overrides.models ?? (async () => []));
  const status = vi.fn(overrides.status ?? (async () => STORY_AGENT_STATUS));
  const createAgent = vi.fn(overrides.createAgent ?? (async () => defaultAgent));
  const runtime: WebWorkspaceRuntime = {
    browser: {
      startLiveView: async () => {},
      stopLiveView: async () => {},
      sendLiveViewInput: async () => {},
      onLiveViewEvent: () => () => {},
    },
    browserTabs: async () => [],
    respondToTakeover: async () => {},
    listHosts: async () => [],
    previewInvite: async () => {
      throw new Error("unused");
    },
    acceptInvite: async () => {
      throw new Error("unused");
    },
    connect: async () => [],
    disconnect: async () => {},
    listAgents: async () => [],
    conversation: async () => EMPTY_PAGE,
    send: async () => {},
    stop: async () => {},
    approve: async () => {},
    answer: async () => {},
    upload: async (): Promise<AttachmentSummary> => {
      throw new Error("unused");
    },
    cancelUpload: async () => {},
    discard: async () => {},
    download: async () => ({ name: "unused", mimeType: "text/plain", base64: "" }),
    react: async () => {},
    setAvatar: async () => {},
    models,
    status,
    createAgent,
    duplicateAgent: async () => {
      throw new Error("unused");
    },
    updateAgent: async () => {},
    deleteAgent: async () => {},
    search: async () => ({ results: [], total: 0, nextCursor: null }),
    dispose: async () => {},
  };
  return { runtime, models, status, createAgent };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("WebAgentSettings", () => {
  it("does not load or send model controls when the host does not advertise them", async () => {
    const fixture = runtimeFixture();
    const onSaved = vi.fn(async () => {});
    const onClose = vi.fn();
    render(() => <WebAgentSettings runtime={fixture.runtime} capabilities={[]} onSaved={onSaved} onClose={onClose} />);

    expect(fixture.models).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Agent model:/ })).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await waitFor(() => expect(fixture.createAgent).toHaveBeenCalledOnce());
    expect(fixture.createAgent).toHaveBeenCalledWith({
      name: "New agent",
      description: "",
      initialMessage: "Greet me briefly.",
      avatarSeed: expect.any(String),
      avatarHue: null,
    });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not allow a duplicate after the host confirms creation but refresh fails", async () => {
    const fixture = runtimeFixture();
    const onSaved = vi.fn(async () => {
      throw new Error("refresh failed");
    });
    render(() => <WebAgentSettings runtime={fixture.runtime} capabilities={[]} onSaved={onSaved} onClose={() => {}} />);

    await fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The agent was created, but the workspace could not refresh. Reload before trying again.",
    );
    await fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    expect(fixture.createAgent).toHaveBeenCalledOnce();
  });

  it("ignores model results from a host that is no longer selected", async () => {
    const first = deferred<AgentModelOption[]>();
    const second = deferred<AgentModelOption[]>();
    const fixture = runtimeFixture({
      models: vi
        .fn<() => Promise<AgentModelOption[]>>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    });
    const [capabilities, setCapabilities] = createSignal<string[]>([TEAM_AGENT_CREATE_MODEL_CAPABILITY]);
    render(() => (
      <WebAgentSettings
        runtime={fixture.runtime}
        capabilities={capabilities()}
        onSaved={async () => {}}
        onClose={() => {}}
      />
    ));

    await waitFor(() => expect(fixture.models).toHaveBeenCalledOnce());
    setCapabilities([]);
    await Promise.resolve();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Agent model:/ })).toBeNull());
    setCapabilities([TEAM_AGENT_CREATE_MODEL_CAPABILITY]);
    await waitFor(() => expect(fixture.models).toHaveBeenCalledTimes(2));

    second.resolve([model("new-model", "New model")]);
    await screen.findByRole("button", { name: "Agent model: New model" });
    first.resolve([model("old-model", "Old model")]);
    await Promise.resolve();

    expect(screen.getByRole("button", { name: "Agent model: New model" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agent model: Old model" })).toBeNull();
  });
});
