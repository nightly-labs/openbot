import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSkillsModal } from "../features/conversation/AgentSkillsModal";
import { STORY_MARKETPLACE_SKILL_DETAILS } from "../preview/fixtures";
import { createMockOpenBot, type MockOpenBotControls } from "../preview/mock-openbot";
import { SkillPreview } from "./SkillPreview";

let mock: MockOpenBotControls | undefined;
afterEach(() => {
  mock?.dispose();
  mock = undefined;
});
const skill = STORY_MARKETPLACE_SKILL_DETAILS["skill-release-notes"];

describe("skill preview", () => {
  it("shows the author example and invokes Try only on user input", async () => {
    const onTry = vi.fn();
    render(() => <SkillPreview skill={skill} onTry={onTry} />);
    expect(screen.getByText(/Turn the latest commits/)).toBeInTheDocument();
    expect(onTry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try skill" }));
    expect(onTry).toHaveBeenCalledOnce();
  });
  it("keeps old skills readable and unavailable actions disabled", () => {
    render(() => (
      <SkillPreview skill={{ ...skill, examplePrompt: undefined }} unavailableReason="Install this skill first." />
    ));
    expect(screen.getByText(/Help me use this skill/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try skill" })).toBeDisabled();
    expect(screen.getByText("Install this skill first.")).toBeInTheDocument();
  });
  it("renders Markdown without executing HTML or unsafe links", () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const openUrl = vi.spyOn(window.openbot, "openUrl");
    render(() => (
      <SkillPreview
        skill={{
          ...skill,
          instructions:
            "# Release notes\n## What it does\n[Guide](https://example.com/guide)\n[Unsafe](javascript:alert(1))\n![Example image](https://example.com/image.png)\n<script>alert(1)</script>",
        }}
      />
    ));
    expect(screen.getByRole("heading", { name: "What it does" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Release notes" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Unsafe" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Example image" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Example image" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Guide" }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/guide");
  });
  it("keeps remote skill details read-only", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const onTrySkill = vi.fn();
    render(() => (
      <AgentSkillsModal
        agentId="chief"
        agentName="Chief"
        open
        skillsMode="readonly"
        onOpenChange={vi.fn()}
        onCountChange={vi.fn()}
        onTrySkill={onTrySkill}
      />
    ));
    fireEvent.click(await screen.findByRole("button", { name: /^Release notes/ }));
    expect(await screen.findByRole("button", { name: "Try skill" })).toBeDisabled();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(onTrySkill).not.toHaveBeenCalled();
  });
  it("enables automatically and closes details after Try", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const onTrySkill = vi.fn();
    const onOpenChange = vi.fn();
    render(() => (
      <AgentSkillsModal
        agentId="chief"
        agentName="Chief"
        open
        onOpenChange={onOpenChange}
        onCountChange={vi.fn()}
        onTrySkill={onTrySkill}
      />
    ));
    fireEvent.click(await screen.findByRole("button", { name: /^Release notes/ }));
    const dialog = await screen.findByRole("dialog", { name: "Release notes" });
    fireEvent.click(within(dialog).getByRole("switch", { name: "Enable Release notes" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("switch", { name: "Enable Release notes" })).not.toBeChecked();
      expect(within(dialog).getByRole("switch", { name: "Enable Release notes" })).toBeEnabled();
    });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Try skill" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Try skill" }));
    await waitFor(() => expect(onTrySkill).toHaveBeenCalledWith(skill));
    expect(within(dialog).getByRole("switch", { name: "Enable Release notes" })).toBeChecked();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
