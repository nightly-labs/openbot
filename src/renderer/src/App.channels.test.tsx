import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { installOpenbotStub, testServer } from "./app-test-harness";
import { CHANNEL_SELECTION_STORAGE_KEY } from "./features/channels/channel-selection";
import { AccountDock } from "./lazy-views";

beforeAll(async () => {
  await AccountDock.preload();
});

beforeEach(installOpenbotStub);

async function openSavedChannel(onUnmount?: (unmount: () => void) => void) {
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
  const view = render(() => <App />);
  onUnmount?.(view.unmount);
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

async function openChannelMenuItem(item: string) {
  await fireEvent.contextMenu(channelRow("Project room"));
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: item }), { button: 0 });
}

it("restores the selected channel after restart and clears it when returning to an agent", async () => {
  let unmount: (() => void) | undefined;
  await openSavedChannel((dispose) => {
    unmount = dispose;
  });
  expect(JSON.parse(window.localStorage.getItem(CHANNEL_SELECTION_STORAGE_KEY) ?? "{}")).toEqual({
    "user-1": { local: "channel-test" },
  });

  unmount?.();
  const restarted = render(() => <App />);
  await within(await screen.findByRole("main", { name: "Channel conversation" })).findByRole("heading", {
    name: "Project room",
    level: 1,
  });

  await fireEvent.click(screen.getByRole("button", { name: /^Chief, Chief of staff/ }));
  await screen.findByRole("main", { name: "Conversation" });
  expect(window.localStorage.getItem(CHANNEL_SELECTION_STORAGE_KEY)).toBe("{}");

  restarted.unmount();
  const view = render(() => <App />);
  expect(await screen.findByRole("heading", { name: "Chief", level: 1 })).toBeVisible();
  view.unmount();
});

it("opens the agent chat when Edit agent runs while a channel is open", async () => {
  await openSavedChannel();

  await fireEvent.contextMenu(screen.getByRole("button", { name: /^Chief, Chief of staff/ }));
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Edit agent" }), { button: 0 });

  await screen.findByRole("main", { name: "Conversation" });
  expect(screen.queryByRole("main", { name: "Channel conversation" })).toBeNull();
});

it.each([0, 1])("opens the agent chat from author control %i", async (control) => {
  const read = window.openbot.agent.readChannel;
  vi.spyOn(window.openbot.agent, "readChannel").mockImplementation(async (input) => ({
    ...(await read(input)),
    messages: [
      {
        id: "reply",
        channelId: input.channelId,
        sequence: 1,
        author: { kind: "agent", id: "chief", name: "Chief" },
        taskId: null,
        superseded: false,
        message: {
          id: "reply",
          author: "assistant",
          text: "The report is ready.",
          createdAt: new Date().toISOString(),
          status: "completed",
        },
      },
    ],
  }));
  const chat = await openSavedChannel();
  const controls = await within(chat).findAllByRole("button", { name: "Open Chief's chat" });
  await fireEvent.click(controls[control]);
  const conversation = await screen.findByRole("main", { name: "Conversation" });
  expect(within(conversation).getByRole("heading", { name: "Chief", level: 1 })).toBeVisible();
});

it.each(["owner", "admin", "member"] as const)("limits remote channel deletion for %s", async (role) => {
  vi.mocked(window.openbot.servers.list).mockResolvedValue([
    {
      ...testServer("remote-1", true),
      role,
      compatibility: {
        localAppVersion: "0.4.0",
        hostAppVersion: "0.4.0",
        localProtocol: { minimum: 3, maximum: 3 },
        hostProtocol: { minimum: 3, maximum: 3 },
        negotiatedProtocol: 3,
        capabilities: ["channel-chats-v1", "channel-delete-v1"],
      },
    },
  ]);
  await openSavedChannel();
  await fireEvent.contextMenu(channelRow("Project room"));
  await screen.findByRole("menuitem", { name: "Edit channel" });
  if (role === "member") {
    expect(screen.queryByRole("menuitem", { name: "Delete channel" })).not.toBeInTheDocument();
  } else {
    expect(screen.getByRole("menuitem", { name: "Delete channel" })).toBeVisible();
  }
});

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
  await openChannelMenuItem("Edit channel");
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

it("keeps both removals when the second starts before the first save lands", async () => {
  await window.openbot.agent.channelCommand({
    type: "save",
    operationId: "create",
    channelId: "channel-test",
    draft: {
      name: "Project room",
      title: "",
      instructions: "",
      members: [{ agentId: "chief" }, { agentId: "sales-outbound" }],
      leadAgentId: "chief",
    },
  });
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.click(await screen.findByRole("button", { name: /Project room/ }));
  const chat = await screen.findByRole("main", { name: "Channel conversation" });
  await within(chat).findByRole("heading", { name: "Project room", level: 1 });
  await openChannelMenuItem("Edit channel");
  await within(chat).findByRole("button", { name: "Remove Chief" });

  // Both saves wait on one gate, so the second removal is started while the first is in flight.
  // A draft carries the whole member list, so a second draft built from the state before the
  // first save would put Chief back.
  const original = window.openbot.agent.channelCommand;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(window.openbot.agent, "channelCommand").mockImplementation(async (input) => {
    if (input.type === "save") await gate;
    return original(input);
  });
  void fireEvent.click(within(chat).getByRole("button", { name: "Remove Chief" }));
  void fireEvent.click(within(chat).getByRole("button", { name: "Remove Sales Outbound" }));
  release();

  await waitFor(() => expect(within(chat).queryByRole("button", { name: "Remove Sales Outbound" })).toBeNull());
  expect(within(chat).queryByRole("button", { name: "Remove Chief" })).toBeNull();
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

it("deletes a channel from the sidebar and keeps its member agents", async () => {
  await openSavedChannel();
  await openChannelMenuItem("Delete channel");
  const dialog = await screen.findByRole("alertdialog", { name: "Delete Project room?" });
  await fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.queryByRole("main", { name: "Channel conversation" })).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /^Project room\./ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Chief, Chief of staff/ })).toBeInTheDocument();
  expect(window.localStorage.getItem(CHANNEL_SELECTION_STORAGE_KEY)).toBe("{}");
  expect((await window.openbot.agent.listChannels()).some((channel) => channel.id === "channel-test")).toBe(false);
});

it("closes a channel deleted from another connection", async () => {
  await openSavedChannel();
  await window.openbot.agent.deleteChannel("channel-test");
  await waitFor(() => expect(screen.queryByRole("main", { name: "Channel conversation" })).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /^Project room\./ })).not.toBeInTheDocument();
});

it("opens channel memories and channel routines from the settings panel", async () => {
  const chat = await openSavedChannel();
  await openChannelMenuItem("Edit channel");
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
