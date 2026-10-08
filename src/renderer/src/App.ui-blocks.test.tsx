import type { ConversationMessage } from "@openbot/contracts/ipc";
import {
  type ConversationUiBlock,
  type UiBlockSpec,
  type UiBlockState,
  uiBlockFallbackQuestions,
} from "@openbot/contracts/ui-blocks";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { confirmOnboardingModel, emitAgentEvent, installOpenbotStub } from "./app-test-harness";

const CHOICE: UiBlockSpec = {
  type: "choice",
  title: "What should I do with the letter?",
  options: [
    { id: "send", label: "Yes, send it" },
    { id: "wait", label: "Wait until Monday" },
  ],
};

function blockMessage(
  turnId: string,
  requestId: string,
  spec: UiBlockSpec,
  state: UiBlockState = { status: "pending" },
): ConversationMessage {
  const uiBlock: ConversationUiBlock = { version: 1, blockId: `block-${requestId}`, spec, state };
  return {
    id: `question-prompt:${turnId}:${requestId}`,
    turnId,
    author: "assistant",
    source: "assistant",
    text: spec.type === "choice" ? spec.title : "",
    createdAt: "2026-10-08T12:00:00.000Z",
    status: "completed",
    itemType: "question_prompt",
    questionPrompt: {
      requestId,
      questions: uiBlockFallbackQuestions(spec),
      resolution:
        state.status === "pending"
          ? null
          : state.status === "answered"
            ? { status: "answered", responses: {} }
            : { status: state.status === "expired" ? "expired" : "cancelled" },
    },
    uiBlock,
  };
}

function emitSnapshot(revision: number, turnId: string, messages: ConversationMessage[]): void {
  emitAgentEvent?.({
    type: "conversation",
    snapshot: { agentId: "chief", threadId: "thread-chief", activeTurnId: turnId, revision, messages },
  });
}

function emitPrompt(turnId: string, requestId: string, spec: UiBlockSpec): void {
  emitAgentEvent?.({
    type: "prompt",
    requestId,
    agentId: "chief",
    threadId: "thread-chief",
    turnId,
    questions: uiBlockFallbackQuestions(spec),
  });
}

async function openChief(): Promise<void> {
  render(() => <App />);
  await screen.findByRole("heading", { name: "Chief" });
  await confirmOnboardingModel();
}

describe("agent UI blocks in the conversation", () => {
  beforeEach(() => {
    installOpenbotStub();
  });

  it("draws a waiting block as a card and sends its answer through the prompt route", async () => {
    await openChief();
    emitSnapshot(10, "turn-1", [blockMessage("turn-1", "ask-1", CHOICE)]);
    emitPrompt("turn-1", "ask-1", CHOICE);

    const card = await screen.findByRole("article", { name: "What should I do with the letter?" });
    expect(screen.queryByRole("textbox", { name: /Custom answer for/u })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("radio", { name: "Yes, send it" }));
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(window.openbot.agent.respondToPrompt).toHaveBeenCalledWith({
        requestId: "ask-1",
        answers: { choice: ["Yes, send it"] },
      }),
    );
    // Until the host stores the answer, the card shows what was sent.
    await waitFor(() => expect(card).toHaveAttribute("data-status", "answered"));

    emitSnapshot(11, "turn-1", [
      blockMessage("turn-1", "ask-1", CHOICE, {
        status: "answered",
        response: { actionId: "submit", values: { selected: ["send"] } },
        outcome: "Yes, send it",
      }),
    ]);
    const frozen = await screen.findByRole("article", { name: "What should I do with the letter?" });
    await waitFor(() => expect(frozen).toHaveAttribute("data-status", "answered"));
    expect(frozen).toHaveTextContent("Yes, send it");
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("article", { name: "What should I do with the letter?" })).toHaveLength(1);
  });

  it("shows why an answer was refused inside the card and keeps the block open", async () => {
    vi.mocked(window.openbot.agent.respondToPrompt).mockRejectedValueOnce(
      new Error("Only the server owner or an admin can choose this action."),
    );
    await openChief();
    emitSnapshot(10, "turn-2", [blockMessage("turn-2", "ask-2", CHOICE)]);
    emitPrompt("turn-2", "ask-2", CHOICE);

    await screen.findByRole("article", { name: "What should I do with the letter?" });
    await fireEvent.click(screen.getByRole("radio", { name: "Wait until Monday" }));
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the server owner or an admin can choose this action.",
    );
    // The card shows the failure, so the conversation does not repeat it.
    expect(screen.queryByText("Answer failed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("skips a block with empty answers, as a skipped question", async () => {
    await openChief();
    emitSnapshot(10, "turn-3", [blockMessage("turn-3", "ask-3", CHOICE)]);
    emitPrompt("turn-3", "ask-3", CHOICE);

    await screen.findByRole("article", { name: "What should I do with the letter?" });
    await fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() =>
      expect(window.openbot.agent.respondToPrompt).toHaveBeenCalledWith({
        requestId: "ask-3",
        answers: { choice: [] },
      }),
    );
  });

  it("falls back to the question card while the block's message has not arrived", async () => {
    await openChief();
    emitSnapshot(10, "turn-4", []);
    emitPrompt("turn-4", "ask-4", CHOICE);

    expect(await screen.findByRole("textbox", { name: /Custom answer for/u })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "What should I do with the letter?" })).not.toBeInTheDocument();
  });

  it("draws an expired block frozen in the history", async () => {
    await openChief();
    emitSnapshot(10, "turn-5", [blockMessage("turn-5", "ask-5", CHOICE, { status: "expired" })]);

    const frozen = await screen.findByRole("article", { name: "What should I do with the letter?" });
    expect(frozen).toHaveAttribute("data-status", "expired");
    expect(frozen).toHaveTextContent("No answer was given in time");
    expect(screen.getByRole("radio", { name: "Yes, send it" })).toBeDisabled();
  });
});
