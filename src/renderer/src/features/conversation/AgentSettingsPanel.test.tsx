import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORY_AGENT_STATUS, STORY_AGENTS, STORY_MODELS } from "../../preview/fixtures";
import { createMockOpenBot, type MockOpenBotControls } from "../../preview/mock-openbot";
import AgentSettingsPanel, { type AgentRuntimeSettings } from "./AgentSettingsPanel";
import { AgentSkillsModal } from "./AgentSkillsModal";

let mock: MockOpenBotControls | undefined;

afterEach(() => {
  mock?.dispose();
  mock = undefined;
});

describe("AgentSettingsPanel", () => {
  it("enables a library skill for this agent and shares its state across filters", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const install = vi.spyOn(mock.api.skills, "localInstall");
    render(() => (
      <AgentSkillsModal open agentId="research" agentName="Research" onOpenChange={vi.fn()} onCountChange={vi.fn()} />
    ));
    await fireEvent.click(await screen.findByRole("tab", { name: "Local" }));
    const toggle = await screen.findByRole("switch", { name: "Enable Weekly summary" });
    expect(toggle).not.toBeChecked();
    await fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ agentId: "research", revision: 1 }));
    await fireEvent.click(screen.getByRole("tab", { name: "Enabled" }));
    expect(await screen.findByRole("switch", { name: "Enable Weekly summary" })).toBeChecked();
    await fireEvent.click(screen.getByRole("tab", { name: "Local" }));
    await fireEvent.click(await screen.findByRole("switch", { name: "Enable Weekly summary" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enable Weekly summary" })).not.toBeChecked());
    expect(install).toHaveBeenCalledTimes(1);
    expect((await mock.api.skills.listInstalled("chief")).some((skill) => skill.name === "Weekly summary")).toBe(false);
  });

  it("filters enabled skills and restores disabled skills in All", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    render(() => (
      <AgentSkillsModal open agentId="chief" agentName="Chief" onOpenChange={vi.fn()} onCountChange={vi.fn()} />
    ));
    await screen.findByRole("switch", { name: "Enable Release notes" });
    await fireEvent.click(await screen.findByRole("tab", { name: "Enabled" }));
    await fireEvent.click(await screen.findByRole("switch", { name: "Enable Release notes" }));
    await waitFor(() => expect(screen.queryByRole("switch", { name: "Enable Release notes" })).not.toBeInTheDocument());
    await fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(await screen.findByRole("switch", { name: "Enable Release notes" })).not.toBeChecked();
  });

  it("starts skill creation and closes the preview", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const create = vi.fn();
    const close = vi.fn();
    render(() => (
      <AgentSkillsModal
        open
        agentId="research"
        agentName="Research"
        onOpenChange={close}
        onCountChange={vi.fn()}
        onCreateSkill={create}
      />
    ));
    await fireEvent.click(await screen.findByRole("button", { name: "Create skill" }));
    expect(create).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(false);
  });

  it("adds a shared local skill to the selected agent and then tries it", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const install = vi.spyOn(mock.api.skills, "localInstall");
    const onTry = vi.fn();
    render(() => (
      <AgentSkillsModal
        open
        agentId="research"
        agentName="Research"
        onOpenChange={vi.fn()}
        onCountChange={vi.fn()}
        onTrySkill={onTry}
      />
    ));
    await fireEvent.click(await screen.findByRole("tab", { name: "Local" }));
    await fireEvent.click(await screen.findByRole("button", { name: /Weekly summary/ }));
    expect(screen.getByRole("button", { name: "Try skill" })).toBeDisabled();
    await fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    await waitFor(() =>
      expect(install).toHaveBeenCalledWith({
        agentId: "research",
        skillId: "local-skill-11111111-1111-4111-8111-111111111111",
        revision: 1,
      }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Try skill" })).toBeEnabled());
    await fireEvent.click(screen.getByRole("button", { name: "Try skill" }));
    await waitFor(() => expect(onTry).toHaveBeenCalledWith(expect.objectContaining({ name: "Weekly summary" })));
    expect(
      (await mock.api.skills.listInstalled("chief")).some((skill) => skill.skillId.startsWith("local-skill-")),
    ).toBe(false);
  });

  it("updates a local revision explicitly and keeps the skill disabled", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const skill = (await mock.api.skills.localList())[0];
    await mock.api.skills.localInstall({ agentId: "chief", skillId: skill.id, revision: 1 });
    await mock.api.skills.setEnabled({ agentId: "chief", skillId: skill.id, enabled: false });
    await mock.api.skills.localRevise({
      agentId: "chief",
      skillId: skill.id,
      expectedRevision: 1,
      sourcePath: "draft",
    });
    render(() => (
      <AgentSkillsModal open agentId="chief" agentName="Chief" onOpenChange={vi.fn()} onCountChange={vi.fn()} />
    ));
    await fireEvent.click(await screen.findByRole("button", { name: "Update Weekly summary" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Update Weekly summary" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("switch", { name: "Enable Weekly summary" })).not.toBeChecked();
    expect(
      (await mock.api.skills.listInstalled("chief")).find((item) => item.skillId === skill.id)?.installedVersion,
    ).toBe(2);
  });

  it("retries a failed local library read and returns to assigned skills", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const list = mock.api.skills.localList;
    mock.api.skills.localList = vi.fn(async () => {
      throw new Error("offline");
    });
    render(() => (
      <AgentSkillsModal open agentId="chief" agentName="Chief" onOpenChange={vi.fn()} onCountChange={vi.fn()} />
    ));
    await fireEvent.click(await screen.findByRole("tab", { name: "Local" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load local skills.");
    mock.api.skills.localList = list;
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /Weekly summary/ })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(await screen.findByRole("button", { name: /^Release notes/ })).toBeInTheDocument();
  });

  it.each([false, true])("enables a skill before Try and handles failure=%s", async (fails) => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const enable = vi.spyOn(mock.api.skills, "setEnabled");
    if (fails) enable.mockRejectedValue(new Error("Could not enable the skill."));
    const onTry = vi.fn();
    const onClose = vi.fn();
    render(() => (
      <AgentSkillsModal
        open
        agentId="chief"
        agentName="Chief"
        onOpenChange={onClose}
        onCountChange={vi.fn()}
        onTrySkill={onTry}
      />
    ));
    await fireEvent.click(await screen.findByRole("button", { name: /^Source check/ }));
    await fireEvent.click(await screen.findByRole("button", { name: "Try skill" }));
    await waitFor(() =>
      expect(enable).toHaveBeenCalledWith({ agentId: "chief", skillId: "skill-source-check", enabled: true }),
    );
    if (fails) {
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not enable the skill.");
      expect(onTry).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(onTry).toHaveBeenCalledWith(expect.objectContaining({ id: "skill-source-check" })));
      expect(screen.getByRole("switch", { name: "Enable Source check" })).toBeChecked();
      expect(onClose).toHaveBeenCalledWith(false);
    }
  });

  it("updates a skill from its chip without opening the detail", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const install = vi.spyOn(mock.api.skills, "install");
    render(() => (
      <AgentSkillsModal open agentId="chief" agentName="Chief" onOpenChange={vi.fn()} onCountChange={vi.fn()} />
    ));
    await fireEvent.click(await screen.findByRole("button", { name: "Update Source check" }));
    await waitFor(() => expect(install).toHaveBeenCalledWith({ agentId: "chief", skillId: "skill-source-check" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Update Source check" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable Source check" })).not.toBeChecked();
  });

  it("preserves settings after a failed save and a visit to Usage", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    // Sol does not run under Claude, and Claude does not offer Extra high, so a rejected save has
    // all three runtime fields to put back at once.
    const runtimeSettings: AgentRuntimeSettings = {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
    };
    const onOpenUsage = vi.fn();
    const onUpdateRuntimeSettings = vi.fn(async () => false);
    render(() => (
      <AgentSettingsPanel
        onOpenUsage={onOpenUsage}
        agent={{ ...STORY_AGENTS[0], provider: "codex", model: "gpt-5.6-sol", reasoningEffort: "xhigh" }}
        runtimeSettings={runtimeSettings}
        agentStatus={STORY_AGENT_STATUS}
        modelOptions={STORY_MODELS}
        working={false}
        maxWidth={() => 640}
        onClose={vi.fn()}
        onWidthChange={vi.fn()}
        onUpdateAgent={vi.fn(async () => undefined)}
        onUpdateRuntimeSettings={onUpdateRuntimeSettings}
        onSetAgentAvatar={vi.fn(async () => undefined)}
      />
    ));

    await fireEvent.click(await screen.findByRole("button", { name: "Agent model: GPT-5.6 Sol" }));
    const dialog = screen.getByRole("dialog", { name: "Choose agent model" });
    await fireEvent.click(within(dialog).getByRole("tab", { name: /^Claude:/ }));
    await fireEvent.click(within(dialog).getByRole("option", { name: "Claude Sonnet 5, default" }));

    await waitFor(() =>
      expect(onUpdateRuntimeSettings).toHaveBeenCalledWith(
        STORY_AGENTS[0].id,
        { provider: "claude", model: "claude-sonnet-5", reasoningEffort: "high" },
        { provider: "claude", model: "claude-sonnet-5", reasoningEffort: "high" },
      ),
    );
    await fireEvent.keyDown(dialog, { key: "Escape" });

    expect(await screen.findByText("Could not save agent settings.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agent model: GPT-5.6 Sol" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agent reasoning level/ })).toHaveTextContent("Extra high");
    await fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(onOpenUsage).toHaveBeenCalledWith(screen.getByRole("button", { name: "Usage" }));
    expect(screen.getByRole("button", { name: "Agent model: GPT-5.6 Sol" })).toBeInTheDocument();
  });
});
