import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
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
  ]) {
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

it("keeps the text a queued settings save carries when the reader opens another channel", async () => {
  for (const [channelId, name] of [
    ["channel-test", "Project room"],
    ["channel-other", "Release room"],
  ]) {
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

  const original = window.openbot.agent.channelCommand;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = vi.spyOn(window.openbot.agent, "channelCommand").mockImplementation(async (input) => {
    if (input.type === "save") await gate;
    return original(input);
  });
  // The removal holds the gate, so the title the reader writes next waits behind it.
  void fireEvent.click(within(chat).getByRole("button", { name: "Remove Chief" }));
  const title = within(chat).getByRole("textbox", { name: "Channel title" });
  await fireEvent.input(title, { target: { value: "Weekly sync" } });
  void fireEvent.blur(title);
  await fireEvent.click(screen.getByRole("button", { name: /Release room/ }));
  release();

  // The queued save carries the membership the save before it left, and its own title: the text
  // was written in this channel, not read from the one the reader went to.
  await waitFor(() => expect(save.mock.calls.filter(([input]) => input.type === "save")).toHaveLength(2));
  const saves = save.mock.calls.map(([input]) => input).filter((input) => input.type === "save");
  expect(saves.map((input) => input.channelId)).toEqual(["channel-test", "channel-test"]);
  expect(saves.at(-1)).toMatchObject({
    draft: { name: "Project room", title: "Weekly sync", members: [{ agentId: "sales-outbound" }] },
  });
});

/**
 * A channel with one task that the service stopped and wrote a reason on. The stub does not run
 * the automatic assignment limit, so the stopped task arrives through the read.
 */
const STOPPED_TASK_REASON = "The automatic assignment limit was reached. Continue or reassign this task.";
it("shows a channel read that lands while more changes are still arriving", async () => {
  const chat = await openSavedChannel();
  // Every streamed chunk of a member publishes a change, and each read of a channel is two calls.
  // Hold every read open, so the events overtake them the way streaming does.
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

  // The read that is already running answers for the changes behind it, so the reader sees the
  // message. Starting a read for each event and keeping only the newest showed nothing until the
  // writing stopped.
  gates[0]?.();
  await within(chat).findByRole("article", { name: "Message from You" });
  expect(within(chat).getByRole("article", { name: "Message from You" })).toHaveTextContent("Prepare the report");
  for (const release of gates) release();
});

async function openChannelWithStoppedTask(options: { withChild?: boolean; state?: "paused" | "failed" } = {}) {
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
  const state = { taskId: "" };
  vi.spyOn(window.openbot.agent, "readChannel").mockImplementation(async (input) => {
    const page = await originalRead(input);
    state.taskId = page.tasks[0]?.id ?? "";
    const stopped = page.tasks.map((task) => ({
      ...task,
      state: options.state ?? ("paused" as const),
      error: STOPPED_TASK_REASON,
    }));
    // The assignment limit stops the root task and everything under it, so the child arrives
    // stopped with the same reason on it.
    const child = stopped[0] ? [{ ...stopped[0], id: `${stopped[0].id}-child`, parentTaskId: stopped[0].id }] : [];
    return { ...page, tasks: options.withChild ? [...stopped, ...child] : stopped };
  });
  const command = vi.spyOn(window.openbot.agent, "channelCommand");
  render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.click(await screen.findByRole("button", { name: /Project room/ }));
  const chat = await screen.findByRole("main", { name: "Channel conversation" });
  const notice = await within(chat).findByRole("region", { name: "Stopped task for Chief" });
  return { notice, command, state };
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

it("continues a task that failed, which nothing but the reader starts again", async () => {
  // A provider that cannot start, and a turn that ends in an error, both leave a failed task. Its
  // parent waits for it, so the request never finishes until the reader continues it.
  const { notice, command, state } = await openChannelWithStoppedTask({ state: "failed" });
  expect(notice).toHaveTextContent(STOPPED_TASK_REASON);
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

/**
 * The routing window as the renderer sees it: a root task that no member owns yet. The lead runs
 * that turn, and `state` chooses whether routing is still open or ended without an owner.
 */
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

it("drops the working indicator when routing ends without an owner", async () => {
  const chat = await openChannelWhileRouting("paused");
  await within(chat).findByRole("article", { name: "Message from You" });
  expect(within(chat).queryByRole("status", { name: / is working: / })).not.toBeInTheDocument();
});
