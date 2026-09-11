import type { AgentApproval, BrowserFormSubmission } from "@openbot/contracts/ipc";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { userEvent } from "storybook/test";
import { describe, expect, it, vi } from "vitest";
import { installOpenbotStub } from "../../app-test-harness";
import { browserFormPreview } from "../../preview/browser-form-preview";
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

describe("takeover chat forms", () => {
  it.each(["click", "enter", "alternate", "website-validation"])(
    "submits with %s and clears values for the next step",
    async (method) => {
      installOpenbotStub();
      const login = browserFormPreview();
      login.forms[0].fields[0].multiple = true;
      login.forms[0].actions.push({ id: "alternate", label: "Use password" });
      vi.mocked(window.openbot.browser.readTakeoverForm).mockResolvedValue(login);
      const next = browserFormPreview();
      next.revision = "code-step";
      next.forms[0].fields = [{ ...next.forms[0].fields[0], id: "code", label: "Code", type: "text" }];
      next.forms[0].actions = [{ id: "verify", label: "Verify" }];
      let sent: BrowserFormSubmission | undefined;
      vi.mocked(window.openbot.browser.submitTakeoverForm).mockImplementation(async (input) => {
        sent = structuredClone(input);
        return next;
      });
      render(() => (
        <BrowserTakeoverCard
          agentName="Chief"
          tab={undefined}
          preview={null}
          previewStatus="failed"
          formRequest={{ requestId: "request", agentId: "chief", threadId: "thread", tabId: "tab" }}
          onComplete={async () => true}
          onCancel={async () => true}
        />
      ));
      const email = await screen.findByRole("textbox", { name: "Email (required)" });
      const emailValue =
        method === "website-validation" ? "website-validates-this" : "user@example.com,other@example.com";
      await fireEvent.input(email, { target: { value: emailValue } });
      await fireEvent.input(screen.getByLabelText("Password (required)"), { target: { value: "private-password" } });
      if (method === "enter") {
        email.focus();
        await userEvent.keyboard("{Enter}");
      } else
        await fireEvent.click(
          screen.getByRole("button", { name: method === "alternate" ? "Use password" : "Sign in" }),
        );
      expect(await screen.findByRole("textbox", { name: "Code (required)" })).toHaveValue("");
      expect(sent).toEqual(
        expect.objectContaining({
          requestId: "request",
          revision: "preview-form",
          formId: "sign-in",
          actionId: method === "alternate" ? "alternate" : "submit",
          values: [
            { id: "email", value: emailValue },
            { id: "password", value: "private-password" },
          ],
        }),
      );
      expect(window.openbot.agent.sendMessage).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Password (required)")).not.toBeInTheDocument();
    },
  );
  it("keeps manual takeover available when form discovery fails", async () => {
    installOpenbotStub();
    vi.mocked(window.openbot.browser.readTakeoverForm).mockRejectedValue(new Error("secret from page"));
    const open = vi.fn();
    render(() => (
      <BrowserTakeoverCard
        agentName="Chief"
        tab={undefined}
        preview={null}
        previewStatus="failed"
        formRequest={{ requestId: "request", agentId: "chief", threadId: "thread", tabId: "tab" }}
        onOpenBrowser={open}
        onComplete={async () => true}
        onCancel={async () => true}
      />
    ));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("secret from page");
    await fireEvent.click(screen.getByRole("button", { name: "Open browser" }));
    expect(open).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "I’m done" })).toBeEnabled();
  });
});
