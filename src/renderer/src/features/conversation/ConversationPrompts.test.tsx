import type { AgentApproval, RespondToBrowserSecretInput } from "@openbot/contracts/ipc";
import { Toaster, toast } from "@openbot/ui";
import { BrowserSecretCard } from "@openbot/ui/features/conversation/BrowserSecretCard";
import { ApprovalCard, BrowserTakeoverCard, ChoiceCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

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
  afterEach(() => toast.dismiss());

  it("shows a failed grant write and restores the approval controls", async () => {
    const response = Promise.withResolvers<boolean>();
    const grant = vi.fn(() => response.promise);
    const approve = vi.fn(async () => true);
    render(() => (
      <>
        <Toaster />
        <ApprovalCard approval={approval} onApprove={approve} onReject={async () => true} onAlwaysAllow={grant} />
      </>
    ));
    await fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
    const confirmations = await screen.findAllByRole("button", { name: "Always allow" });
    const confirm = confirmations.at(-1);
    if (!confirm) throw new Error("The confirmation was not rendered.");
    await fireEvent.click(confirm);
    await vi.waitFor(() => expect(grant).toHaveBeenCalledOnce());
    response.reject(new Error("Could not save the standing approval."));
    expect(await screen.findByText("Could not save the standing approval.")).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Always allow" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();
    await fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(approve).toHaveBeenCalledOnce();
  });

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

  it("shows a failed approval response and permits retry", async () => {
    const approve = vi.fn().mockRejectedValueOnce(new Error("The host is offline.")).mockResolvedValueOnce(true);
    render(() => (
      <>
        <Toaster />
        <ApprovalCard approval={approval} onApprove={approve} onReject={async () => true} />
      </>
    ));

    const allow = screen.getByRole("button", { name: "Allow" });
    await fireEvent.click(allow);
    expect(await screen.findByText("The host is offline.")).toBeInTheDocument();
    await vi.waitFor(() => expect(allow).toBeEnabled());

    await fireEvent.click(allow);
    await vi.waitFor(() => expect(approve).toHaveBeenCalledTimes(2));
  });

  it("offers no standing grant where the caller gives none", () => {
    render(() => <ApprovalCard approval={approval} onApprove={async () => true} onReject={async () => true} />);
    expect(screen.queryByRole("button", { name: "Always allow" })).not.toBeInTheDocument();
  });

  it("confirms before granting, and grants nothing when the confirmation is cancelled", async () => {
    const grant = vi.fn(async () => true);
    const approve = vi.fn(async () => true);
    render(() => (
      <ApprovalCard
        approval={approval}
        agentName="Chief"
        onApprove={approve}
        onReject={async () => true}
        onAlwaysAllow={grant}
      />
    ));

    await fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
    expect(await screen.findByText("Always allow Chief?")).toBeInTheDocument();
    expect(grant).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(grant).not.toHaveBeenCalled();
    // The request is still the user's to answer: cancelling the grant must not answer it either way.
    expect(approve).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled();
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

describe("secure authentication card", () => {
  const request = {
    requestId: "auth",
    agentId: "agent",
    threadId: "thread",
    turnId: "turn",
    tabId: "tab",
    secret: { method: "otp" as const, origin: "https://example.com", digits: 6 },
  };

  it("sends the code only through the secure response and clears the input", async () => {
    const responses: RespondToBrowserSecretInput[] = [];
    const openPage = vi.fn();
    render(() => (
      <BrowserSecretCard
        request={request}
        onOpen={openPage}
        loadPreview={async () => ({ dataUrl: "data:image/png;base64,AA==", width: 960, height: 600 })}
        onRespond={async (input) => {
          responses.push({ ...input });
        }}
      />
    ));
    expect(await screen.findByRole("img", { name: "Preview of Sign-in page" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Open sign-in page in browser" }));
    expect(openPage).toHaveBeenCalledOnce();
    expect(responses).toEqual([]);
    const input = screen.getByLabelText("6-digit code");
    await fireEvent.input(input, { target: { value: "12 34 56" } });
    expect(responses).toEqual([]);
    expect(input).toHaveValue("");
    expect(screen.getByRole("form", { name: "Secure authentication" })).not.toHaveTextContent("123456");
    await fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await vi.waitFor(() =>
      expect(responses).toEqual([{ requestId: "auth", agentId: "agent", decision: "submit", secret: "123456" }]),
    );
    expect(input).toHaveValue("");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open sign-in page in browser" })).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Secure authentication" })).not.toHaveTextContent("123456");
  });

  it("discards a late preview after a rejected submission", async () => {
    let resolvePreview: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      resolvePreview = resolve;
    });
    const image = ready.then(() => ({ dataUrl: "data:image/png;base64,AA==", width: 960, height: 600 }));
    render(() => (
      <BrowserSecretCard
        request={request}
        loadPreview={() => image}
        onRespond={async () => {
          throw new Error("Disconnected");
        }}
      />
    ));
    await fireEvent.input(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    await fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByRole("alert");
    resolvePreview?.();
    await image;
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("does not send the entered value when cancelled", async () => {
    const responses: RespondToBrowserSecretInput[] = [];
    render(() => (
      <BrowserSecretCard
        request={request}
        onRespond={async (input) => {
          responses.push({ ...input });
        }}
      />
    ));
    await fireEvent.input(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(responses).toEqual([{ requestId: "auth", agentId: "agent", decision: "cancel" }]);
    expect(screen.getByLabelText("6-digit code")).toHaveValue("");
  });

  it("hides the submitted password input and restores it empty after a rejected response", async () => {
    let rejectResponse: ((error: Error) => void) | undefined;
    render(() => (
      <BrowserSecretCard
        request={{ ...request, secret: { ...request.secret, method: "password" } }}
        onRespond={() =>
          new Promise<void>((_resolve, reject) => {
            rejectResponse = reject;
          })
        }
      />
    ));
    await fireEvent.input(screen.getByLabelText("Password"), { target: { value: "private-password" } });
    await fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("button", { name: "Submitting…" })).toBeDisabled();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    if (!rejectResponse) throw new Error("Missing pending response.");
    rejectResponse(new Error("private-password"));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("private-password");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });
});
