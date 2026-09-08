import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { installOpenbotStub } from "./app-test-harness";
import { AccountDock } from "./lazy-views";

beforeAll(async () => {
  await AccountDock.preload();
});

beforeEach(installOpenbotStub);

async function openSavedGroup() {
  await window.openbot.agent.groupCommand({
    type: "save",
    operationId: "create",
    groupId: "group-test",
    draft: {
      name: "Project room",
      purpose: "Research the project",
      members: [{ agentId: "chief", responsibility: "Research" }],
      leadAgentId: "chief",
      linkedThreadIds: [],
    },
  });
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.click(await screen.findByRole("button", { name: /Project room/ }));
  const chat = await screen.findByRole("main", { name: "Group conversation" });
  await within(chat).findByRole("heading", { name: "Project room", level: 1 });
  return chat;
}

it("creates a group from a searchable member dialog and keeps the chat open beside settings", async () => {
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.pointerDown(await screen.findByRole("button", { name: "New agent or group" }), { button: 0 });
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "New group" }), { button: 0 });
  const dialog = await screen.findByRole("dialog", { name: "New group" });
  await fireEvent.input(within(dialog).getByRole("textbox", { name: "Group name" }), {
    target: { value: "Project room" },
  });
  await fireEvent.input(within(dialog).getByRole("searchbox", { name: "Search agents" }), {
    target: { value: "Chief" },
  });
  await fireEvent.click(within(dialog).getByRole("checkbox", { name: /Chief/ }));
  await fireEvent.click(within(dialog).getByRole("button", { name: "Remove Chief" }));
  expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  await fireEvent.click(within(dialog).getByRole("checkbox", { name: /Chief/ }));
  await fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  const chat = await screen.findByRole("main", { name: "Group conversation" });
  await within(chat).findByRole("heading", { name: "Project room", level: 1 });
  const composer = within(chat).getByRole("textbox", { name: "Message to group" });
  composer.textContent = "Keep this draft";
  await fireEvent.input(composer);
  await fireEvent.pointerDown(within(chat).getByRole("button", { name: "Group options" }), { button: 0 });
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Group settings" }), { button: 0 });
  expect(await within(chat).findByRole("textbox", { name: "Group purpose" })).toHaveValue("");
  expect(composer).toBeVisible();
  expect(composer).toHaveTextContent("Keep this draft");
  await fireEvent.click(within(chat).getByRole("button", { name: "Cancel" }));
  expect(within(chat).queryByRole("textbox", { name: "Group purpose" })).not.toBeInTheDocument();
});

it("retries a lost response once and keeps a focused draft through incoming messages", async () => {
  const chat = await openSavedGroup();
  const originalCommand = window.openbot.agent.groupCommand;
  let loseResponse = true;
  vi.spyOn(window.openbot.agent, "groupCommand").mockImplementation(async (input) => {
    const result = await originalCommand(input);
    if (input.type === "send" && loseResponse) {
      loseResponse = false;
      throw new Error("Connection lost after sending.");
    }
    return result;
  });
  const composer = within(chat).getByRole("textbox", { name: "Message to group" });
  composer.textContent = "@[Chief](agent:chief) Prepare the report";
  await fireEvent.input(composer);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  await fireEvent.click(await within(chat).findByRole("button", { name: "Retry" }));
  expect(window.openbot.agent.groupCommand).toHaveBeenCalledWith(
    expect.objectContaining({ type: "send", recipientAgentId: "chief" }),
  );
  await waitFor(() => expect(composer).toHaveTextContent(""));
  expect(within(chat).getAllByRole("article", { name: "Message from You" })).toHaveLength(1);
  expect(within(chat).getByRole("article", { name: "Message from You" })).toHaveTextContent("Prepare the report");
  composer.textContent = "Keep this draft";
  await fireEvent.input(composer);
  composer.focus();
  await window.openbot.agent.groupCommand({
    type: "send",
    operationId: "incoming",
    groupId: "group-test",
    text: "Another request",
    recipientAgentId: "chief",
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
  await within(chat).findByText("Another request");
  expect(composer).toHaveFocus();
  expect(composer).toHaveTextContent("Keep this draft");
});

it("stops and resumes a task and restores an archived group without losing its work", async () => {
  const chat = await openSavedGroup();
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalCommand = window.openbot.agent.groupCommand;
  vi.spyOn(window.openbot.agent, "groupCommand").mockImplementation(async (input) => {
    const result = await originalCommand(input);
    if (input.type === "send") await response;
    return result;
  });
  const composer = within(chat).getByRole("textbox", { name: "Message to group" });
  composer.textContent = "Prepare the report";
  await fireEvent.input(composer);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  await fireEvent.click(within(chat).getByRole("button", { name: "Group tasks" }));
  const task = await within(chat).findByRole("article", { name: "Task: Prepare the report" });
  try {
    await fireEvent.click(within(task).getByRole("button", { name: "Stop" }));
    await within(task).findByRole("button", { name: "Resume" });
  } finally {
    release();
  }
  const resume = await within(task).findByRole("button", { name: "Resume" });
  await waitFor(() => expect(resume).toBeEnabled());
  await fireEvent.click(resume);
  await within(task).findByRole("button", { name: "Stop" });
  await waitFor(() => expect(within(task).getByRole("button", { name: "Stop" })).toBeEnabled());
  await fireEvent.pointerDown(within(chat).getByRole("button", { name: "Group options" }), { button: 0 });
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Archive" }), { button: 0 });
  await fireEvent.click(await within(chat).findByRole("button", { name: "Archive group" }));
  const restore = await within(chat).findByRole("button", { name: "Restore group" });
  await waitFor(() => expect(restore).toBeEnabled());
  await fireEvent.click(restore);
  await within(chat).findByRole("textbox", { name: "Message to group" });
  expect(within(chat).getByRole("article", { name: "Task: Prepare the report" })).toBeVisible();
});
