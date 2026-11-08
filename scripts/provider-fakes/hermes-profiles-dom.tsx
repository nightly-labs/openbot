import type { AgentStatus } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import { createFirstAgentDraft, FirstAgentSetup } from "@openbot/ui/features/agents/FirstAgentSetup";
import type { HermesProfileOptions } from "@openbot/ui/features/agents/HermesProfileSelect";
import AgentSettingsPanel from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { cleanup, configure, fireEvent, render, screen } from "@solidjs/testing-library";
import { createStore, flush } from "solid-js";

interface DomReport {
  passed: boolean;
  checks: string[];
  before: string;
  after: string;
}

declare global {
  interface Window {
    runHermesProfileDom: () => Promise<DomReport>;
  }
}

window.runHermesProfileDom = async () => {
  configure({
    getElementError: (message) =>
      new Error(
        `${message}; controls=${Array.from(document.querySelectorAll("[aria-label]"))
          .filter((node) => node.getAttribute("aria-label") === "Hermes profile")
          .map((node) => node.outerHTML)
          .join(",")}`,
      ),
  });
  const report: DomReport = { passed: false, checks: [], before: "", after: "" };
  const check = (value: boolean, message: string) => {
    if (!value) throw new Error(message);
    report.checks.push(message);
  };
  const options: HermesProfileOptions = {
    profiles: ["default", "work"],
    loading: false,
    unavailable: false,
    modelsUnavailable: false,
    retry: () => {},
  };
  const [draft, setDraft] = createStore(createFirstAgentDraft(() => 0));
  render(() => (
    <FirstAgentSetup
      value={draft}
      suggestions={[]}
      hermesProfiles={options}
      onChange={(value) => setDraft(() => value)}
      onSubmit={() => {}}
    />
  ));
  check(
    !screen.queryByRole("button", { name: /^Hermes profile/u }),
    "create hides profile selector for another provider",
  );
  report.before = document.body.innerHTML;
  setDraft((state) => {
    state.provider = "hermes";
  });
  flush();
  check(draft.provider === "hermes", "fixture applies provider selection");
  const select = await screen.findByRole("button", { name: /^Hermes profile/u });
  fireEvent.keyDown(select, { key: "ArrowDown" });
  const explicitDefault = await screen.findByRole("option", { name: "Default profile (explicit)" });
  check(
    Boolean(await screen.findByRole("option", { name: "Use Hermes environment and active profile" })),
    "create lists unset separately from explicit default",
  );
  check(Boolean(await screen.findByRole("option", { name: "work" })), "create lists discovered named profile");
  fireEvent.click(explicitDefault);
  flush();
  check(draft.hermesProfileId === "default", "create selection writes canonical default ID");
  fireEvent.keyDown(select, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "work" }));
  flush();
  check(draft.hermesProfileId === "work", "create selection writes named profile ID");
  report.after = document.body.innerHTML;
  cleanup();

  const [agent, setAgent] = createStore<AgentProfile>({
    id: "agent-fixture",
    name: "Fixture",
    title: "",
    description: "",
    notifications: true,
    provider: "hermes",
    model: "nous:fixture",
    reasoningEffort: "medium",
    threadId: null,
    avatarSeed: "fixture",
    avatarHue: null,
    avatarUrl: null,
    time: "",
    preview: "",
    hermesProfileId: "work",
  });
  const status: AgentStatus = {
    phase: "ready",
    cliVersion: null,
    auth: { kind: "unknown" },
    capabilities: { chat: "ready", browser: "ready", computerUse: "unavailable" },
    message: null,
    fullAccess: true,
  };
  const [discovery, setDiscovery] = createStore({ ...options, profiles: [...options.profiles] });
  render(() => (
    <AgentSettingsPanel
      agent={agent}
      runtimeSettings={{
        provider: agent.provider === "hermes" ? "hermes" : "codex",
        model: agent.model,
        reasoningEffort: agent.reasoningEffort,
      }}
      agentStatus={status}
      modelOptions={[]}
      working={false}
      hermesProfiles={discovery}
      width={400}
      maxWidth={() => 800}
      onClose={() => {}}
      onResize={() => {}}
      onResizeEnd={() => {}}
      onUpdateAgent={async (_id, updates) => {
        setAgent((state) => {
          if (updates.hermesProfileId === null) delete state.hermesProfileId;
          else if (updates.hermesProfileId !== undefined) state.hermesProfileId = updates.hermesProfileId;
        });
      }}
      onUpdateRuntimeSettings={async () => true}
      onSetAgentAvatar={async () => {}}
    />
  ));
  const editSelect = await screen.findByRole("button", { name: /^Hermes profile/u });
  check(editSelect.textContent?.includes("work") === true, "edit shows saved named profile");
  fireEvent.keyDown(editSelect, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "Use Hermes environment and active profile" }));
  await screen.findByRole("button", { name: /^Hermes profile/u });
  flush();
  check(agent.hermesProfileId === undefined, "edit unset removes explicit setting");
  setAgent((state) => {
    state.hermesProfileId = "missing";
  });
  setDiscovery((state) => {
    state.profiles = [];
    state.unavailable = true;
  });
  flush();
  check(Boolean(await screen.findByRole("alert")), "edit shows discovery failure");
  check(
    (await screen.findByRole("button", { name: /^Hermes profile/u })).textContent?.includes("missing (unavailable)") ===
      true,
    "unavailable discovery keeps saved profile choice visible",
  );
  setAgent((state) => {
    state.provider = "codex";
  });
  flush();
  check(!screen.queryByRole("button", { name: /^Hermes profile/u }), "edit hides selector for another provider");
  cleanup();
  report.passed = true;
  return report;
};
