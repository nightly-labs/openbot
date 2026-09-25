import type { ManagedProviderId } from "@openbot/contracts/agent-providers";
import type {
  AgentProviderId,
  AgentStatus,
  CustomProviderRestart,
  CustomProviderSummary,
  ProviderRuntimeStatus,
  SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import { Toaster, toast } from "@openbot/ui";
import type { ProviderCodeLoginState } from "@openbot/ui/components/ProviderCodeLoginDialog";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORY_AGENT_STATUS } from "../../preview/fixtures";
import { createMockOpenBot, type MockOpenBotControls } from "../../preview/mock-openbot";
import { OnboardingFlow } from "./OnboardingFlow";

let activeMock: MockOpenBotControls | undefined;
const previousApi = window.openbot;

afterEach(() => {
  activeMock?.dispose();
  activeMock = undefined;
  window.openbot = previousApi;
  toast.dismiss();
  vi.restoreAllMocks();
});

function renderFlow(
  options: { onSave?: (provider: AgentProviderId) => Promise<void>; platform?: "darwin" | "win32" | "linux" } = {},
) {
  activeMock = createMockOpenBot();
  window.openbot = activeMock.api;
  const view = render(() => (
    <>
      <OnboardingFlow
        state={{ completed: false, preferredProvider: null, preferredModel: null }}
        agentStatus={STORY_AGENT_STATUS}
        platform={options.platform ?? "darwin"}
        onSave={options.onSave ?? (async (_provider: AgentProviderId) => undefined)}
      />
      <Toaster />
    </>
  ));
  return view;
}

/** A custom endpoint is offered only while OpenCode can run it, and the fixture names no OpenCode. */
const AGENT_STATUS_WITH_OPENCODE: AgentStatus = {
  ...STORY_AGENT_STATUS,
  providers: [
    ...(STORY_AGENT_STATUS.providers ?? []),
    { id: "opencode", state: "available", version: "1.18.27", message: null, email: null },
  ],
};

describe("OnboardingFlow", () => {
  it("supports provider selection and forward/back navigation", async () => {
    const view = renderFlow();
    const providers = view.getByRole("radiogroup", { name: "Default provider" });
    expect(within(providers).getByRole("radio", { name: /Grok/ })).toBeInTheDocument();
    const claude = within(providers).getByRole("radio", { name: /Claude/ });
    await fireEvent.click(claude);
    await fireEvent.click(view.getByRole("button", { name: "Next" }));

    expect(await view.findByRole("heading", { name: "OpenBot might control your computer" })).toBeInTheDocument();
    await fireEvent.click(view.getByRole("button", { name: "Back" }));
    expect(await view.findByRole("heading", { name: "Meet OpenBot" })).toBeInTheDocument();
    expect(claude).toBeChecked();
  });

  it("persists Grok as the default provider", async () => {
    const onSave = vi.fn(async (_provider: AgentProviderId) => undefined);
    const view = renderFlow({ onSave });
    const providers = view.getByRole("radiogroup", { name: "Default provider" });
    await fireEvent.click(within(providers).getByRole("radio", { name: /Grok/ }));
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Open OpenBot" }));

    // A built-in provider records no model: it keeps its own default.
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("grok", null));
  });

  it("requests optional macOS permissions before continuing", async () => {
    const view = renderFlow();
    const openPermission = vi.spyOn((activeMock?.api ?? window.openbot).computerUse, "openPermissionPane");
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    expect(await view.findByRole("heading", { name: "OpenBot might control your computer" })).toBeInTheDocument();
    await waitFor(() => expect(view.getByRole("button", { name: "Grant Screen Recording" })).toBeInTheDocument());
    expect(view.getByRole("button", { name: "Grant Accessibility" })).toBeInTheDocument();

    await fireEvent.click(view.getByRole("button", { name: "Grant Screen Recording" }));
    await waitFor(() => expect(openPermission).toHaveBeenCalledWith("screen-recording"));

    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    expect(await view.findByRole("heading", { name: "Give each agent a job" })).toBeInTheDocument();
  });

  it("keeps onboarding open when saving setup fails", async () => {
    const onSave = vi.fn(async (_provider: AgentProviderId) => {
      throw new Error("Setup failed.");
    });
    const view = renderFlow({ onSave });
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Open OpenBot" }));

    expect(await view.findByRole("alert")).toHaveTextContent("Setup failed.");
    expect(view.getByRole("heading", { name: "Give each agent a job" })).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledWith("codex", null);
  });

  it("counts a saved endpoint in the custom row and selects that row after the save", async () => {
    activeMock = createMockOpenBot();
    window.openbot = activeMock.api;
    const [customProviders, setCustomProviders] = createSignal<CustomProviderSummary[]>([]);
    const onAddCustomProvider = vi.fn(async (value: SaveCustomProviderInput): Promise<CustomProviderRestart> => {
      setCustomProviders((current) => [
        ...current,
        { id: value.id, name: value.name, baseUrl: value.baseUrl, hasApiKey: false, models: value.models },
      ]);
      return "restarted";
    });
    const onSave = vi.fn(async (_provider: AgentProviderId) => undefined);
    const view = render(() => (
      <OnboardingFlow
        state={{ completed: false, preferredProvider: null, preferredModel: null }}
        agentStatus={AGENT_STATUS_WITH_OPENCODE}
        platform="darwin"
        onSave={onSave}
        onAddCustomProvider={onAddCustomProvider}
        customProviders={customProviders()}
      />
    ));

    await fireEvent.click(view.getByRole("button", { name: "Add custom provider" }));
    // A required field appends an aria-hidden asterisk to its label, so its name is not an exact match.
    await fireEvent.input(await screen.findByLabelText(/^Provider ID/u), { target: { value: "studio-local" } });
    await fireEvent.input(screen.getByLabelText(/^Display name/u), { target: { value: "Studio Local" } });
    await fireEvent.input(screen.getByLabelText(/^Base URL/u), { target: { value: "http://127.0.0.1:11434/v1" } });
    await fireEvent.input(screen.getByLabelText("Model 1 ID"), { target: { value: "glm-5-air" } });
    await fireEvent.input(screen.getByLabelText("Model 1 display name"), { target: { value: "GLM 5 Air" } });
    await fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    const providers = () => view.getByRole("radiogroup", { name: "Default provider" });
    const custom = await waitFor(() => within(providers()).getByRole("radio", { name: /Custom provider/ }));
    expect(custom).toBeChecked();
    // The count is beside Add, outside the radio: it is the button that opens the saved endpoints.
    expect(view.getByRole("button", { name: "Manage 1 endpoint" })).toBeInTheDocument();

    // Setup records the provider that runs the endpoint, plus the endpoint's own first model, which
    // is what makes it the model a new agent starts on: the provider alone cannot name it.
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Open OpenBot" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("opencode", "studio-local/glm-5-air"));
  });

  // The model belongs to the endpoint. Once the endpoint is gone the step must not store its model
  // on the first agent, which would start that agent on a provider that cannot answer.
  it("drops the endpoint's model from setup after the endpoint is removed", async () => {
    activeMock = createMockOpenBot();
    window.openbot = activeMock.api;
    // A second endpoint stays behind, so the custom row keeps the choice and only the model of the
    // removed endpoint can explain an empty model in setup.
    const [customProviders, setCustomProviders] = createSignal<CustomProviderSummary[]>([
      {
        id: "house-router",
        name: "House Router",
        baseUrl: "https://models.example.com/v1",
        hasApiKey: true,
        models: [{ id: "gpt-oss-120b", name: "GPT OSS 120B" }],
      },
    ]);
    const onAddCustomProvider = vi.fn(async (value: SaveCustomProviderInput): Promise<CustomProviderRestart> => {
      setCustomProviders((current) => [
        ...current,
        { id: value.id, name: value.name, baseUrl: value.baseUrl, hasApiKey: false, models: value.models },
      ]);
      return "restarted";
    });
    const onDeleteCustomProvider = vi.fn(async (id: string): Promise<CustomProviderRestart> => {
      setCustomProviders((current) => current.filter((provider) => provider.id !== id));
      return "restarted";
    });
    const onSave = vi.fn(async (_provider: AgentProviderId) => undefined);
    const view = render(() => (
      <OnboardingFlow
        state={{ completed: false, preferredProvider: null, preferredModel: null }}
        agentStatus={AGENT_STATUS_WITH_OPENCODE}
        platform="darwin"
        onSave={onSave}
        onAddCustomProvider={onAddCustomProvider}
        onDeleteCustomProvider={onDeleteCustomProvider}
        customProviders={customProviders()}
      />
    ));

    await fireEvent.click(view.getByRole("button", { name: "Add custom provider" }));
    await fireEvent.input(await screen.findByLabelText(/^Provider ID/u), { target: { value: "studio-local" } });
    await fireEvent.input(screen.getByLabelText(/^Display name/u), { target: { value: "Studio Local" } });
    await fireEvent.input(screen.getByLabelText(/^Base URL/u), { target: { value: "http://127.0.0.1:11434/v1" } });
    await fireEvent.input(screen.getByLabelText("Model 1 ID"), { target: { value: "glm-5-air" } });
    await fireEvent.input(screen.getByLabelText("Model 1 display name"), { target: { value: "GLM 5 Air" } });
    await fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await fireEvent.click(await view.findByRole("button", { name: "Manage 2 endpoints" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Delete Studio Local" }));
    const confirmation = await screen.findByRole("alertdialog", { name: "Remove Studio Local?" });
    await fireEvent.click(within(confirmation).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(onDeleteCustomProvider).toHaveBeenCalledWith("studio-local"));
    // The dialog stays open on what is left, so it is closed by hand before the step goes on.
    expect(await screen.findByRole("button", { name: "Delete House Router" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument());
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Open OpenBot" }));
    // The removed endpoint's model is gone from setup; the endpoint still saved supplies the model
    // instead, because the custom row is still the choice and a choice with no model would start the
    // first agent on a hosted one.
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("opencode", "house-router/gpt-oss-120b"));
  });

  // An endpoint saved in an earlier run is the common case: the user restarts, opens onboarding and
  // selects Custom without touching the dialog. Nothing in this component has seen its models, so
  // the model has to come from the list main sends.
  it("records a model of an endpoint saved before this screen opened", async () => {
    activeMock = createMockOpenBot();
    window.openbot = activeMock.api;
    const onSave = vi.fn(async (_provider: AgentProviderId) => undefined);
    const view = render(() => (
      <OnboardingFlow
        state={{ completed: false, preferredProvider: null, preferredModel: null }}
        agentStatus={AGENT_STATUS_WITH_OPENCODE}
        platform="darwin"
        onSave={onSave}
        onAddCustomProvider={async () => "restarted"}
        customProviders={[
          {
            id: "house-router",
            name: "House Router",
            baseUrl: "https://models.example.com/v1",
            hasApiKey: true,
            models: [{ id: "gpt-oss-120b", name: "GPT OSS 120B" }],
          },
        ]}
      />
    ));

    const providers = view.getByRole("radiogroup", { name: "Default provider" });
    await fireEvent.click(within(providers).getByRole("radio", { name: /Custom provider/ }));
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Open OpenBot" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("opencode", "house-router/gpt-oss-120b"));
  });

  it("keeps provider downloads independent and blocks Next until the selected provider connects", async () => {
    activeMock = createMockOpenBot();
    window.openbot = activeMock.api;
    const initialAgentStatus: AgentStatus = {
      ...STORY_AGENT_STATUS,
      providers: STORY_AGENT_STATUS.providers?.map((provider) => ({
        ...provider,
        state: "not-installed",
        connectionState: undefined,
        message: null,
      })),
    };
    const initialRuntimeStatuses: Record<ManagedProviderId, ProviderRuntimeStatus> = {
      codex: { phase: "not-downloaded", progress: null, message: null, version: null },
      claude: { phase: "not-downloaded", progress: null, message: null, version: null },
      grok: { phase: "not-downloaded", progress: null, message: null, version: null },
      opencode: { phase: "not-downloaded", progress: null, message: null, version: null },
    };
    const [agentStatus, setAgentStatus] = createSignal(initialAgentStatus);
    const [runtimeStatuses, setRuntimeStatuses] = createSignal(initialRuntimeStatuses);
    const onDownloadProvider = vi.fn((provider: AgentProviderId) => {
      setRuntimeStatuses((current) => ({
        ...current,
        [provider]: { phase: "downloading", progress: 20, message: null, version: null },
      }));
    });
    const onCancelProviderDownload = vi.fn((provider: AgentProviderId) => {
      setRuntimeStatuses((current) => ({
        ...current,
        [provider]: { phase: "not-downloaded", progress: null, message: null, version: null },
      }));
    });
    const onConnectProvider = vi.fn((provider: AgentProviderId) => {
      setAgentStatus((current) => ({
        ...current,
        providers: current.providers?.map((candidate) =>
          candidate.id === provider ? { ...candidate, state: "available", connectionState: undefined } : candidate,
        ),
      }));
    });
    const view = render(() => (
      <OnboardingFlow
        state={{ completed: false, preferredProvider: null, preferredModel: null }}
        agentStatus={agentStatus()}
        platform="darwin"
        providerRuntimeStatuses={runtimeStatuses()}
        onDownloadProvider={onDownloadProvider}
        onCancelProviderDownload={onCancelProviderDownload}
        onConnectProvider={onConnectProvider}
        onSave={async () => undefined}
      />
    ));

    expect(view.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    await fireEvent.click(view.getByRole("button", { name: "Download Grok" }));
    expect(
      within(view.getByRole("radiogroup", { name: "Default provider" })).getByRole("radio", { name: /Grok/ }),
    ).toBeChecked();
    expect(onDownloadProvider).toHaveBeenCalledWith("grok");

    await fireEvent.click(view.getByRole("button", { name: "Download Claude" }));
    await fireEvent.click(view.getByRole("button", { name: "Cancel Grok" }));
    expect(onCancelProviderDownload).toHaveBeenCalledWith("grok");
    expect(view.getByRole("button", { name: "Cancel Claude" })).toBeEnabled();
    expect(view.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();

    setRuntimeStatuses((current) => ({
      ...current,
      claude: { phase: "ready", progress: 100, message: null, version: "2.1.246" },
    }));
    await fireEvent.click(await view.findByRole("button", { name: "Connect Claude" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Next" })).toBeEnabled());
    await fireEvent.click(view.getByRole("button", { name: "Reconnect Claude" }));
    expect(onConnectProvider).toHaveBeenCalledTimes(2);
  });

  it("keeps the downloads reachable while the local providers are still being checked", async () => {
    activeMock = createMockOpenBot();
    window.openbot = activeMock.api;
    // What a first run looks like before main answers: nothing downloaded, no provider checked yet,
    // and the agent runtime still starting. Every action on the screen used to be disabled here,
    // with nothing to press and nothing said, which is the state reported in issue #643.
    const agentStatus: AgentStatus = {
      ...STORY_AGENT_STATUS,
      phase: "starting",
      providers: (STORY_AGENT_STATUS.providers ?? []).map((provider) => ({
        ...provider,
        state: "not-started",
        version: null,
        email: null,
        message: null,
      })),
    };
    const runtimeStatuses: Record<ManagedProviderId, ProviderRuntimeStatus> = {
      codex: { phase: "not-downloaded", progress: null, message: null, version: null },
      claude: { phase: "not-downloaded", progress: null, message: null, version: null },
      grok: { phase: "not-downloaded", progress: null, message: null, version: null },
      opencode: { phase: "not-downloaded", progress: null, message: null, version: null },
    };
    const onDownloadProvider = vi.fn();
    const view = render(() => (
      <>
        <OnboardingFlow
          state={{ completed: false, preferredProvider: null, preferredModel: null }}
          agentStatus={agentStatus}
          platform="darwin"
          refreshingProviders
          providerRuntimeStatuses={runtimeStatuses}
          onDownloadProvider={onDownloadProvider}
          onCancelProviderDownload={vi.fn()}
          onConnectProvider={vi.fn()}
          onSave={async () => undefined}
        />
        <Toaster />
      </>
    ));

    const download = view.getByRole("button", { name: "Download ChatGPT" });
    expect(download).toBeEnabled();
    await fireEvent.click(download);
    expect(onDownloadProvider).toHaveBeenCalledWith("codex");

    // The main button stays pressable and says what it is waiting for, rather than leaving the
    // screen to be read as broken.
    await fireEvent.click(view.getByRole("button", { name: "Connect" }));
    expect(await view.findAllByText("Download ChatGPT to continue.")).toHaveLength(2);
  });

  it("connects the selected provider from the main button and says so", async () => {
    activeMock = createMockOpenBot();
    window.openbot = activeMock.api;
    const agentStatus: AgentStatus = {
      ...STORY_AGENT_STATUS,
      providers: (STORY_AGENT_STATUS.providers ?? []).map((provider) => ({
        ...provider,
        state: "sign-in-required",
        message: null,
      })),
    };
    const onConnectProvider = vi.fn();
    const view = render(() => (
      <>
        <OnboardingFlow
          state={{ completed: false, preferredProvider: null, preferredModel: null }}
          agentStatus={agentStatus}
          platform="darwin"
          onConnectProvider={onConnectProvider}
          onSave={async () => undefined}
        />
        <Toaster />
      </>
    ));

    await fireEvent.click(
      within(view.getByRole("radiogroup", { name: "Default provider" })).getByRole("radio", { name: /ChatGPT/ }),
    );
    await fireEvent.click(view.getByRole("button", { name: "Connect" }));
    expect(onConnectProvider).toHaveBeenCalledWith("codex");
    expect(
      await view.findByText("Connecting ChatGPT. Finish the sign-in if a browser window opens."),
    ).toBeInTheDocument();
  });

  it("continues with downloaded OpenCode free models without a sign-in", async () => {
    activeMock = createMockOpenBot();
    window.openbot = activeMock.api;
    const agentStatus: AgentStatus = {
      ...STORY_AGENT_STATUS,
      providers: [
        ...(STORY_AGENT_STATUS.providers ?? []).map((provider) => ({
          ...provider,
          state: "not-installed" as const,
          message: null,
        })),
        { id: "opencode", state: "sign-in-required", version: "1.18.27", message: null, email: null },
      ],
    };
    const runtimeStatuses: Record<ManagedProviderId, ProviderRuntimeStatus> = {
      codex: { phase: "not-downloaded", progress: null, message: null, version: null },
      claude: { phase: "not-downloaded", progress: null, message: null, version: null },
      grok: { phase: "not-downloaded", progress: null, message: null, version: null },
      opencode: { phase: "ready", progress: 100, message: null, version: "1.18.27" },
    };
    const onConnectProvider = vi.fn();
    const onSave = vi.fn(async (_provider: AgentProviderId) => undefined);
    const providerKeys = {
      getProviderApiKeyState: vi.fn(async () => ({ provider: "opencode" as const, status: "missing" as const })),
      setProviderApiKey: vi.fn(async () => undefined),
      clearProviderApiKey: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
    };
    const view = render(() => (
      <OnboardingFlow
        state={{ completed: false, preferredProvider: null, preferredModel: null }}
        agentStatus={agentStatus}
        platform="linux"
        providerRuntimeStatuses={runtimeStatuses}
        onDownloadProvider={vi.fn()}
        onConnectProvider={onConnectProvider}
        providerKeys={providerKeys}
        onSave={onSave}
      />
    ));

    // The only provider ready to use is chosen. Connect stays as a way to add an OpenCode Go key.
    const providers = view.getByRole("radiogroup", { name: "Default provider" });
    expect(within(providers).getByRole("radio", { name: /OpenCode/ })).toBeChecked();
    await fireEvent.click(view.getByRole("button", { name: "Connect OpenCode" }));
    expect(await screen.findByRole("dialog", { name: "Sign in to OpenCode Go" })).toBeInTheDocument();
    expect(onConnectProvider).not.toHaveBeenCalled();
    // Cancel waits for the saved-key read that the dialog starts on open.
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled());
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Next starts the provider for its free models and moves on while it answers.
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    expect(onConnectProvider).toHaveBeenCalledWith("opencode");
    await fireEvent.click(await view.findByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Open OpenBot" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("opencode", null));
  });

  it("names the step Next is waiting for as the selected provider moves through it", async () => {
    activeMock = createMockOpenBot();
    window.openbot = activeMock.api;
    const agentStatus: AgentStatus = {
      ...STORY_AGENT_STATUS,
      providers: (STORY_AGENT_STATUS.providers ?? []).map((provider) => ({
        ...provider,
        state: "not-installed",
        version: null,
        email: null,
        message: null,
      })),
    };
    const [runtimeStatuses, setRuntimeStatuses] = createSignal<Record<ManagedProviderId, ProviderRuntimeStatus>>({
      codex: { phase: "not-downloaded", progress: null, message: null, version: null },
      claude: { phase: "not-downloaded", progress: null, message: null, version: null },
      grok: { phase: "not-downloaded", progress: null, message: null, version: null },
      opencode: { phase: "not-downloaded", progress: null, message: null, version: null },
    });
    const view = render(() => (
      <OnboardingFlow
        state={{ completed: false, preferredProvider: null, preferredModel: null }}
        agentStatus={agentStatus}
        platform="darwin"
        providerRuntimeStatuses={runtimeStatuses()}
        onDownloadProvider={vi.fn()}
        onCancelProviderDownload={vi.fn()}
        onConnectProvider={vi.fn()}
        onSave={async () => undefined}
      />
    ));

    // Nothing is connected, so nothing is chosen for the user, and the reason says that first. The
    // free provider is pointed out as the way in that needs no account.
    expect(view.getByText("Select a provider to continue.")).toBeInTheDocument();
    expect(view.getByText("Try it free")).toBeInTheDocument();
    await fireEvent.click(
      within(view.getByRole("radiogroup", { name: "Default provider" })).getByRole("radio", { name: /ChatGPT/ }),
    );

    setRuntimeStatuses((current) => ({
      ...current,
      codex: { phase: "downloading", progress: 40, message: null, version: null },
    }));
    expect(await view.findByText("ChatGPT is still downloading.")).toBeInTheDocument();

    setRuntimeStatuses((current) => ({
      ...current,
      codex: { phase: "download-error", progress: null, message: "Network error", version: null },
    }));
    expect(
      await view.findByText("ChatGPT could not be downloaded. Retry the download to continue."),
    ).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Retry ChatGPT" })).toBeEnabled();

    setRuntimeStatuses((current) => ({
      ...current,
      codex: { phase: "ready", progress: 100, message: null, version: "0.145.0" },
    }));
    expect(await view.findByText("Connect ChatGPT to continue.")).toBeInTheDocument();
  });

  it("offers no OpenCode download to a user who installed the CLI already", () => {
    activeMock = createMockOpenBot();
    window.openbot = activeMock.api;
    // An empty managed directory is the normal state for anyone with their own OpenCode install, so
    // the row has to read the provider's answer and not the directory: the alternative offers a
    // ~46 MB download to a user whose CLI already works.
    const agentStatus: AgentStatus = {
      ...STORY_AGENT_STATUS,
      providers: [
        ...(STORY_AGENT_STATUS.providers ?? []).map((provider) =>
          provider.id === "codex" ? { ...provider, state: "not-installed" as const, version: null } : provider,
        ),
        { id: "opencode", state: "available", version: "1.18.27", message: null, cliSource: "system" },
      ],
    };
    const runtimeStatuses: Record<ManagedProviderId, ProviderRuntimeStatus> = {
      codex: { phase: "not-downloaded", progress: null, message: null, version: null },
      claude: { phase: "not-downloaded", progress: null, message: null, version: null },
      grok: { phase: "not-downloaded", progress: null, message: null, version: null },
      opencode: { phase: "not-downloaded", progress: null, message: null, version: null },
    };
    const view = render(() => (
      <OnboardingFlow
        state={{ completed: false, preferredProvider: null, preferredModel: null }}
        agentStatus={agentStatus}
        platform="darwin"
        providerRuntimeStatuses={runtimeStatuses}
        onDownloadProvider={vi.fn()}
        onSave={async () => undefined}
      />
    ));

    // ChatGPT is the control: the same empty runtime entry, on a provider that reports no CLI, does
    // offer the download.
    expect(view.getByRole("button", { name: "Download ChatGPT" })).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Download OpenCode" })).toBeNull();
    // The version the user's own CLI reports, which is the one the row must show.
    expect(view.getByText("v1.18.27")).toBeInTheDocument();
  });

  it("offers the code sign-in on the first-run provider step and shows the code to type", async () => {
    const agentStatus: AgentStatus = {
      ...STORY_AGENT_STATUS,
      providers: (STORY_AGENT_STATUS.providers ?? []).map((provider) =>
        provider.id === "codex" ? { ...provider, state: "sign-in-required" as const, email: null } : provider,
      ),
    };
    const [state, setState] = createSignal<ProviderCodeLoginState>({ phase: "starting" });
    const [provider, setProvider] = createSignal<AgentProviderId | null>(null);
    const codeLogin = {
      provider,
      state,
      start: vi.fn((id: AgentProviderId) => {
        setProvider(id);
        setState({
          phase: "waiting",
          userCode: "KTQ4-B62MX",
          verificationUrl: "https://auth.openai.com/codex/device",
          expiresAt: Date.now() + 600_000,
        });
      }),
      cancel: vi.fn(() => setProvider(null)),
      openVerificationUrl: vi.fn(),
    };
    const view = render(() => (
      <OnboardingFlow
        state={{ completed: false, preferredProvider: null, preferredModel: null }}
        agentStatus={agentStatus}
        platform="darwin"
        codeLogin={codeLogin}
        onSave={async () => undefined}
      />
    ));

    // The menu is a Kobalte trigger: it wants the pointer press as well as the click.
    const moreActions = view.getByRole("button", { name: "More actions for ChatGPT" });
    await fireEvent.pointerDown(moreActions, { button: 0 });
    await fireEvent.click(moreActions);
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Log in with code" }), { button: 0 });

    await waitFor(() => expect(codeLogin.start).toHaveBeenCalledWith("codex"));
    expect(await screen.findByLabelText("Login code K T Q 4 - B 6 2 M X")).toHaveTextContent("KTQ4-B62MX");

    await fireEvent.click(screen.getByRole("button", { name: "Close log in to ChatGPT" }));
    await waitFor(() => expect(codeLogin.cancel).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText("Login code K T Q 4 - B 6 2 M X")).toBeNull();
  });
});
