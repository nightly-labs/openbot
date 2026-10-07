import type { ChannelPage } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { assert, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { emitAgentEvent, installOpenbotStub, testServer } from "./app-test-harness";
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

it("keeps unsent agent and channel drafts through a chat switch and a restart", async () => {
  let unmount: (() => void) | undefined;
  const chat = await openSavedChannel((dispose) => {
    unmount = dispose;
  });
  const channelComposer = within(chat).getByRole("textbox", { name: "Message to channel" });
  channelComposer.textContent = "Channel draft";
  await fireEvent.input(channelComposer);
  await fireEvent.click(screen.getByRole("button", { name: /^Chief, Chief of staff/ }));
  const agentComposer = await screen.findByRole("textbox", { name: "Message Chief" });
  agentComposer.textContent = "Agent draft";
  await fireEvent.input(agentComposer);
  await fireEvent.click(channelRow("Project room"));
  const returnedChat = await screen.findByRole("main", { name: "Channel conversation" });
  expect(await within(returnedChat).findByRole("textbox", { name: "Message to channel" })).toHaveTextContent(
    "Channel draft",
  );

  // Unmounting the app writes the drafts at once, the way a quit inside the write delay does.
  unmount?.();
  const restarted = render(() => <App />);
  const restartedChat = await screen.findByRole("main", { name: "Channel conversation" });
  expect(await within(restartedChat).findByRole("textbox", { name: "Message to channel" })).toHaveTextContent(
    "Channel draft",
  );
  await fireEvent.click(screen.getByRole("button", { name: /^Chief, Chief of staff/ }));
  expect(await screen.findByRole("textbox", { name: "Message Chief" })).toHaveTextContent("Agent draft");
  restarted.unmount();
});

it("shows the channel title in the header and sidebar and refreshes it after editing", async () => {
  await window.openbot.agent.channelCommand({
    type: "save",
    operationId: "create-titled",
    channelId: "channel-titled",
    draft: {
      name: "Launch room",
      title: "Ship OpenBot 1.0",
      instructions: "Ship the launch",
      members: [{ agentId: "chief" }],
      leadAgentId: "chief",
    },
  });
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });

  const row = await screen.findByRole("button", { name: "Launch room, Ship OpenBot 1.0. No messages yet" });
  expect(within(row).getByText("Ship OpenBot 1.0")).toBeVisible();
  await fireEvent.click(row);

  const chat = await screen.findByRole("main", { name: "Channel conversation" });
  const settings = await within(chat).findByRole("button", { name: "Channel settings" });
  expect(within(settings).getByText("Ship OpenBot 1.0")).toBeVisible();

  await fireEvent.click(settings);
  const title = await within(chat).findByRole("textbox", { name: "Channel title" });
  await fireEvent.input(title, { target: { value: "Weekly sync" } });
  await fireEvent.blur(title);

  await waitFor(() => {
    expect(
      within(within(chat).getByRole("button", { name: "Channel settings" })).getByText("Weekly sync"),
    ).toBeVisible();
    expect(
      within(screen.getByRole("button", { name: "Launch room, Weekly sync. No messages yet" })).getByText(
        "Weekly sync",
      ),
    ).toBeVisible();
  });
});

it("shows the lead's routing choice as activity, not as a message from the lead", async () => {
  await window.openbot.agent.channelCommand({
    type: "save",
    operationId: "create-routed",
    channelId: "channel-routed",
    draft: {
      name: "Launch room",
      title: "",
      instructions: "Ship the launch",
      members: [{ agentId: "chief" }, { agentId: "sales-outbound" }],
      leadAgentId: "chief",
    },
  });
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.click(await screen.findByRole("button", { name: /Launch room/ }));
  const chat = await screen.findByRole("main", { name: "Channel conversation" });
  await within(chat).findByRole("heading", { name: "Launch room", level: 1 });
  // A released client still uses send; its routing receipt remains readable by the new UI.
  await window.openbot.agent.channelCommand({
    type: "send",
    operationId: "legacy-routing",
    channelId: "channel-routed",
    text: "Someone please draft the announcement",
    recipientAgentId: null,
    replyToMessageId: null,
    attachmentDraftIds: [],
  });

  const receipt = await within(chat).findByLabelText("Assigned to Chief");
  // Activity carries no bubble, so it offers none of the actions a message row does.
  expect(within(receipt).queryByRole("button", { name: "Copy" })).toBeNull();
  expect(within(receipt).queryByRole("button", { name: "Reply" })).toBeNull();
  expect(within(chat).queryByRole("article", { name: "Message from Chief" })).toBeNull();
  // The member it names stays reachable from the row.
  expect(within(receipt).getByRole("button", { name: "Open chat with Chief" })).toBeInTheDocument();
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
  const authorControl = controls[control];
  assert(authorControl);
  await fireEvent.click(authorControl);
  const conversation = await screen.findByRole("main", { name: "Conversation" });
  expect(within(conversation).getByRole("heading", { name: "Chief", level: 1 })).toBeVisible();
});

it("reports a message copy that the clipboard refuses", async () => {
  const writeText = vi.fn().mockRejectedValue(new DOMException("Document is not focused.", "NotAllowedError"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
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
  try {
    const chat = await openSavedChannel();
    await fireEvent.pointerDown(await within(chat).findByRole("button", { name: "More message actions" }), {
      button: 0,
    });
    await fireEvent.pointerUp(screen.getByRole("menuitem", { name: "Copy" }), { button: 0 });

    expect(await within(chat).findByRole("alert")).toHaveTextContent("Could not copy the message.");
    expect(writeText).toHaveBeenCalledWith("The report is ready.");
  } finally {
    Reflect.deleteProperty(document, "execCommand");
  }
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

it("opens the channel creation dialog from both sidebar context menus", async () => {
  await openSavedChannel();
  await fireEvent.contextMenu(channelRow("Project room"));
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "New channel" }), { button: 0 });
  const dialog = await screen.findByRole("dialog", { name: "New channel" });
  await fireEvent.click(within(dialog).getByRole("button", { name: "Close new channel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "New channel" })).not.toBeInTheDocument());

  await fireEvent.contextMenu(screen.getByLabelText("Sidebar free area"));
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "New channel" }), { button: 0 });
  await screen.findByRole("dialog", { name: "New channel" });
});

it("closes sidebar context menus on a left press on their trigger, outside press, and Escape", async () => {
  const chat = await openSavedChannel();
  const freeArea = screen.getByLabelText("Sidebar free area");
  const sidebarMenuClosed = () =>
    waitFor(() => expect(screen.queryByRole("menu", { name: "Sidebar actions" })).not.toBeInTheDocument());

  await fireEvent.contextMenu(freeArea);
  await screen.findByRole("menu", { name: "Sidebar actions" });
  await fireEvent.pointerDown(freeArea, { button: 0 });
  await sidebarMenuClosed();

  await fireEvent.contextMenu(freeArea);
  const menu = await screen.findByRole("menu", { name: "Sidebar actions" });
  await fireEvent.keyDown(menu, { key: "Escape" });
  await sidebarMenuClosed();

  await fireEvent.contextMenu(channelRow("Project room"));
  await screen.findByRole("menuitem", { name: "Edit channel" });
  await fireEvent.pointerDown(channelRow("Project room"), { button: 0 });
  await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Edit channel" })).not.toBeInTheDocument());

  await fireEvent.contextMenu(freeArea);
  await screen.findByRole("menu", { name: "Sidebar actions" });
  await waitFor(async () => {
    await fireEvent.pointerDown(chat, { button: 0 });
    expect(screen.queryByRole("menu", { name: "Sidebar actions" })).not.toBeInTheDocument();
  });
});

it("keeps the section editor open past menu focus restoration", async () => {
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  // Hold the trigger: the open menu hides the background from role queries.
  const trigger = await screen.findByRole("button", { name: "New agent or channel" });
  await fireEvent.pointerDown(trigger, { button: 0 });
  const item = await screen.findByRole("menuitem", { name: "New section" });
  // Frames are a fake modeling animation-frame timing, not a sleep: each step runs exactly
  // the callbacks the production code scheduled.
  const pendingFrames: FrameRequestCallback[] = [];
  const restore = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    pendingFrames.push(callback);
    return pendingFrames.length;
  });
  const runFrame = async () => {
    // Browsers checkpoint microtasks between callbacks in the same frame.
    for (const callback of pendingFrames.splice(0)) {
      callback(performance.now());
      await Promise.resolve();
    }
  };
  try {
    await fireEvent.pointerUp(item, { button: 0 });
    // The menu hands focus back to its trigger two frames after closing (focusRestoreHandler
    // in components/ui/complex.tsx); the editor must open only after that. Keep the counts
    // in step with complex.tsx.
    await runFrame();
    await runFrame();
    // This is exactly what that restoration does: focus the trigger. An editor that opened
    // too early loses its input to this steal and cancels on blur.
    trigger.focus();
    await runFrame();
    await runFrame();
    expect(screen.getByLabelText("New section")).toBeInTheDocument();
    expect(screen.getByLabelText("New section name")).toHaveFocus();
  } finally {
    restore.mockRestore();
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

it("keeps the channel the reader opened while the save that creates another one is in flight", async () => {
  await window.openbot.agent.channelCommand({
    type: "save",
    operationId: "create",
    channelId: "channel-test",
    draft: {
      name: "Project room",
      title: "",
      instructions: "",
      members: [{ agentId: "chief" }],
      leadAgentId: "chief",
    },
  });
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.pointerDown(await screen.findByRole("button", { name: "New agent or channel" }), { button: 0 });
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "New channel" }), { button: 0 });
  const dialog = await screen.findByRole("dialog", { name: "New channel" });
  await fireEvent.input(within(dialog).getByRole("textbox", { name: "Channel name" }), {
    target: { value: "Release room" },
  });
  await fireEvent.click(within(dialog).getByRole("checkbox", { name: /Chief/ }));

  // The save waits on a gate, so the reader leaves the new channel while it is in flight.
  const original = window.openbot.agent.channelCommand;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(window.openbot.agent, "channelCommand").mockImplementation(async (input) => {
    if (input.type === "save") await gate;
    return original(input);
  });
  void fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  await fireEvent.click(within(dialog).getByRole("button", { name: "Close new channel" }));
  await fireEvent.click(await screen.findByRole("button", { name: /Project room/ }));
  const chat = await screen.findByRole("main", { name: "Channel conversation" });
  await within(chat).findByRole("heading", { name: "Project room", level: 1 });
  release();

  // The new channel arrives in the sidebar, but the reader stays where they went.
  await screen.findByRole("button", { name: /Release room/ });
  expect(within(chat).getByRole("heading", { level: 1 })).toHaveTextContent("Project room");
  expect(JSON.parse(window.localStorage.getItem(CHANNEL_SELECTION_STORAGE_KEY) ?? "{}")).toEqual({
    "user-1": { local: "channel-test" },
  });
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

it("builds the second removal on a channel read that started after the first save", async () => {
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

  // A read of the channel is already in flight when the first removal is saved, and it answers
  // with the members it found before that save. A draft carries the whole member list, so a save
  // that ends on this answer builds the next draft from the list it replaced. Every later read is
  // held as well, so this answer is the only one the second draft can be built on.
  let releaseFirstRead: () => void = () => undefined;
  let releaseLaterReads: () => void = () => undefined;
  const firstRead = new Promise<void>((resolve) => {
    releaseFirstRead = resolve;
  });
  const laterReads = new Promise<void>((resolve) => {
    releaseLaterReads = resolve;
  });
  let reads = 0;
  const originalRead = window.openbot.agent.readChannel;
  vi.spyOn(window.openbot.agent, "readChannel").mockImplementation(async (input) => {
    const first = ++reads === 1;
    // The answer holds the members this read found, not the ones the store keeps when it lands.
    const answer = structuredClone(await originalRead(input));
    await (first ? firstRead : laterReads);
    return answer;
  });
  emitAgentEvent?.({ type: "channels-changed", channelId: "channel-test", revision: 1 });
  await waitFor(() => expect(reads).toBe(1));

  const command = vi.spyOn(window.openbot.agent, "channelCommand");
  const saves = () => command.mock.calls.map(([input]) => input).filter((input) => input.type === "save");
  void fireEvent.click(within(chat).getByRole("button", { name: "Remove Chief" }));
  void fireEvent.click(within(chat).getByRole("button", { name: "Remove Sales Outbound" }));
  await waitFor(() => expect(saves()).toHaveLength(1));
  await command.mock.results[0]?.value;
  releaseFirstRead();
  await waitFor(() => expect(reads).toBe(2));
  releaseLaterReads();

  // The second save builds on the first: it removes the last member instead of restoring Chief.
  await waitFor(() => expect(saves()).toHaveLength(2));
  expect(saves().map((input) => (input.type === "save" ? input.draft.members : null))).toEqual([
    [{ agentId: "sales-outbound" }],
    [],
  ]);
  await waitFor(() => expect(within(chat).queryByRole("button", { name: "Remove Sales Outbound" })).toBeNull());
  expect(within(chat).queryByRole("button", { name: "Remove Chief" })).toBeNull();
});

it("keeps a queued settings save on the channel it was made in", async () => {
  for (const [channelId, name] of [
    ["channel-test", "Project room"],
    ["channel-other", "Release room"],
  ] satisfies [string, string][]) {
    await window.openbot.agent.channelCommand({
      type: "save",
      operationId: `create-${channelId}`,
      channelId,
      draft: {
        name,
        title: "",
        instructions: "",
        members: [{ agentId: "chief" }, { agentId: "sales-outbound" }],
        leadAgentId: "chief",
      },
    });
  }
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.click(await screen.findByRole("button", { name: /Project room/ }));
  const chat = await screen.findByRole("main", { name: "Channel conversation" });
  await within(chat).findByRole("heading", { name: "Project room", level: 1 });
  await openChannelMenuItem("Edit channel");
  await within(chat).findByRole("button", { name: "Remove Chief" });

  // Both removals wait on one gate, and the reader opens the other channel while they wait.
  const original = window.openbot.agent.channelCommand;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = vi.spyOn(window.openbot.agent, "channelCommand").mockImplementation(async (input) => {
    if (input.type === "save") await gate;
    return original(input);
  });
  void fireEvent.click(within(chat).getByRole("button", { name: "Remove Chief" }));
  void fireEvent.click(within(chat).getByRole("button", { name: "Remove Sales Outbound" }));
  await fireEvent.click(screen.getByRole("button", { name: /Release room/ }));
  release();

  // Both saves belong to the channel they were made in, and the second builds on the first.
  await waitFor(() => expect(save.mock.calls.filter(([input]) => input.type === "save")).toHaveLength(2));
  const saves = save.mock.calls.map(([input]) => input).filter((input) => input.type === "save");
  expect(saves.map((input) => input.channelId)).toEqual(["channel-test", "channel-test"]);
  expect(saves.at(-1)).toMatchObject({ draft: { name: "Project room", members: [] } });
  // A settings save edits the channel that is open. It must never create one, or a save queued
  // behind the deletion of its own channel would bring the channel back.
  expect(saves.map((input) => input.type === "save" && input.update === true)).toEqual([true, true]);
});

/** Stopped task via read; the stub skips the automatic assignment limit. */
const STOPPED_TASK_REASON = "The automatic assignment limit was reached. Continue or reassign this task.";
it("shows a channel read that lands while more changes are still arriving", async () => {
  const chat = await openSavedChannel();
  // Hold every read open so events overtake them the way streaming does (see channels-context).
  const gates: Array<() => void> = [];
  const originalRead = window.openbot.agent.readChannel;
  vi.spyOn(window.openbot.agent, "readChannel").mockImplementation(async (input) => {
    await new Promise<void>((resolve) => gates.push(resolve));
    return originalRead(input);
  });
  await window.openbot.agent.channelCommand({
    type: "send",
    operationId: "request",
    channelId: "channel-test",
    text: "Prepare the report",
    recipientAgentId: "chief",
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
  emitAgentEvent?.({ type: "channels-changed", channelId: "channel-test", revision: 1 });
  await waitFor(() => expect(gates).toHaveLength(1));
  for (const revision of [2, 3, 4]) emitAgentEvent?.({ type: "channels-changed", channelId: "channel-test", revision });

  // The running read answers for the changes behind it (see channels-context).
  gates[0]?.();
  await within(chat).findByRole("article", { name: "Message from You" });
  expect(within(chat).getByRole("article", { name: "Message from You" })).toHaveTextContent("Prepare the report");
  for (const release of gates) release();
});

async function openChannelWithStoppedTask(
  options: { withChild?: boolean; state?: "paused" | "failed"; waitingRoot?: boolean } = {},
) {
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
  await window.openbot.agent.channelCommand({
    type: "send",
    operationId: "request",
    channelId: "channel-test",
    text: "Prepare the report",
    recipientAgentId: "chief",
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
  const originalRead = window.openbot.agent.readChannel;
  const state = { taskId: "", childTaskId: "", stopped: true };
  const read = vi.spyOn(window.openbot.agent, "readChannel").mockImplementation(async (input) => {
    const page = await originalRead(input);
    state.taskId = page.tasks[0]?.id ?? "";
    if (!state.stopped) return page;
    const stopped = page.tasks.map((task) => ({
      ...task,
      state: options.state ?? ("paused" as const),
      error: STOPPED_TASK_REASON,
    }));
    // The assignment limit stops the root task and everything under it, so the child arrives
    // stopped with the same reason on it.
    const child = stopped[0] ? [{ ...stopped[0], id: `${stopped[0].id}-child`, parentTaskId: stopped[0].id }] : [];
    state.childTaskId = child[0]?.id ?? "";
    if (options.waitingRoot)
      return {
        ...page,
        tasks: [...stopped.map((task) => ({ ...task, state: "waiting" as const, error: null })), ...child],
      };
    return { ...page, tasks: options.withChild ? [...stopped, ...child] : stopped };
  });
  const originalCommand = window.openbot.agent.channelCommand;
  const command = vi.spyOn(window.openbot.agent, "channelCommand").mockImplementation(async (input) => {
    // The child exists in this read fixture; use the saved root to apply its recovery transition.
    const result = await originalCommand(
      (input.type === "resume" || input.type === "reassign") && input.taskId === state.childTaskId
        ? { ...input, taskId: state.taskId }
        : input,
    );
    if (input.type === "resume" || input.type === "reassign") state.stopped = false;
    return result;
  });
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.click(await screen.findByRole("button", { name: /Project room/ }));
  const chat = await screen.findByRole("main", { name: "Channel conversation" });
  const notice = await within(chat).findByRole("region", { name: "Stopped task for Chief" });
  return { chat, notice, command, read, state };
}

it("continues a task the channel stopped with a reason", async () => {
  const { notice, command, state } = await openChannelWithStoppedTask();
  expect(notice).toHaveTextContent(STOPPED_TASK_REASON);
  await fireEvent.click(within(notice).getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resume", taskId: state.taskId, recipientAgentId: null }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("region", { name: "Stopped task for Chief" })).not.toBeInTheDocument());
});

it("shows one notice for a stopped run and continues it at the root", async () => {
  const { command, state } = await openChannelWithStoppedTask({ withChild: true });
  expect(screen.getAllByRole("region", { name: /^Stopped task for / })).toHaveLength(1);
  const notice = screen.getByRole("region", { name: /^Stopped task for / });
  await fireEvent.click(within(notice).getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: "resume", taskId: state.taskId })),
  );
});

it("reassigns a task the channel stopped with a reason", async () => {
  const { notice, command, state } = await openChannelWithStoppedTask();
  await fireEvent.pointerDown(within(notice).getByRole("button", { name: "Reassign the stopped task of Chief" }), {
    button: 0,
  });
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Sales Outbound" }), { button: 0 });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ type: "reassign", taskId: state.taskId, recipientAgentId: "sales-outbound" }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("region", { name: "Stopped task for Chief" })).not.toBeInTheDocument());
});

it.each(["paused", "failed"] as const)("keeps recovery for a %s child under a waiting root", async (state) => {
  const { notice, command, state: tasks } = await openChannelWithStoppedTask({ waitingRoot: true, state });
  expect(notice).toHaveTextContent(STOPPED_TASK_REASON);
  expect(within(notice).getByRole("button", { name: "Reassign the stopped task of Chief" })).toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Task for Chief" })).getByRole("button", { name: "Stop this task" }),
  ).toBeInTheDocument();
  await fireEvent.click(within(notice).getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: "resume", taskId: tasks.childTaskId })),
  );
});

it("keeps a stopped-task notice after a failed action and a refresh", async () => {
  const { notice, command, read } = await openChannelWithStoppedTask();
  command.mockRejectedValueOnce(new Error("Connection lost. Try again."));
  await fireEvent.click(within(notice).getByRole("button", { name: "Continue" }));
  await screen.findByText("Connection lost. Try again.");
  expect(screen.getByRole("region", { name: "Stopped task for Chief" })).toHaveTextContent(STOPPED_TASK_REASON);

  read.mockClear();
  await fireEvent.focus(window);
  await waitFor(() => expect(read).toHaveBeenCalled());
  expect(await screen.findByRole("region", { name: "Stopped task for Chief" })).toHaveTextContent(STOPPED_TASK_REASON);
  await fireEvent.click(
    within(screen.getByRole("region", { name: "Stopped task for Chief" })).getByRole("button", { name: "Continue" }),
  );
  await waitFor(() => expect(screen.queryByRole("region", { name: "Stopped task for Chief" })).not.toBeInTheDocument());
});

it("retries a lost response once and keeps a focused draft through incoming messages", async () => {
  const chat = await openSavedChannel();
  const originalCommand = window.openbot.agent.channelCommand;
  let loseResponse = true;
  vi.spyOn(window.openbot.agent, "channelCommand").mockImplementation(async (input) => {
    const result = await originalCommand(input);
    if (input.type === "coordinate" && loseResponse) {
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
    expect.objectContaining({ type: "coordinate", audience: "lead" }),
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

it("keeps deleted channel history for preview below active chats", async () => {
  const chat = await openSavedChannel();
  const composer = within(chat).getByRole("textbox", { name: "Message to channel" });
  composer.textContent = "Keep this history";
  await fireEvent.input(composer);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  await within(chat).findByText("Keep this history");
  await waitFor(() => expect(composer).toHaveTextContent(""));
  await waitFor(() => expect(channelRow("Project room")).toHaveAccessibleName("Project room. Keep this history"));
  await openChannelMenuItem("Delete channel");
  const dialog = await screen.findByRole("alertdialog", { name: "Delete Project room?" });
  await fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /^Project room\./ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Chief, Chief of staff/ })).toBeInTheDocument();
  expect((await window.openbot.agent.listChannels()).find((channel) => channel.id === "channel-test")?.archived).toBe(
    true,
  );
  await within(chat).findByText("Deleted channel. Preview only.");
  expect(within(chat).queryByRole("textbox")).not.toBeInTheDocument();
  expect(within(chat).queryByRole("button", { name: /Reply to/ })).not.toBeInTheDocument();
  expect(within(chat).getByRole("button", { name: "Channel settings" })).toBeDisabled();
  expect(within(chat).getByText("Keep this history")).toBeInTheDocument();
  await fireEvent.contextMenu(screen.getByLabelText("Sidebar free area"));
  await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Deleted channels" }), { button: 0 });
  const deleted = await screen.findByRole("region", { name: "Deleted channels" });
  expect(within(deleted).getByRole("button", { name: /^Project room\./ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Chief, Chief of staff/ })).toBeInTheDocument();
});

it("closes a channel deleted from another connection", async () => {
  await openSavedChannel();
  await window.openbot.agent.deleteChannel("channel-test");
  await waitFor(() => expect(screen.queryByRole("main", { name: "Channel conversation" })).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /^Project room\./ })).not.toBeInTheDocument();
});

it("addresses a channel member only while the request names one", async () => {
  const chat = await openSavedChannel();
  const command = vi.spyOn(window.openbot.agent, "channelCommand");
  const composer = within(chat).getByRole("textbox", { name: "Message to channel" });
  composer.textContent = "@[Chief](agent:chief) Prepare the report";
  await fireEvent.input(composer);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ type: "coordinate", audience: "lead" })),
  );

  // The composer keeps no recipient of its own; a stale one would address every later request.
  await waitFor(() => expect(composer).toHaveTextContent(""));
  composer.textContent = "Add the rollback step";
  await fireEvent.input(composer);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ type: "coordinate", text: "Add the rollback step", audience: "lead" }),
    ),
  );
});

/** Routing window: a root task no member owns yet. */
async function openChannelWhileRouting(state: "queued" | "paused") {
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
  await window.openbot.agent.channelCommand({
    type: "send",
    operationId: "request",
    channelId: "channel-test",
    text: "Prepare the report",
    recipientAgentId: null,
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
  const originalRead = window.openbot.agent.readChannel;
  vi.spyOn(window.openbot.agent, "readChannel").mockImplementation(async (input) => {
    const page = await originalRead(input);
    return {
      ...page,
      tasks: page.tasks.map((task) => ({
        ...task,
        ownerAgentId: null,
        state,
        error: state === "paused" ? STOPPED_TASK_REASON : null,
      })),
    };
  });
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.click(await screen.findByRole("button", { name: /Project room/ }));
  return screen.findByRole("main", { name: "Channel conversation" });
}

it("keeps the working indicator while the coordinator chooses an owner", async () => {
  const chat = await openChannelWhileRouting("queued");
  // The lead is the coordinator. Its routing turn holds the task and posts nothing until it
  // decides, so the indicator is the only sign that the request is alive.
  expect(await within(chat).findByRole("status", { name: /^Chief is working: / })).toBeInTheDocument();
});

it.each(["@all", "@everyone"])("keeps %s assignments separate when one member is stopped", async (mention) => {
  const chat = await openSavedChannel();
  await window.openbot.agent.channelCommand({
    type: "save",
    operationId: "add-member",
    channelId: "channel-test",
    draft: {
      name: "Project room",
      title: "",
      instructions: "Research the project",
      members: [{ agentId: "chief" }, { agentId: "sales-outbound" }],
      leadAgentId: "chief",
    },
  });
  const composer = within(chat).getByRole("textbox", { name: "Message to channel" });
  composer.textContent = `${mention} Report status`;
  await fireEvent.input(composer);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  const chief = await within(chat).findByRole("region", { name: "Task for Chief" });
  const sales = await within(chat).findByRole("region", { name: "Task for Sales Outbound" });
  expect(within(sales).getByRole("button", { name: "Stop this task" })).toBeEnabled();
  await fireEvent.click(within(chief).getByRole("button", { name: "Stop this task" }));
  await within(chat).findByRole("region", { name: "Stopped task for Chief" });
  expect(within(chat).getByRole("region", { name: "Task for Sales Outbound" })).toBeInTheDocument();
  const page = await window.openbot.agent.readChannel({ channelId: "channel-test" });
  expect(page.tasks).toHaveLength(2);
  expect(page.tasks.find((task) => task.ownerAgentId === "chief")?.state).toBe("paused");
  expect(page.tasks.find((task) => task.ownerAgentId === "sales-outbound")?.state).toBe("queued");
});

it.each([
  { scenario: "before read", timing: "before-read", error: null, continues: true },
  {
    scenario: "IPC completion",
    timing: "during-stop",
    error: new Error("Error invoking remote method: Error: This task is already complete."),
    continues: true,
  },
  {
    scenario: "remote IPC completion",
    timing: "during-stop",
    error: new Error("Error invoking remote method 'agent:channelCommand': Error: Request failed."),
    continues: true,
  },
  {
    scenario: "HTTP completion",
    timing: "during-stop",
    error: Object.assign(new Error("Host request failed"), { status: 500 }),
    continues: true,
  },
  {
    scenario: "permission failure",
    timing: "during-stop",
    error: Object.assign(new Error("Permission denied"), { status: 403 }),
    continues: false,
  },
  { scenario: "connection failure", timing: "during-stop", error: new Error("Connection lost"), continues: false },
])("Stop tracks assigned work and later requests: $scenario", async ({ timing, error, continues }) => {
  const chat = await openSavedChannel();
  await window.openbot.agent.channelCommand({
    type: "coordinate",
    audience: "lead",
    operationId: "coordination-probe",
    channelId: "channel-test",
    text: "Please edit the project",
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
  const initial = await window.openbot.agent.readChannel({ channelId: "channel-test" });
  const coordinator = initial.tasks[0];
  assert(coordinator);
  const reused = {
    ...coordinator,
    id: "reused-worker",
    rootTaskId: "reused-worker",
    ownerAgentId: "sales-outbound",
    state: "queued" as const,
  };
  const page: ChannelPage = {
    ...initial,
    tasks: [{ ...coordinator, execution: "coordinate", state: "running" }, reused],
  };
  const originalCommand = window.openbot.agent.channelCommand;
  const stops: string[] = [];
  const worker = {
    ...coordinator,
    id: "review-worker",
    rootTaskId: "review-worker",
    instruction: "Edit the project",
    state: "queued" as const,
  };
  const later = { ...worker, id: "later-worker", rootTaskId: "later-worker", requestMessageId: "later-request" };
  const complete = () => {
    page.tasks = [
      { ...coordinator, execution: "coordinate", state: "completed" },
      worker,
      later,
      { ...reused, requestMessageId: "replaced-request" },
    ];
    page.channel = { ...page.channel, revision: page.channel.revision + 1 };
  };
  let stopping = false;
  const originalRead = window.openbot.agent.readChannel;
  vi.spyOn(window.openbot.agent, "readChannel").mockImplementation(async (input) => {
    if (input.channelId !== "channel-test") return originalRead(input);
    if (stopping && timing === "before-read" && page.tasks[0]?.state === "running") complete();
    return structuredClone(page);
  });
  vi.spyOn(window.openbot.agent, "channelCommand").mockImplementation(async (input) => {
    if (input.type !== "stop") return originalCommand(input);
    stops.push(input.taskId);
    if (input.taskId === coordinator.id) {
      complete();
      emitAgentEvent?.({ type: "channels-changed", channelId: "channel-test", revision: page.channel.revision });
      throw error;
    }
    page.tasks = page.tasks.map((task) => (task.id === input.taskId ? { ...task, state: "paused" } : task));
    return page.channel;
  });
  emitAgentEvent?.({ type: "channels-changed", channelId: "channel-test", revision: page.channel.revision + 1 });
  await within(chat).findByRole("region", { name: "Task for Sales Outbound" });
  stopping = true;
  await fireEvent.click(within(chat).getByRole("button", { name: "Stop work" }));
  if (!continues) {
    assert(error);
    expect(await within(chat).findByRole("alert")).toHaveTextContent(error.message);
    expect(page.tasks.find((task) => task.id === worker.id)?.state).toBe("queued");
    expect(stops).toEqual([coordinator.id]);
    return;
  }
  await waitFor(() => expect(page.tasks.find((task) => task.id === worker.id)?.state).toBe("paused"));
  expect(page.tasks.find((task) => task.id === reused.id)?.state).toBe("queued");
  expect(stops).not.toContain(reused.id);
  expect(page.tasks.find((task) => task.id === later.id)?.state).toBe("queued");
  expect(stops).not.toContain(later.id);
  expect(within(chat).queryByRole("alert")).not.toBeInTheDocument();
});
