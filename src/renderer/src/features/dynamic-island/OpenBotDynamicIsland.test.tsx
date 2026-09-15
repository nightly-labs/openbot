import type {
  DynamicIslandAction,
  DynamicIslandAgentIdentity,
  DynamicIslandPresentation,
} from "@openbot/contracts/ipc";
import { render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { DynamicIslandViewState } from "../../components/ui";
import { OpenBotDynamicIsland } from "./OpenBotDynamicIsland";

const AGENT: DynamicIslandAgentIdentity = {
  id: "research",
  name: "Research",
  avatarSeed: "research",
  avatarHue: 215,
  avatarUrl: null,
};

describe("OpenBotDynamicIsland approval safety", () => {
  it("requires opening OpenBot before approving truncated requests", () => {
    const presentation = approvalPresentation();
    presentation.item.truncated = true;
    renderControlledIsland(presentation, "expanded", vi.fn());

    expect(screen.getByRole("button", { name: "Review in OpenBot" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});

function renderControlledIsland(
  initialPresentation: DynamicIslandPresentation,
  initialState: DynamicIslandViewState,
  onAction: (action: DynamicIslandAction) => void = () => undefined,
  onHaptic: () => void = () => undefined,
) {
  let setPresentation: (presentation: DynamicIslandPresentation) => DynamicIslandPresentation = () =>
    initialPresentation;
  render(() => {
    const [presentation, updatePresentation] = createSignal(initialPresentation);
    const [state, setState] = createSignal(initialState);
    setPresentation = updatePresentation;
    return (
      <OpenBotDynamicIsland
        presentation={presentation()}
        state={state()}
        onStateChange={setState}
        onAction={onAction}
        onHaptic={onHaptic}
      />
    );
  });
  return { setPresentation };
}

function approvalPresentation(): Extract<DynamicIslandPresentation, { mode: "approval" }> {
  return {
    serverId: "local",
    mode: "approval",
    remainingCount: 0,
    item: {
      requestId: "approval-1",
      agent: AGENT,
      title: "Command needs review",
      detail: "Install the locked dependencies.",
      truncated: false,
      approval: {
        kind: "command",
        command: "bun install --frozen-lockfile",
        cwd: "~/Projects/openbot",
        reason: "Install the locked dependencies.",
        grantRoot: null,
        permissions: null,
      },
    },
  };
}
