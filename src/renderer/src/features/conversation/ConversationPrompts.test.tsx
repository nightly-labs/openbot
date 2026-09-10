import type { AgentApproval } from "@openbot/contracts/ipc";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ApprovalCard, BrowserTakeoverCard, ChoiceCard } from "./ConversationPrompts";

describe("ChoiceCard", () => {
  it("uses radio semantics and submits a selected predefined answer", async () => {
    const onSubmit = vi.fn(async () => true);
    render(() => <ChoiceCard title="Choose a focus" choices={["Research", "Writing"]} onSubmit={onSubmit} />);

    const research = screen.getByRole("radio", { name: "Research" });
    expect(screen.getByRole("radiogroup", { name: "Choose a focus" })).toBeInTheDocument();
    await fireEvent.click(research);

    expect(research).toBeChecked();
    expect(onSubmit).toHaveBeenCalledWith("Research");
  });

  it("submits a custom answer with Enter", async () => {
    const onSubmit = vi.fn(async () => true);
    render(() => (
      <ChoiceCard
        title="Choose a focus"
        choices={["Research", "Something else"]}
        customChoice="Something else"
        onSubmit={onSubmit}
      />
    ));

    await fireEvent.click(screen.getByRole("radio", { name: "Something else" }));
    await Promise.resolve();
    const input = screen.getByRole("textbox", { name: "Custom answer" });

    await fireEvent.input(input, { target: { value: "Build a prototype" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("Build a prototype");
  });
});

const approval: AgentApproval = {
  requestId: "approval-test",
  agentId: "agent-test",
  threadId: "thread-test",
  turnId: "turn-test",
  kind: "command",
  command: "bun run lint",
  cwd: null,
  reason: null,
  grantRoot: null,
  permissions: null,
};

describe("ApprovalCard", () => {
  it.each(["Allow", "Deny"])("sends %s once and permits retry when the response fails", async (action) => {
    const response = Promise.withResolvers<boolean>();
    const send = vi.fn(() => response.promise);
    const other = async () => false;
    render(() => (
      <ApprovalCard
        approval={approval}
        onApprove={action === "Allow" ? send : other}
        onReject={action === "Deny" ? send : other}
      />
    ));
    const button = screen.getByRole("button", { name: action });
    await fireEvent.click(button);
    await fireEvent.click(button);
    expect(send).toHaveBeenCalledTimes(1);
    response.resolve(false);
    await vi.waitFor(() => expect(button).toBeEnabled());
  });
});

describe("BrowserTakeoverCard", () => {
  it.each(["I’m done", "Cancel"])("sends %s once and permits retry when the response fails", async (action) => {
    const response = Promise.withResolvers<boolean>();
    const send = vi.fn(() => response.promise);
    const other = async () => false;
    render(() => (
      <BrowserTakeoverCard
        agentName="Rico"
        tab={undefined}
        preview={null}
        previewStatus="failed"
        onComplete={action === "I’m done" ? send : other}
        onCancel={action === "Cancel" ? send : other}
      />
    ));
    const button = screen.getByRole("button", { name: action });
    await fireEvent.click(button);
    await fireEvent.click(button);
    expect(send).toHaveBeenCalledTimes(1);
    response.resolve(false);
    await vi.waitFor(() => expect(button).toBeEnabled());
  });
});
