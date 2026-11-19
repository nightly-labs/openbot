import {
  isContinueInterruptedResult,
  isInterruptedTurnsList,
} from "@openbot/contracts/team-protocol/interrupted-resume-v1";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { computeSidebarAgentStates } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { sidebarAgentStateLabel } from "@openbot/ui/features/sidebar/sidebar-filtering";
import { currentText } from "@openbot/ui/text";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

const baseAgent = (id: string, name: string) => ({
  id,
  name,
  title: "",
  description: "",
  provider: "claude" as const,
  model: "claude-sonnet-4-5",
  reasoningEffort: "medium" as const,
  workspacePath: "/tmp/ws",
  accessLevel: "full" as const,
  preview: "Last message",
  time: "12:00",
  avatarSeed: id,
  avatarHue: null,
  avatarColor: null,
  avatarUrl: null,
  notifications: true,
  threadId: null,
});

describe("Feature 2: interrupted task sidebar state & resume", () => {
  it("computes interrupted state with correct precedence over unread/responded and below working/waiting", () => {
    const states = computeSidebarAgentStates({
      agentIds: ["a1", "a2", "a3", "a4"],
      activeTurns: { a1: null, a2: "turn-running", a3: null, a4: null },
      queues: {},
      unreadReplies: { a1: 2, a2: 0, a3: 0, a4: 1 },
      recentReplies: { a1: true, a2: false, a3: false, a4: false },
      pendingPrompts: {
        a3: { type: "prompt", turnId: "t-wait" },
      },
      pendingApprovals: {},
      failedTurns: {},
      interruptedTurns: {
        a1: "turn-int-1",
        a2: "turn-int-2",
        a3: "turn-int-3",
      },
    });

    expect(states.a1).toEqual({ kind: "interrupted", turnId: "turn-int-1" });
    expect(states.a2).toEqual({ kind: "working" });
    expect(states.a3?.kind).toBe("waiting");
    expect(states.a4).toEqual({ kind: "unread", count: 1 });

    const { t, format } = currentText();
    expect(sidebarAgentStateLabel({ kind: "interrupted", turnId: "turn-int-1" }, t, format)).toBe("Interrupted");
  });

  it("renders Interrupted group with Continue all button and agent context-menu Continue action", async () => {
    const onContinueInterrupted = vi.fn();
    const agents = [baseAgent("agent-1", "Alpha"), baseAgent("agent-2", "Beta"), baseAgent("agent-3", "Gamma")];
    const agentStates = computeSidebarAgentStates({
      agentIds: agents.map((a) => a.id),
      activeTurns: {},
      queues: {},
      unreadReplies: {},
      recentReplies: {},
      pendingPrompts: {},
      pendingApprovals: {},
      failedTurns: {},
      interruptedTurns: { "agent-1": "turn-1", "agent-2": "turn-2" },
    });

    render(() => (
      <Sidebar
        serverName="Local"
        agents={agents}
        activeAgentId=""
        people={[]}
        directThreads={[]}
        activeDirectMemberId={null}
        peopleOrder={[]}
        onReorderPeople={vi.fn()}
        onSelectPerson={vi.fn()}
        agentStates={agentStates}
        agentMoods={{}}
        layout={{
          revision: 1,
          sections: [],
          agentOrder: ["agent-1", "agent-2", "agent-3"],
          order: [],
          agentAssignments: {},
        }}
        collapsedSectionIds={[]}
        onMutateLayout={vi.fn()}
        onToggleSection={vi.fn()}
        pinnedItems={[]}
        onPin={vi.fn()}
        onUnpin={vi.fn()}
        onReorderPinned={vi.fn()}
        onSelectAgent={vi.fn()}
        onCreateAgent={vi.fn()}
        onEditAgent={vi.fn()}
        onDeleteAgent={vi.fn()}
        compact={false}
        onExpand={vi.fn()}
        onOpenSearch={vi.fn()}
        onOpenMarketplace={vi.fn()}
        onContinueInterrupted={onContinueInterrupted}
      />
    ));

    const continueAllBtn = screen.getByRole("button", { name: "Continue all" });
    fireEvent.click(continueAllBtn);
    expect(onContinueInterrupted).toHaveBeenCalledWith(["agent-1", "agent-2"]);

    // Right-clicking an interrupted agent shows Continue in its context menu.
    const alphaRow = screen.getByRole("button", { name: /Alpha/i });
    fireEvent.contextMenu(alphaRow);
    const continueItem = await screen.findByRole("menuitem", { name: "Continue" });
    fireEvent.pointerDown(continueItem);
    fireEvent.pointerUp(continueItem);
    fireEvent.click(continueItem);
    expect(onContinueInterrupted).toHaveBeenCalledWith(["agent-1"]);
  });

  it("validates interrupted-resume-v1 contract payloads", () => {
    expect(isInterruptedTurnsList({ interruptedTurns: [{ agentId: "agent-1", turnId: "turn-1" }] })).toBe(true);
    expect(isInterruptedTurnsList({ interruptedTurns: [{ agentId: 123, turnId: "turn-1" }] })).toBe(false);
    expect(isContinueInterruptedResult({ continued: ["agent-1", "agent-2"] })).toBe(true);
    expect(isContinueInterruptedResult({ continued: [123] })).toBe(false);
  });
});
