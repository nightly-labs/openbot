import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { installOpenbotStub } from "./app-test-harness";
import { AccountDock } from "./lazy-views";

beforeAll(async () => {
  await AccountDock.preload();
});

beforeEach(installOpenbotStub);

async function openSavedChannel() {
  await window.openbot.agent.channelCommand({
    type: "save",
    operationId: "create",
    channelId: "channel-test",
    draft: {
      name: "Project room",
      title: "",
      instructions: "Research the project",
      members: [{ agentId: "chief" }],
      leadAgentId: "chief",
    },
  });
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.click(await screen.findByRole("button", { name: /Project room/ }));
  const chat = await screen.findByRole("main", { name: "Channel conversation" });
  await within(chat).findByRole("heading", { name: "Project room", level: 1 });
  return chat;
}

/** The sidebar row reads like an agent row: the name, then the last message as its preview. */
function channelRow(name: string) {
  return screen.getByRole("button", { name: new RegExp(`^${name}\\.`) });
}

async function openChannelMenuItem(chat: HTMLElement, item: string) {
  await fireEvent.pointerDown(within(chat).getByRole("button", { name: "Channel options" }), { button: 0 });
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: item }), { button: 0 });
}

it("creates a channel from a searchable member dialog and keeps the chat open beside settings", async () => {
  const save = vi.spyOn(window.openbot.agent, "channelCommand");
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.pointerDown(await screen.findByRole("button", { name: "New agent or channel" }), { button: 0 });
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "New channel" }), { button: 0 });
  const dialog = await screen.findByRole("dialog", { name: "New channel" });
  await fireEvent.input(within(dialog).getByRole("textbox", { name: "Channel name" }), {
    target: { value: "Project room" },
  });
  const search = within(dialog).getByRole("searchbox", { name: "Search agents" });
  await fireEvent.input(search, { target: { value: "Chief" } });
  await fireEvent.click(within(dialog).getByRole("checkbox", { name: /Chief/ }));
  await fireEvent.click(within(dialog).getByRole("checkbox", { name: /Chief/ }));
  expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  await fireEvent.click(within(dialog).getByRole("checkbox", { name: /Chief/ }));
  await fireEvent.input(search, { target: { value: "Sales" } });
  expect(within(dialog).queryByRole("checkbox", { name: /Chief/ })).not.toBeInTheDocument();
  await fireEvent.click(within(dialog).getByRole("checkbox", { name: /Sales Outbound/ }));
  await fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0]?.[0]).toMatchObject({
    type: "save",
    draft: {
      leadAgentId: "chief",
      title: "",
      instructions: "",
      members: [{ agentId: "chief" }, { agentId: "sales-outbound" }],
    },
  });
  const chat = await screen.findByRole("main", { name: "Channel conversation" });
  await within(chat).findByRole("heading", { name: "Project room", level: 1 });
  const composer = within(chat).getByRole("textbox", { name: "Message to channel" });
  composer.textContent = "Keep this draft";
  await fireEvent.input(composer);
  await openChannelMenuItem(chat, "Channel settings");
  const instructions = await within(chat).findByRole("textbox", { name: "Channel instructions" });
  expect(instructions).toHaveValue("");
  expect(within(chat).getByRole("button", { name: "Chief is the channel lead" })).toBeVisible();
  expect(within(chat).getByRole("button", { name: "Make Sales Outbound the channel lead" })).toBeVisible();
  expect(composer).toHaveTextContent("Keep this draft");
  // Leaving a field is the only commit: the panel has to survive it, or the next edit has nowhere
  // to happen.
  await fireEvent.input(instructions, { target: { value: "Coordinate the release" } });
  await fireEvent.blur(instructions);
  await waitFor(() =>
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({
      type: "save",
      draft: { instructions: "Coordinate the release" },
    }),
  );
  expect(instructions).toBeVisible();
  await fireEvent.click(within(chat).getByRole("button", { name: "Remove Chief" }));
  await waitFor(() =>
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({
      type: "save",
      draft: { instructions: "Coordinate the release", members: [{ agentId: "sales-outbound" }] },
    }),
  );
});

it("retries a lost response once and keeps a focused draft through incoming messages", async () => {
  const chat = await openSavedChannel();
  const originalCommand = window.openbot.agent.channelCommand;
  let loseResponse = true;
  vi.spyOn(window.openbot.agent, "channelCommand").mockImplementation(async (input) => {
    const result = await originalCommand(input);
    if (input.type === "send" && loseResponse) {
      loseResponse = false;
      throw new Error("Connection lost after sending.");
    }
    return result;
  });
  const composer = within(chat).getByRole("textbox", { name: "Message to channel" });
  composer.textContent = "@[Chief](agent:chief) Prepare the report";
  await fireEvent.input(composer);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  await fireEvent.click(await within(chat).findByRole("button", { name: "Retry" }));
  expect(window.openbot.agent.channelCommand).toHaveBeenCalledWith(
    expect.objectContaining({ type: "send", recipientAgentId: "chief" }),
  );
  await waitFor(() => expect(composer).toHaveTextContent(""));
  expect(within(chat).getAllByRole("article", { name: "Message from You" })).toHaveLength(1);
  expect(within(chat).getByRole("article", { name: "Message from You" })).toHaveTextContent("Prepare the report");
  await waitFor(() =>
    expect(channelRow("Project room")).toHaveAccessibleName("Project room. @Chief Prepare the report"),
  );
  composer.textContent = "Keep this draft";
  await fireEvent.input(composer);
  composer.focus();
  await window.openbot.agent.channelCommand({
    type: "send",
    operationId: "incoming",
    channelId: "channel-test",
    text: "Another request",
    recipientAgentId: "chief",
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
  await within(chat).findByText("Another request");
  expect(composer).toHaveFocus();
  expect(composer).toHaveTextContent("Keep this draft");
});

it("stops and resumes a task and restores an archived channel without losing its work", async () => {
  const chat = await openSavedChannel();
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalCommand = window.openbot.agent.channelCommand;
  vi.spyOn(window.openbot.agent, "channelCommand").mockImplementation(async (input) => {
    const result = await originalCommand(input);
    if (input.type === "send") await response;
    return result;
  });
  const composer = within(chat).getByRole("textbox", { name: "Message to channel" });
  composer.textContent = "Prepare the report";
  await fireEvent.input(composer);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  await openChannelMenuItem(chat, "Channel tasks");
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
  await openChannelMenuItem(chat, "Archive");
  await fireEvent.click(await within(chat).findByRole("button", { name: "Archive channel" }));
  const restore = await within(chat).findByRole("button", { name: "Restore channel" });
  await waitFor(() => expect(restore).toBeEnabled());
  await fireEvent.click(restore);
  await within(chat).findByRole("textbox", { name: "Message to channel" });
  expect(within(chat).getByRole("article", { name: "Task: Prepare the report" })).toBeVisible();
});

it("opens channel memories and channel routines from the settings panel", async () => {
  const chat = await openSavedChannel();
  await openChannelMenuItem(chat, "Channel settings");
  await fireEvent.click(await within(chat).findByRole("button", { name: /^Memories0 saved$/ }));
  const memories = await screen.findByRole("dialog", { name: "Memories" });
  // The modal reads "channel", not "agent": the port names the owner, so the shared copy follows.
  await within(memories).findByText("This channel has no saved memories yet.");
  await fireEvent.click(within(memories).getByRole("button", { name: "Close memories" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Memories" })).not.toBeInTheDocument());
  await fireEvent.click(within(chat).getByRole("button", { name: /^Routines0 configured$/ }));
  // Routines replace the panel header, so "Channel settings" gives way to the routines view.
  await within(chat).findByRole("heading", { name: "Routines", level: 2 });
  expect(within(chat).queryByRole("heading", { name: "Channel settings" })).not.toBeInTheDocument();
  await fireEvent.click(within(chat).getByRole("button", { name: "Back to settings" }));
  await within(chat).findByRole("heading", { name: "Channel settings", level: 2 });
});
