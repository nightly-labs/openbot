import SharedAgentSettingsPanel, {
  type AgentRuntimeSettings,
} from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORY_AGENT_STATUS, STORY_AGENTS, STORY_MODELS } from "../../preview/fixtures";
import { createMockOpenBot, type MockOpenBotControls } from "../../preview/mock-openbot";
import AgentSettingsPanel from "./AgentSettingsPanel";
import { AgentSkillsModal } from "./AgentSkillsModal";

let mock: MockOpenBotControls | undefined;

afterEach(() => {
  mock?.dispose();
  mock = undefined;
});

describe("AgentSettingsPanel", () => {
  it("saves through callbacks without a desktop preload", async () => {
    vi.stubGlobal("openbot", undefined);
    const onUpdateAgent = vi.fn(async () => undefined);
    try {
      const view = render(() => (
        <SharedAgentSettingsPanel
          agent={STORY_AGENTS[0]}
          runtimeSettings={{ provider: "codex", model: "gpt-5.6-sol", reasoningEffort: "high" }}
          agentStatus={STORY_AGENT_STATUS}
          modelOptions={STORY_MODELS}
          working={false}
          width={296}
          maxWidth={() => 640}
          onClose={vi.fn()}
          onResize={vi.fn()}
          onResizeEnd={vi.fn()}
          onUpdateAgent={onUpdateAgent}
          onUpdateRuntimeSettings={vi.fn(async () => true)}
          onSetAgentAvatar={vi.fn(async () => undefined)}
        />
      ));
      const instructions = await screen.findByRole("textbox", { name: "Agent instructions" });
      await fireEvent.input(instructions, { target: { value: "Keep the shared form independent." } });
      view.unmount();
      expect(onUpdateAgent).toHaveBeenCalledWith(STORY_AGENTS[0].id, {
        description: "Keep the shared form independent.",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("saves edited instructions while the field stays focused", async () => {
    vi.useFakeTimers();
    try {
      mock = createMockOpenBot();
      window.openbot = mock.api;
      const onUpdateAgent = vi.fn(async () => undefined);
      render(() => (
        <AgentSettingsPanel
          onOpenUsage={vi.fn()}
          agent={STORY_AGENTS[0]}
          runtimeSettings={{ provider: "codex", model: "gpt-5.6-sol", reasoningEffort: "high" }}
          agentStatus={STORY_AGENT_STATUS}
          modelOptions={STORY_MODELS}
          working={false}
          maxWidth={() => 640}
          onClose={vi.fn()}
          onWidthChange={vi.fn()}
          onUpdateAgent={onUpdateAgent}
          onUpdateRuntimeSettings={vi.fn(async () => true)}
          onSetAgentAvatar={vi.fn(async () => undefined)}
        />
      ));

      const instructions = await screen.findByRole("textbox", { name: "Agent instructions" });
      instructions.focus();
      await fireEvent.input(instructions, { target: { value: "Use the reviewed release instructions." } });
      await vi.advanceTimersByTimeAsync(500);

      expect(instructions).toHaveFocus();
      expect(onUpdateAgent).toHaveBeenCalledWith(STORY_AGENTS[0].id, {
        description: "Use the reviewed release instructions.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes pasted instructions when the settings panel closes", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const onUpdateAgent = vi.fn(async () => undefined);
    const view = render(() => (
      <AgentSettingsPanel
        onOpenUsage={vi.fn()}
        agent={STORY_AGENTS[0]}
        runtimeSettings={{ provider: "codex", model: "gpt-5.6-sol", reasoningEffort: "high" }}
        agentStatus={STORY_AGENT_STATUS}
        modelOptions={STORY_MODELS}
        working={false}
        maxWidth={() => 640}
        onClose={vi.fn()}
        onWidthChange={vi.fn()}
        onUpdateAgent={onUpdateAgent}
        onUpdateRuntimeSettings={vi.fn(async () => true)}
        onSetAgentAvatar={vi.fn(async () => undefined)}
      />
    ));

    const instructions = await screen.findByRole("textbox", { name: "Agent instructions" });
    await fireEvent.input(instructions, { target: { value: "Keep this instruction when the panel closes." } });
    view.unmount();

    expect(onUpdateAgent).toHaveBeenCalledWith(STORY_AGENTS[0].id, {
      description: "Keep this instruction when the panel closes.",
    });
  });

  it("queues a newer instruction behind an active save", async () => {
    vi.useFakeTimers();
    try {
      mock = createMockOpenBot();
      window.openbot = mock.api;
      let finishFirstSave!: () => void;
      const firstSave = new Promise<void>((resolve) => {
        finishFirstSave = resolve;
      });
      const onUpdateAgent = vi
        .fn<(agentId: string, updates: { description?: string }) => Promise<void>>()
        .mockReturnValueOnce(firstSave)
        .mockResolvedValue(undefined);
      render(() => (
        <AgentSettingsPanel
          onOpenUsage={vi.fn()}
          agent={STORY_AGENTS[0]}
          runtimeSettings={{ provider: "codex", model: "gpt-5.6-sol", reasoningEffort: "high" }}
          agentStatus={STORY_AGENT_STATUS}
          modelOptions={STORY_MODELS}
          working={false}
          maxWidth={() => 640}
          onClose={vi.fn()}
          onWidthChange={vi.fn()}
          onUpdateAgent={onUpdateAgent}
          onUpdateRuntimeSettings={vi.fn(async () => true)}
          onSetAgentAvatar={vi.fn(async () => undefined)}
        />
      ));

      const instructions = await screen.findByRole("textbox", { name: "Agent instructions" });
      await fireEvent.input(instructions, { target: { value: "First instruction" } });
      await vi.advanceTimersByTimeAsync(500);
      await fireEvent.input(instructions, { target: { value: "Latest instruction" } });
      await vi.advanceTimersByTimeAsync(500);
      expect(onUpdateAgent).toHaveBeenCalledTimes(1);

      finishFirstSave();
      await vi.waitFor(() => expect(onUpdateAgent).toHaveBeenCalledTimes(2));
      expect(onUpdateAgent).toHaveBeenLastCalledWith(STORY_AGENTS[0].id, {
        description: "Latest instruction",
      });
      expect(instructions).toHaveValue("Latest instruction");
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a requested skill in the existing management modal", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    render(() => (
      <AgentSkillsModal
        open
        agentId="chief"
        agentName="Chief"
        selectionRequest={{ skillId: "skill-release-notes" }}
        onOpenChange={vi.fn()}
        onCountChange={vi.fn()}
      />
    ));
    const toggle = await screen.findByRole("switch", { name: "Enable Release notes" });
    expect(await screen.findByRole("region", { name: "Release notes preview" })).toBeInTheDocument();
    await fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
  });
  it("keeps keyboard focus on the skill switch after saving", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    render(() => (
      <AgentSkillsModal open agentId="chief" agentName="Chief" onOpenChange={vi.fn()} onCountChange={vi.fn()} />
    ));
    const toggle = await screen.findByRole("switch", { name: "Enable Release notes" });
    toggle.focus();
    await fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enable Release notes" })).not.toBeChecked());
    expect(screen.getByRole("switch", { name: "Enable Release notes" })).toHaveFocus();
  });

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
    await fireEvent.click(await screen.findByRole("tab", { name: "Local" }));
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
    const detail = await mock.api.skills.get("skill-source-check");
    vi.spyOn(mock.api.skills, "get").mockResolvedValue({ ...detail, version: 2 });
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

  it("requires an update before trying a different preview version", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const onTrySkill = vi.fn();
    render(() => (
      <AgentSkillsModal
        open
        agentId="chief"
        agentName="Chief"
        onOpenChange={vi.fn()}
        onCountChange={vi.fn()}
        onTrySkill={onTrySkill}
      />
    ));
    await fireEvent.click(await screen.findByRole("button", { name: /^Source check/ }));
    expect(await screen.findByText("Update this skill to try this version.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try skill" })).toBeDisabled();
    expect(onTrySkill).not.toHaveBeenCalled();
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

  it("requires confirmation before replacing a modified skill", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const installed = await mock.api.skills.listInstalled("chief");
    const original = installed.find((item) => item.skillId === "skill-release-notes");
    if (!original) throw new Error("Missing skill fixture");
    const skill = { ...original, state: "modified" as const };
    vi.spyOn(mock.api.skills, "listInstalled").mockResolvedValue([skill]);
    const install = vi.spyOn(mock.api.skills, "install");
    render(() => (
      <AgentSkillsModal open agentId="chief" agentName="Chief" onOpenChange={vi.fn()} onCountChange={vi.fn()} />
    ));
    await fireEvent.pointerDown(await screen.findByRole("button", { name: `More for ${skill.name}` }), { button: 0 });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Repair" }), { button: 0 });
    const confirm = await screen.findByRole("alertdialog", { name: "Replace local changes?" });
    expect(install).not.toHaveBeenCalled();
    await fireEvent.click(within(confirm).getByRole("button", { name: "Replace skill" }));
    await waitFor(() =>
      expect(install).toHaveBeenCalledWith({ agentId: "chief", skillId: skill.skillId, replaceModified: true }),
    );
  });

  it("lists a workspace skill folder read-only with its problem", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    vi.spyOn(mock.api.skills, "listInstalled").mockResolvedValue([
      {
        skillId: "workspace:deploy",
        slug: "deploy",
        name: "deploy",
        installedVersion: 1,
        availableVersion: 1,
        state: "installed",
        origin: "workspace",
        location: ".agents/skills/deploy",
        problem: "Claude Code does not read .agents/skills. Copy this folder to .claude/skills.",
      },
    ]);
    const get = vi.spyOn(mock.api.skills, "get");
    const onCountChange = vi.fn();
    render(() => (
      <AgentSkillsModal open agentId="chief" agentName="Chief" onOpenChange={vi.fn()} onCountChange={onCountChange} />
    ));
    const row = await screen.findByRole("button", { name: /^deploy/ });
    // OpenBot did not assign this skill, so the "Skills N assigned" count leaves it out.
    expect(onCountChange).toHaveBeenLastCalledWith(0);
    expect(screen.queryByRole("switch", { name: "Enable deploy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More for deploy" })).not.toBeInTheDocument();
    await fireEvent.click(row);
    expect(
      await screen.findByText("OpenBot did not install this skill. Edit or remove it in .agents/skills/deploy."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Claude Code does not read .agents/skills. Copy this folder to .claude/skills."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Enable deploy" })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("does not read this computer's library for a remote local skill", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const skill = (await mock.api.skills.localList())[0];
    vi.spyOn(mock.api.agent, "listInstalledSkills").mockResolvedValue([
      {
        skillId: skill.id,
        slug: skill.slug,
        name: skill.name,
        installedVersion: 1,
        availableVersion: 1,
        state: "installed",
      },
    ]);
    const localGet = vi.spyOn(mock.api.skills, "localGet");
    const localList = vi.spyOn(mock.api.skills, "localList");
    render(() => (
      <AgentSkillsModal
        open
        skillsMode="readonly"
        agentId="remote-chief"
        agentName="Chief"
        onOpenChange={vi.fn()}
        onCountChange={vi.fn()}
      />
    ));
    await fireEvent.click(await screen.findByRole("button", { name: /^Weekly summary/ }));
    expect(
      await screen.findByText("This local skill is stored on the host. Open its details on that computer."),
    ).toBeInTheDocument();
    expect(localGet).not.toHaveBeenCalled();
    expect(localList).not.toHaveBeenCalled();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
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
    await fireEvent.click(within(dialog).getByRole("option", { name: "Claude Sonnet 5" }));

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
    expect(screen.getByText("/mock/OpenBot/Agents/chief")).toBeInTheDocument();
    expect(screen.getByText(/full computer access/)).toBeInTheDocument();
    expect(screen.getByText(/may ask for approval first/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(onOpenUsage).toHaveBeenCalledWith(screen.getByRole("button", { name: "Usage" }));
    expect(screen.getByRole("button", { name: "Agent model: GPT-5.6 Sol" })).toBeInTheDocument();
  });

  it("asks before it gives a Workspace only agent full access", async () => {
    const onUpdateAgent = vi.fn(async () => undefined);
    render(() => (
      <SharedAgentSettingsPanel
        agent={{ ...STORY_AGENTS[0], access: "workspace" }}
        accessEditable
        runtimeSettings={{ provider: "codex", model: "gpt-5.6-sol", reasoningEffort: "high" }}
        agentStatus={STORY_AGENT_STATUS}
        modelOptions={STORY_MODELS}
        working={false}
        width={296}
        maxWidth={() => 640}
        onClose={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
        onUpdateAgent={onUpdateAgent}
        onUpdateRuntimeSettings={vi.fn(async () => true)}
        onSetAgentAvatar={vi.fn(async () => undefined)}
      />
    ));
    expect(await screen.findByText(/Not enforced yet/)).toBeInTheDocument();
    const chooseFullAccess = async () => {
      await fireEvent.pointerDown(screen.getByRole("button", { name: /Agent access/ }), {
        pointerType: "mouse",
        button: 0,
      });
      await fireEvent.click(screen.getByRole("option", { name: "Full access" }));
      return screen.findByRole("alertdialog", { name: "Give this agent full access?" });
    };

    await fireEvent.click(within(await chooseFullAccess()).getByRole("button", { name: "Keep workspace only" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Agent access/ })).toHaveTextContent("Workspace only");
    expect(onUpdateAgent).not.toHaveBeenCalled();

    await fireEvent.click(within(await chooseFullAccess()).getByRole("button", { name: "Allow full access" }));
    await waitFor(() => expect(onUpdateAgent).toHaveBeenCalledWith(STORY_AGENTS[0].id, { access: "full" }));
    expect(screen.getByRole("button", { name: /Agent access/ })).toHaveTextContent("Full access");
  });

  it("states that Claude acts without approval prompts", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    render(() => (
      <AgentSettingsPanel
        onOpenUsage={vi.fn()}
        agent={{ ...STORY_AGENTS[1], provider: "claude", model: "claude-sonnet-5", reasoningEffort: "high" }}
        runtimeSettings={{ provider: "claude", model: "claude-sonnet-5", reasoningEffort: "high" }}
        agentStatus={STORY_AGENT_STATUS}
        modelOptions={STORY_MODELS}
        working={false}
        maxWidth={() => 640}
        onClose={vi.fn()}
        onWidthChange={vi.fn()}
        onUpdateAgent={vi.fn(async () => undefined)}
        onUpdateRuntimeSettings={vi.fn(async () => true)}
        onSetAgentAvatar={vi.fn(async () => undefined)}
      />
    ));

    expect(await screen.findByText(/Claude acts without asking for approval/)).toBeInTheDocument();
    expect(screen.queryByText(/may ask for approval first/)).not.toBeInTheDocument();
  });
});
