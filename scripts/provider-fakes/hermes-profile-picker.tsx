import type { AgentStatus, ClientAgentModelOption, UpdateAgentInput } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import type { AgentRuntimeSettings } from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createStore, flush } from "solid-js";
import AgentSettingsPanel from "../../src/renderer/src/features/conversation/AgentSettingsPanel";
import {
  createSettingsStore,
  type SettingsStoreDeps,
} from "../../src/renderer/src/features/conversation/stores/settings-store";
import type { ProfilePickerCase, ProfilePickerReport, ProfilePickerResult } from "./hermes-profile-picker-report";

declare global {
  interface Window {
    runHermesProfilePicker: (cases: ProfilePickerCase[]) => Promise<ProfilePickerReport>;
  }
}

function models(provider: "hermes" | "codex", profile: string): ClientAgentModelOption[] {
  return ["alpha", "beta"].map((suffix) => ({
    provider,
    id: `${provider === "hermes" ? "nous" : "gpt"}:${profile}-${suffix}`,
    name: `${profile} ${suffix}`,
    description: "Synthetic isolated catalog.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium", "high"],
  }));
}

const inherited = models("hermes", "Inherited");
const work = models("hermes", "Work");
const personal = models("hermes", "Personal");
const codex = models("codex", "Codex");

function check(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function openModels(provider: "Hermes" | "ChatGPT") {
  const trigger = await screen.findByRole("button", { name: /Agent model/u });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("tab", { name: new RegExp(`^${provider}:`, "u") }));
}

async function finishPromiseEvents() {
  await new Promise<void>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.data !== "hermes-profile-fixture-flush") return;
      window.removeEventListener("message", listener);
      resolve();
    };
    window.addEventListener("message", listener);
    window.postMessage("hermes-profile-fixture-flush", "*");
  });
  flush();
}

async function chooseEffort(effort: "High" | "Medium") {
  await openModels("Hermes");
  const trigger = await screen.findByLabelText("Agent reasoning effort", { exact: true });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: effort }));
}

async function chooseProfile(name: string) {
  const trigger = await screen.findByRole("button", { name: /^Hermes profile/u });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name }));
}

function createFixture(name: ProfilePickerCase, result: ProfilePickerResult) {
  const dormant = name === "dormant-first-choice";
  const inheritedCase = name === "inherited-readiness" || name === "inherited-available";
  const [agent, setAgent] = createStore<AgentProfile>({
    id: `agent-${name}`,
    name: "Fixture",
    title: "",
    description: "",
    notifications: true,
    provider: dormant ? "codex" : "hermes",
    model: dormant ? "gpt:Codex-alpha" : inheritedCase ? "nous:Inherited-alpha" : "nous:Work-alpha",
    reasoningEffort: "medium",
    threadId: null,
    avatarSeed: "fixture",
    avatarHue: null,
    avatarUrl: null,
    time: "",
    preview: "",
    ...(inheritedCase ? {} : { hermesProfileId: name === "selected-missing" ? "missing" : "work" }),
  });
  const [settings, setSettings] = createStore<AgentRuntimeSettings>({
    provider: dormant ? "codex" : "hermes",
    model: agent.model,
    reasoningEffort: "medium",
  });
  const globalState =
    name === "selected-readiness" ||
    name === "inherited-readiness" ||
    name === "selected-loading" ||
    name === "selected-error" ||
    name === "selected-missing"
      ? "sign-in-required"
      : "available";
  const status: AgentStatus = {
    phase: "ready",
    cliVersion: null,
    auth: { kind: "unknown" },
    capabilities: { chat: "ready", browser: "ready", computerUse: "unavailable" },
    message: null,
    fullAccess: true,
    providers: [
      { id: "hermes", state: globalState, version: "fixture", message: null },
      { id: "codex", state: "available", version: "fixture", message: null },
    ],
  };
  const pending = new Map<string, ReturnType<typeof Promise.withResolvers<ClientAgentModelOption[]>>[]>();
  let hold = name === "selected-loading" || name === "profile-generations" || name === "reopen-generation";
  const port = {
    agent: new Proxy(
      {},
      {
        get: (_target, property) => (String(property).startsWith("on") ? () => () => {} : async () => []),
      },
    ),
    listHermesProfiles: async () => {
      result.requests.push("profiles");
      return name === "selected-missing" ? ["default"] : ["default", "work", "personal"];
    },
    listHermesModels: async (input: { profileId?: string }) => {
      const key = input.profileId ?? "inherit";
      result.requests.push(`models:${key}`);
      if (name === "selected-error" || name === "selected-missing") {
        throw new Error("The selected profile catalog is unavailable.");
      }
      if (hold) {
        const deferred = Promise.withResolvers<ClientAgentModelOption[]>();
        pending.set(key, [...(pending.get(key) ?? []), deferred]);
        return deferred.promise;
      }
      return key === "work" ? work : key === "personal" ? personal : inherited;
    },
  };
  Object.defineProperty(window, "openbot", { configurable: true, value: port });
  const applyPatch = (updates: Omit<UpdateAgentInput, "agentId">) => {
    setAgent((draft) => {
      if (updates.provider !== undefined) draft.provider = updates.provider;
      if (updates.model !== undefined) draft.model = updates.model;
      if (updates.reasoningEffort !== undefined) draft.reasoningEffort = updates.reasoningEffort;
      if (updates.hermesProfileId === null) delete draft.hermesProfileId;
      else if (updates.hermesProfileId !== undefined) draft.hermesProfileId = updates.hermesProfileId;
    });
    flush();
  };
  const store = createSettingsStore({
    props: {
      agent,
      agents: [agent],
      agentStatus: status,
      modelOptions: [...codex, ...inherited],
      messages: [],
      unreadCount: 0,
      firstUnreadMessageId: null,
      loaded: true,
      activeTurnId: null,
      globalOverlayOpen: false,
      settingsRequest: null,
      messageFocusRequest: null,
      queue: undefined,
      browserTabs: [],
      activeBrowserTabId: null,
      browserVisibilitySuspended: false,
      browserControlState: { sessions: [] },
      server: undefined,
      presence: { serverId: null, members: [], updatedAt: "2026-11-08T00:00:00.000Z" },
      currentUserEmail: "fixture@example.invalid",
      isOwnSender: () => true,
      remoteDesktopSessionActive: false,
      remoteDesktopVisible: false,
      prompt: undefined,
      approval: undefined,
      browserTakeover: undefined,
      onSelectAgent: () => {},
      onUpdateAgent: async () => {},
      onSetAgentAvatar: async () => {},
      onSendMessage: async () => ({ error: "This fixture sends no messages." }),
      onMarkRead: async () => {},
      onTypingChange: () => {},
      onAnswerPrompt: async () => false,
      onRespondToApproval: async () => false,
      onRespondToBrowserTakeover: async () => false,
      onCancelQueuedMessage: () => {},
      onSteerQueuedMessage: () => {},
      onUpdateQueuedMessage: async () => false,
      onReorderQueue: () => {},
      onActivateBrowserTab: () => {},
      onCloseBrowserTab: () => {},
      onOpenRemoteDesktop: async () => {},
      onStop: () => {},
    },
    runtimeSettingsAttempts: new Map(),
    runtimeSettingsSaveTails: new Map(),
    settingsProvider: () => settings.provider,
    setSettingsProvider: (provider) =>
      setSettings((draft) => {
        draft.provider = provider;
      }),
    settingsModel: () => settings.model,
    setSettingsModel: (model) =>
      setSettings((draft) => {
        draft.model = model;
      }),
    settingsReasoning: () => settings.reasoningEffort,
    setSettingsReasoning: (effort) =>
      setSettings((draft) => {
        draft.reasoningEffort = effort;
      }),
    setComposerError: () => {},
    viewIsMounted: () => true,
    saveAgentPatch: async (updates) => {
      if (updates.provider === "hermes" && updates.model !== undefined) {
        const allowed =
          agent.hermesProfileId === "work" ? work : agent.hermesProfileId === "personal" ? personal : inherited;
        check(
          allowed.some((model) => model.id === updates.model),
          "The saved profile must accept the selected model.",
        );
      }
      applyPatch(updates);
      return true;
    },
  } satisfies SettingsStoreDeps);
  const mount = () =>
    render(() => (
      <AgentSettingsPanel
        localHost
        agent={agent}
        runtimeSettings={settings}
        agentStatus={status}
        modelOptions={[...codex, ...inherited]}
        working={false}
        maxWidth={() => 800}
        onWidthChange={() => {}}
        onClose={() => {}}
        skillsMode="hidden"
        onUpdateAgent={async (_id, updates) => {
          applyPatch(updates);
        }}
        onUpdateRuntimeSettings={async (id, next, updates) => {
          result.runtimeUpdates.push({ settings: next, updates });
          return store.updateRuntimeSettings(id, next, updates);
        }}
        onSetAgentAvatar={async () => {}}
        onConnectProvider={async (provider) => {
          result.connected.push(provider);
        }}
      />
    ));
  return {
    agent,
    settings,
    status,
    mount,
    setProfile: (profile: string) => applyPatch({ hermesProfileId: profile }),
    release: (key: string, index: number, values: ClientAgentModelOption[]) => {
      const deferred = pending.get(key)?.[index];
      check(deferred !== undefined, `The ${key} catalog request must be pending.`);
      deferred.resolve(values);
    },
    stopHolding: () => {
      hold = false;
    },
  };
}

window.runHermesProfilePicker = async (cases) => {
  configure({ getElementError: (message) => new Error(message ?? "The control was not found.") });
  const report: ProfilePickerReport = {
    passed: false,
    interface:
      "Production renderer adapter, Hermes catalog hook, shared picker, and optimistic settings store in jsdom. Synthetic IPC ports and save boundary. No provider process or native app.",
    cases: [],
  };
  for (const name of cases) {
    const result: ProfilePickerResult = {
      name,
      passed: false,
      checks: [],
      requests: [],
      runtimeUpdates: [],
      connected: [],
      saved: null,
      optimistic: null,
    };
    report.cases.push(result);
    const fixture = createFixture(name, result);
    const verify = (value: boolean, message: string) => {
      check(value, message);
      result.checks.push(message);
    };
    try {
      let view = fixture.mount();
      if (name === "dormant-first-choice") {
        verify(
          !screen.queryByRole("button", { name: /^Hermes profile/u }),
          "Another provider keeps the profile selector hidden.",
        );
        await openModels("ChatGPT");
        fireEvent.click(await screen.findByRole("option", { name: /Codex beta/u }));
        await waitFor(() => check(fixture.agent.model === "gpt:Codex-beta", "The Codex model choice must save."));
        verify(fixture.agent.hermesProfileId === "work", "A Codex model change preserves the dormant profile.");
        await openModels("Hermes");
        await waitFor(() =>
          check(
            Boolean(screen.queryByRole("option", { name: /Work beta/u })),
            "The first Hermes choice must use the dormant work catalog.",
          ),
        );
        verify(
          !screen.queryByRole("option", { name: /Inherited beta/u }),
          "The first Hermes choice excludes another profile's models.",
        );
        fireEvent.click(await screen.findByRole("option", { name: /Work beta/u }));
        await waitFor(() =>
          check(
            fixture.agent.provider === "hermes" && fixture.agent.model === "nous:Work-beta",
            "The first Hermes model choice must save without rollback.",
          ),
        );
        verify(fixture.agent.hermesProfileId === "work", "The provider switch keeps the selected profile.");
      } else if (name === "selected-loading") {
        await waitFor(() => check(result.requests.includes("models:work"), "The selected catalog request must start."));
        await openModels("Hermes");
        verify(
          !screen.queryByRole("option", { name: /Inherited beta/u }),
          "Loading does not offer another profile's models.",
        );
        verify(!screen.queryByRole("button", { name: "Connect" }), "Loading does not connect the inherited profile.");
        verify(result.runtimeUpdates.length === 0, "Loading does not save a model choice.");
        fixture.release("work", 0, work);
        await screen.findByRole("option", { name: /Work beta/u });
        fireEvent.click(await screen.findByRole("option", { name: /Work beta/u }));
        await waitFor(() => check(fixture.agent.model === "nous:Work-beta", "The loaded selected model must save."));
      } else if (name === "selected-error" || name === "selected-missing") {
        await screen.findByRole("alert");
        await openModels("Hermes");
        verify(
          !screen.queryByRole("option", { name: /Inherited beta/u }),
          "An unavailable explicit profile does not fall back to inherited models.",
        );
        verify(
          !screen.queryByRole("button", { name: "Connect" }),
          "An unavailable explicit profile does not connect another profile.",
        );
        verify(result.runtimeUpdates.length === 0, "An unavailable selected catalog cannot save a model.");
        verify(
          fixture.agent.hermesProfileId === (name === "selected-missing" ? "missing" : "work"),
          "A failed catalog read preserves the saved profile.",
        );
      } else if (name === "profile-generations") {
        await waitFor(() => check(result.requests.includes("models:work"), "The first profile request must start."));
        fixture.setProfile("personal");
        await waitFor(() => check(result.requests.includes("models:personal"), "The next profile request must start."));
        fixture.release("personal", 0, personal);
        await openModels("Hermes");
        await screen.findByRole("option", { name: /Personal beta/u });
        fixture.release("work", 0, work);
        await finishPromiseEvents();
        verify(
          !screen.queryByRole("option", { name: /Work beta/u }),
          "A late catalog does not replace the current profile's models.",
        );
        fireEvent.click(await screen.findByRole("option", { name: /Personal beta/u }));
        await waitFor(() =>
          check(fixture.agent.model === "nous:Personal-beta", "The current profile model must save."),
        );
        const trigger = await screen.findByRole("button", { name: /Agent model/u });
        if (trigger.getAttribute("aria-expanded") === "true") fireEvent.click(trigger);
        fixture.stopHolding();
        await chooseProfile("work");
        await openModels("Hermes");
        await screen.findByRole("option", { name: /Work beta/u });
        verify(
          !screen.queryByRole("option", { name: /Personal beta/u }),
          "Changing back replaces the profile catalog.",
        );
        verify(fixture.agent.hermesProfileId === "work", "Changing back saves the selected profile.");
      } else if (name === "reopen-generation") {
        await waitFor(() => check(result.requests.includes("models:work"), "The first panel request must start."));
        view.unmount();
        fixture.setProfile("personal");
        view = fixture.mount();
        await waitFor(() =>
          check(result.requests.includes("models:personal"), "The reopened panel request must start."),
        );
        fixture.release("personal", 0, personal);
        await openModels("Hermes");
        await screen.findByRole("option", { name: /Personal beta/u });
        fixture.release("work", 0, work);
        await finishPromiseEvents();
        verify(
          !screen.queryByRole("option", { name: /Work beta/u }),
          "A closed panel's late result does not replace the reopened catalog.",
        );
        fireEvent.click(await screen.findByRole("option", { name: /Personal beta/u }));
        await waitFor(() =>
          check(fixture.agent.model === "nous:Personal-beta", "The reopened panel model choice must save."),
        );
      } else {
        await waitFor(() =>
          check(
            result.requests.some((request) => request.startsWith("models:")),
            "The catalog request must start.",
          ),
        );
        await openModels("Hermes");
        if (name === "inherited-readiness") {
          const option = await screen.findByRole("option", { name: /Inherited beta/u });
          fireEvent.click(option);
          flush();
          verify(
            result.runtimeUpdates.length === 0,
            "Inherited sign-in readiness still blocks an unavailable inherited model.",
          );
          fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
          verify(
            result.connected.length === 1 && result.connected[0] === "hermes",
            "Inherited Connect keeps its released provider route.",
          );
        } else if (name === "inherited-available") {
          fireEvent.click(await screen.findByRole("option", { name: /Inherited beta/u }));
          await waitFor(() =>
            check(fixture.agent.model === "nous:Inherited-beta", "An available inherited model choice must save."),
          );
          verify(
            fixture.agent.hermesProfileId === undefined,
            "An inherited model choice keeps the profile setting absent.",
          );
        } else {
          await screen.findByRole("option", { name: /Work beta/u });
          fireEvent.click(await screen.findByRole("option", { name: /Work beta/u }));
          await waitFor(() =>
            check(
              fixture.agent.model === "nous:Work-beta",
              "A ready selected profile must allow its own model choice.",
            ),
          );
          verify(result.connected.length === 0, "A ready explicit profile does not use inherited Connect.");
          verify(
            fixture.status.providers?.[0]?.state === (name === "selected-readiness" ? "sign-in-required" : "available"),
            "Selected readiness leaves the global provider status unchanged.",
          );
          verify(fixture.settings.reasoningEffort === "medium", "The model choice preserves a supported effort.");
          await chooseEffort("High");
          await waitFor(() =>
            check(fixture.agent.reasoningEffort === "high", "A selected profile effort choice must save."),
          );
          await chooseEffort("Medium");
          await waitFor(() =>
            check(fixture.agent.reasoningEffort === "medium", "The reverse effort choice must save."),
          );
          verify(fixture.agent.hermesProfileId === "work", "Effort changes keep the selected profile.");
        }
      }
      result.passed = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      flush();
      result.saved = {
        provider: fixture.agent.provider,
        model: fixture.agent.model,
        hermesProfileId: fixture.agent.hermesProfileId ?? null,
        reasoningEffort: fixture.agent.reasoningEffort,
      };
      result.optimistic = { ...fixture.settings };
      cleanup();
    }
  }
  report.passed = report.cases.every((result) => result.passed);
  return report;
};
