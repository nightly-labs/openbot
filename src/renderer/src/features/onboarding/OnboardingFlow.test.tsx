import type { ManagedProviderId } from "@openbot/contracts/agent-providers";
import type {
  AgentProviderId,
  AgentStatus,
  CustomProviderRestart,
  CustomProviderSummary,
  ProviderRuntimeStatus,
  SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster, toast } from "../../components/ui";
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
    const openPermission = vi.spyOn(activeMock?.api ?? window.openbot, "openComputerUsePermissionSetup");
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    expect(await view.findByRole("heading", { name: "OpenBot might control your computer" })).toBeInTheDocument();
    await waitFor(() => expect(view.getAllByRole("button", { name: "Set up" })).toHaveLength(2));

    await fireEvent.click(view.getAllByRole("button", { name: "Set up" })[0]);
    await waitFor(() => expect(openPermission).toHaveBeenCalledWith("screen-recording"));
    expect(await view.findByText("System Settings opened")).toBeInTheDocument();

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
        { id: value.id, name: value.name, baseUrl: value.baseUrl, hasApiKey: false },
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
    vi.spyOn(window, "confirm").mockReturnValue(true);
    // A second endpoint stays behind, so the custom row keeps the choice and only the model of the
    // removed endpoint can explain an empty model in setup.
    const [customProviders, setCustomProviders] = createSignal<CustomProviderSummary[]>([
      { id: "house-router", name: "House Router", baseUrl: "https://models.example.com/v1", hasApiKey: true },
    ]);
    const onAddCustomProvider = vi.fn(async (value: SaveCustomProviderInput): Promise<CustomProviderRestart> => {
      setCustomProviders((current) => [
        ...current,
        { id: value.id, name: value.name, baseUrl: value.baseUrl, hasApiKey: false },
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
    await waitFor(() => expect(onDeleteCustomProvider).toHaveBeenCalledWith("studio-local"));
    // The dialog stays open on what is left, so it is closed by hand before the step goes on.
    expect(await screen.findByRole("button", { name: "Delete House Router" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument());
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Next" }));
    await fireEvent.click(view.getByRole("button", { name: "Open OpenBot" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("opencode", null));
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

    const next = view.getByRole("button", { name: "Next" });
    expect(next).toBeDisabled();
    await fireEvent.click(view.getByRole("button", { name: "Download Grok" }));
    expect(
      within(view.getByRole("radiogroup", { name: "Default provider" })).getByRole("radio", { name: /Grok/ }),
    ).toBeChecked();
    expect(onDownloadProvider).toHaveBeenCalledWith("grok");

    await fireEvent.click(view.getByRole("button", { name: "Download Claude" }));
    await fireEvent.click(view.getByRole("button", { name: "Cancel Grok" }));
    expect(onCancelProviderDownload).toHaveBeenCalledWith("grok");
    expect(view.getByRole("button", { name: "Cancel Claude" })).toBeEnabled();
    expect(next).toBeDisabled();

    setRuntimeStatuses((current) => ({
      ...current,
      claude: { phase: "ready", progress: 100, message: null, version: "2.1.246" },
    }));
    await fireEvent.click(await view.findByRole("button", { name: "Connect Claude" }));
    await waitFor(() => expect(next).toBeEnabled());
    await fireEvent.click(view.getByRole("button", { name: "Reconnect Claude" }));
    expect(onConnectProvider).toHaveBeenCalledTimes(2);
  });
});
