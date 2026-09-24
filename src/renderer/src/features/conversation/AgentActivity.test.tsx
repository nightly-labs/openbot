import type { AgentProfile } from "@openbot/ui/data";
import { AgentActivityIndicator } from "@openbot/ui/features/conversation/AgentActivity";
import { render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";
import { STORY_AGENTS } from "../../preview/fixtures";

// An avatar is decorative, so it has no accessible name of its own: the agent it
// belongs to is announced by the indicator's own status text. Which of the two
// branches drew it is what this file guards, and `AgentAvatar` declares that as
// `data-avatar`. The working decor is not asserted here: it follows from the mood
// alone, so the assertion would hold with the rings deleted. The `CustomImage`
// story carries it instead.
const drawnAvatar = (container: HTMLElement) => container.querySelector("[data-avatar]");

function withAvatar(index: number, avatarUrl: string | null): AgentProfile {
  const agent = STORY_AGENTS[index];
  if (!agent) throw new Error("Story agents are empty.");
  return { ...agent, avatarUrl };
}

describe("AgentActivityIndicator", () => {
  it("follows the agent it is given, including an avatar that is removed", async () => {
    const [agent, setAgent] = createSignal(withAvatar(0, "openbot-avatar://agent/chief?v=image-1"));
    const { container } = render(() => <AgentActivityIndicator agent={agent()} label="Working on it…" />);

    await screen.findByRole("status");
    setAgent(withAvatar(1, null));
    flush();
    expect(drawnAvatar(container)).toHaveAttribute("data-avatar", "generated");

    setAgent(withAvatar(1, "openbot-avatar://agent/sales?v=image-2"));
    flush();
    expect(drawnAvatar(container)).toHaveAttribute("data-avatar", "image");
  });
});
