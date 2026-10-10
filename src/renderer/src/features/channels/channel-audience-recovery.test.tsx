import type { AttachmentSummary, ChannelAudienceInput, ChannelAudienceReceipt } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createRoot, createStore, flush } from "solid-js";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { App } from "../../App";
import { AGENTS, installOpenbotStub } from "../../app-test-harness";
import { AccountDock } from "../../lazy-views";
import { pendingChannelAudience, saveChannelAudience } from "./channel-audience-pending";
import { createChannelsController } from "./channels-controller";
import { channelsPort } from "./channels-port";

beforeAll(async () => {
  await AccountDock.preload();
});
beforeEach(installOpenbotStub);

async function openRoom(seed = false) {
  vi.spyOn(window.openbot.agent, "listAgents").mockResolvedValue([
    ...AGENTS,
    { ...AGENTS[1], id: "reviewer", name: "Reviewer", title: "Reviewer", workspacePath: "/tmp/reviewer" },
  ]);
  await window.openbot.agent.channelCommand({
    type: "save",
    operationId: "create-room",
    channelId: "room",
    draft: {
      name: "Review room",
      title: "",
      instructions: "Review",
      members: [{ agentId: "chief" }, { agentId: "sales-outbound" }, { agentId: "reviewer" }],
      leadAgentId: "chief",
    },
  });
  if (seed)
    await window.openbot.agent.channelCommand({
      type: "send",
      channelId: "room",
      operationId: "seed",
      text: "Earlier request",
      recipientAgentId: "chief",
      replyToMessageId: null,
      attachmentDraftIds: [],
    });
  const view = render(() => <App />);
  await screen.findByRole("button", { name: /Open account (actions|menu)/ });
  await fireEvent.click(await screen.findByRole("button", { name: /Review room/ }));
  const chat = await screen.findByRole("main", { name: "Channel conversation" });
  await within(chat).findByRole("heading", { name: "Review room", level: 1 });
  return { view, chat, editor: within(chat).getByRole("textbox", { name: "Message to channel" }) };
}

it("a new attachment with unchanged text survives positive recovery", async () => {
  const { chat, editor } = await openRoom();
  const original = window.openbot.agent.channelAudienceCommand;
  vi.spyOn(window.openbot.agent, "channelAudienceCommand").mockImplementationOnce(async (input) => {
    await original(input);
    throw new Error("Lost response after commit");
  });
  editor.textContent = "@[Chief](agent:chief) @[Reviewer](agent:reviewer) Review";
  await fireEvent.input(editor);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  await within(chat).findByRole("alert");
  const file: AttachmentSummary = {
    id: "new-file",
    name: "new.txt",
    size: 3,
    kind: "file",
    mimeType: "text/plain",
    previewKind: "text",
    previewUrl: null,
  };
  vi.spyOn(window.openbot.agent, "chooseAttachments").mockResolvedValueOnce([file]);
  await fireEvent.click(within(chat).getByRole("button", { name: /Attach/ }));
  await within(chat).findByRole("button", { name: "Remove new.txt" });
  await fireEvent.click(within(chat).getByRole("button", { name: "Check channel acceptance" }));
  await waitFor(() =>
    expect(within(chat).queryByRole("button", { name: "Check channel acceptance" })).not.toBeInTheDocument(),
  );
  expect(within(chat).getByRole("button", { name: "Remove new.txt" })).toBeInTheDocument();
  expect(editor).toHaveTextContent("Review");
});

it("a definite host refusal permits correcting and sending the draft", async () => {
  const { chat, editor } = await openRoom();
  const original = window.openbot.agent.channelAudienceCommand;
  vi.spyOn(window.openbot.agent, "channelAudienceCommand").mockImplementationOnce(async (input) => {
    await window.openbot.agent.channelCommand({
      type: "save",
      operationId: "remove-before-accept",
      channelId: "room",
      update: true,
      draft: {
        name: "Review room",
        title: "",
        instructions: "Review",
        members: [{ agentId: "chief" }, { agentId: "sales-outbound" }],
        leadAgentId: "chief",
      },
    });
    return original(input);
  });
  editor.textContent = "@[Chief](agent:chief) @[Reviewer](agent:reviewer) Review";
  await fireEvent.input(editor);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  await within(chat).findByRole("alert");
  expect((await window.openbot.agent.readChannel({ channelId: "room" })).tasks).toHaveLength(0);
  const single = vi.spyOn(window.openbot.agent, "channelCommand");
  editor.textContent = "@[Chief](agent:chief) Corrected request";
  await fireEvent.input(editor);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  expect(single.mock.calls.filter(([input]) => input.type === "send")).toHaveLength(1);
});

it("late receipt from another channel never clears current pending input", async () => {
  const scope = "review-account/server";
  const draft = {
    name: "A",
    title: "",
    instructions: "",
    members: [{ agentId: "chief" }, { agentId: "sales-outbound" }],
    leadAgentId: "chief",
  };
  for (const channelId of ["a", "b"])
    await window.openbot.agent.channelCommand({
      type: "save",
      operationId: `create-${channelId}`,
      channelId,
      draft: { ...draft, name: channelId },
    });
  const input = (channelId: string): ChannelAudienceInput => ({
    channelId,
    operationId: "same-op",
    text: "Review",
    audience: { kind: "members", agentIds: ["chief", "sales-outbound"] },
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
  saveChannelAudience(scope, input("b"));
  const receiptResponse = deferred<ChannelAudienceReceipt>();
  const delayed = receiptResponse.promise;
  vi.spyOn(window.openbot.agent, "channelAudienceCommand").mockRejectedValueOnce(new Error("Network uncertain"));
  const query = vi
    .spyOn(window.openbot.agent, "channelAudienceReceipt")
    .mockImplementation((request) => (request.channelId === "a" ? delayed : Promise.resolve(null)));
  let dispose = () => {};
  const controller = createRoot((d) => {
    dispose = d;
    return createChannelsController({
      port: channelsPort,
      agents: () => AGENTS.map((agent) => ({ ...agent, time: "" })),
      scopeKey: () => scope,
      readSelection: () => "a",
      writeSelection: () => {},
      supported: () => true,
      audienceSupported: () => true,
      audienceScope: () => scope,
      deletionSupported: () => true,
      beforeOpen: () => {},
      canMarkRead: () => false,
    });
  });
  try {
    await waitFor(() => expect(controller.state.page?.channel.id).toBe("a"));
    await controller.audienceCommand(input("a"));
    const checking = controller.checkAudience();
    await waitFor(() => expect(query).toHaveBeenCalled());
    await controller.open("b");
    await waitFor(() => expect(controller.state.pendingAudience?.channelId).toBe("b"));
    const channel = (await window.openbot.agent.readChannel({ channelId: "a" })).channel;
    receiptResponse.resolve({
      channel,
      requestMessageId: "accepted-a",
      targets: [
        { agentId: "chief", taskId: "root-a" },
        { agentId: "sales-outbound", taskId: "root-b" },
      ],
    });
    expect(await checking).toBe(false);
    expect(controller.state.pendingAudience?.channelId).toBe("b");
  } finally {
    dispose();
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it.each([
  ["immediate", "attachment"],
  ["check", "attachment"],
  ["cold", "attachment"],
  ["immediate", "reply"],
  ["check", "reply"],
  ["cold", "reply"],
] as const)("%s confirmation preserves a newly changed %s with unchanged text", async (mode, change) => {
  const original = window.openbot.agent.channelAudienceCommand;
  const lookup = window.openbot.agent.channelAudienceReceipt;
  const response = deferred<Awaited<ReturnType<typeof original>>>();
  let receipt: Awaited<ReturnType<typeof original>> | undefined;
  vi.spyOn(window.openbot.agent, "channelAudienceCommand").mockImplementationOnce(async (input) => {
    receipt = await original(input);
    if (mode === "immediate") return response.promise;
    throw new Error("Lost response after commit");
  });
  let { view, chat, editor } = await openRoom(true);
  editor.textContent = "@[Chief](agent:chief) @[Reviewer](agent:reviewer) Review";
  await fireEvent.input(editor);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(receipt).toBeDefined());
  if (mode !== "immediate") await within(chat).findByRole("alert");
  if (mode === "cold") {
    view.unmount();
    vi.spyOn(window.openbot.agent, "channelAudienceReceipt").mockImplementation(() => response.promise);
    view = render(() => <App />);
    await screen.findByRole("button", { name: /Open account (actions|menu)/ });
    await fireEvent.click(await screen.findByRole("button", { name: /Review room/ }));
    chat = await screen.findByRole("main", { name: "Channel conversation" });
    editor = await within(chat).findByRole("textbox", { name: "Message to channel" });
    await within(chat).findByRole("button", { name: "Check channel acceptance" });
  }
  if (change === "attachment") {
    const file: AttachmentSummary = {
      id: "fresh",
      name: "fresh.txt",
      size: 1,
      kind: "file",
      mimeType: "text/plain",
      previewKind: "text",
      previewUrl: null,
    };
    vi.spyOn(window.openbot.agent, "chooseAttachments").mockResolvedValueOnce([file]);
    await fireEvent.click(within(chat).getByRole("button", { name: /Attach/ }));
    await within(chat).findByRole("button", { name: "Remove fresh.txt" });
  } else {
    const reply = within(chat).getAllByRole("button", { name: "Reply to You message" })[0];
    if (!reply) throw new Error("Missing reply action");
    await fireEvent.click(reply);
    await within(chat).findByRole("button", { name: "Cancel reply" });
  }
  if (!receipt) throw new Error("Missing host result");
  if (mode === "check") {
    await fireEvent.click(within(chat).getByRole("button", { name: "Check channel acceptance" }));
  } else response.resolve(receipt);
  await waitFor(() =>
    expect(within(chat).queryByRole("button", { name: "Check channel acceptance" })).not.toBeInTheDocument(),
  );
  expect(
    within(chat).getByRole("button", { name: change === "attachment" ? "Remove fresh.txt" : "Cancel reply" }),
  ).toBeInTheDocument();
  expect(editor).toHaveTextContent("Review");
  expect(await lookup({ channelId: "room", operationId: "unknown" })).toBeNull();
});

it.each(["partial", "lost"] as const)(
  "group Stop %s response preserves independent peer status and retries only its own root",
  async (mode) => {
    const { chat, editor } = await openRoom();
    editor.textContent = "@[Chief](agent:chief) @[Reviewer](agent:reviewer) Review";
    await fireEvent.input(editor);
    await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
    await within(chat).findByRole("article", { name: "Message from You" });
    const original = window.openbot.agent.channelCommand;
    let stops = 0;
    const calls = vi.spyOn(window.openbot.agent, "channelCommand").mockImplementation(async (input) => {
      if (input.type !== "stop") return original(input);
      stops += 1;
      if (mode === "partial" && stops === 2) throw new Error("Stop response unavailable");
      const result = await original(input);
      if (mode === "lost" && stops === 1) throw new Error("Stop response unavailable");
      return result;
    });
    await fireEvent.click(within(chat).getByRole("button", { name: "Stop this group" }));
    await within(chat).findByRole("alert");
    const targets = within(chat).getByLabelText("Accepted channel targets");
    expect(targets).toHaveTextContent("Reviewer: Queued");
    expect(targets).not.toHaveTextContent("Reviewer: Paused");
    const attempted = calls.mock.calls.map(([input]) => input).filter((input) => input.type === "stop");
    expect(attempted).toHaveLength(mode === "partial" ? 2 : 1);
    expect(new Set(attempted.map((input) => input.operationId)).size).toBe(attempted.length);
    const page = await window.openbot.agent.readChannel({ channelId: "room" });
    expect(page.tasks.map((task) => task.state)).toEqual(["paused", "queued"]);
    await fireEvent.click(within(chat).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(chat).queryByRole("alert")).not.toBeInTheDocument());
    const retried = calls.mock.calls.map(([input]) => input).filter((input) => input.type === "stop");
    expect(retried.at(-1)).toEqual(attempted.at(-1));
    expect((await window.openbot.agent.readChannel({ channelId: "room" })).tasks.map((task) => task.state)).toEqual(
      mode === "partial" ? ["paused", "paused"] : ["paused", "queued"],
    );
  },
);

const foreignCases = (["account", "server", "channel"] as const).flatMap((switchTo) =>
  (["command", "check"] as const).flatMap((path) =>
    (["positive", "error"] as const).map((outcome) => ({ switchTo, path, outcome })),
  ),
);
it.each(foreignCases)(
  "late $path $outcome across $switchTo preserves current ownership and its independent check",
  async ({ switchTo, path, outcome }) => {
    const draft = {
      name: "A",
      title: "",
      instructions: "",
      members: [{ agentId: "chief" }, { agentId: "sales-outbound" }],
      leadAgentId: "chief",
    };
    for (const channelId of ["a", "b"])
      await window.openbot.agent.channelCommand({
        type: "save",
        channelId,
        operationId: `create-${channelId}`,
        draft: { ...draft, name: channelId },
      });
    const input = (channelId: string): ChannelAudienceInput => ({
      channelId,
      operationId: "same-op",
      text: "Original",
      audience: { kind: "members", agentIds: ["chief", "sales-outbound"] },
      replyToMessageId: null,
      attachmentDraftIds: [],
    });
    const [environment, setEnvironment] = createStore({ account: "first", server: "host-a" });
    const scope = () => JSON.stringify([environment.account, environment.server]);
    const oldScope = scope();
    const newScope = JSON.stringify([
      switchTo === "account" ? "second" : "first",
      switchTo === "server" ? "host-b" : "host-a",
    ]);
    const currentChannel = switchTo === "channel" ? "b" : "a";
    saveChannelAudience(newScope, input(currentChannel));
    // For a channel switch this is B's saved input; other switches use identical channel/op IDs.
    if (switchTo !== "channel") window.localStorage.removeItem("openbot:channel-audience-pending");
    const response = deferred<ChannelAudienceReceipt>();
    const query = vi
      .spyOn(window.openbot.agent, "channelAudienceReceipt")
      .mockImplementation(() => Promise.resolve(null));
    const send = vi.spyOn(window.openbot.agent, "channelAudienceCommand");
    if (path === "command") send.mockImplementationOnce(() => response.promise);
    else send.mockRejectedValueOnce(new Error("Unconfirmed"));
    let dispose = () => {};
    const controller = createRoot((d) => {
      dispose = d;
      return createChannelsController({
        port: channelsPort,
        agents: () => AGENTS.map((agent) => ({ ...agent, time: "" })),
        scopeKey: () => environment.account,
        audienceScope: scope,
        readSelection: () => "a",
        writeSelection: () => {},
        supported: () => true,
        audienceSupported: () => true,
        deletionSupported: () => true,
        beforeOpen: () => {},
        canMarkRead: () => false,
      });
    });
    try {
      await waitFor(() => expect(controller.state.page?.channel.id).toBe("a"));
      let checking: Promise<boolean>;
      if (path === "command") {
        checking = controller.audienceCommand(input("a"));
        await waitFor(() => expect(send).toHaveBeenCalledOnce());
      } else {
        await controller.audienceCommand(input("a"));
        query.mockImplementationOnce(() => response.promise);
        checking = controller.checkAudience();
        await waitFor(() => expect(query).toHaveBeenCalledOnce());
      }
      if (switchTo !== "channel") saveChannelAudience(newScope, input(currentChannel));
      if (switchTo === "channel") await controller.open("b");
      else
        flush(() =>
          setEnvironment((state) => {
            if (switchTo === "account") state.account = "second";
            else state.server = "host-b";
          }),
        );
      await waitFor(() => expect(controller.state.pendingAudience?.channelId).toBe(currentChannel));
      await waitFor(() =>
        expect(query.mock.calls.filter(([request]) => request.channelId === currentChannel).length).toBeGreaterThan(
          path === "check" && currentChannel === "a" ? 1 : 0,
        ),
      );
      const callback = vi.fn();
      if (outcome === "positive")
        response.resolve({
          channel: (await window.openbot.agent.readChannel({ channelId: "a" })).channel,
          requestMessageId: "accepted-a",
          targets: [
            { agentId: "chief", taskId: "root-a" },
            { agentId: "sales-outbound", taskId: "root-b" },
          ],
        });
      else response.reject(new Error("Foreign response"));
      expect(await checking).toBe(false);
      expect(controller.state.pendingAudience).toEqual(input(currentChannel));
      expect(controller.state.acceptedAudience).toBeNull();
      expect(controller.state.pending).toBe(false);
      expect(controller.state.error).not.toBe("Foreign response");
      expect(pendingChannelAudience(newScope, currentChannel)).toEqual(input(currentChannel));
      await controller.checkAudience(callback);
      expect(callback).not.toHaveBeenCalled();
      expect(pendingChannelAudience(oldScope, "a")).toEqual(outcome === "positive" ? null : input("a"));
    } finally {
      dispose();
    }
  },
);

it("an old command finally cannot clear a new channel's in-flight operation or invoke its callback", async () => {
  const draft = {
    name: "Room",
    title: "",
    instructions: "",
    members: [{ agentId: "chief" }, { agentId: "sales-outbound" }],
    leadAgentId: "chief",
  };
  for (const channelId of ["a", "b"])
    await window.openbot.agent.channelCommand({ type: "save", channelId, operationId: `create-${channelId}`, draft });
  const input = (channelId: string): ChannelAudienceInput => ({
    channelId,
    operationId: "same-op",
    text: "Original",
    audience: { kind: "members", agentIds: ["chief", "sales-outbound"] },
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
  const a = deferred<ChannelAudienceReceipt>();
  const b = deferred<ChannelAudienceReceipt>();
  const send = vi
    .spyOn(window.openbot.agent, "channelAudienceCommand")
    .mockImplementation((value) => (value.channelId === "a" ? a.promise : b.promise));
  let dispose = () => {};
  const controller = createRoot((d) => {
    dispose = d;
    return createChannelsController({
      port: channelsPort,
      agents: () => AGENTS.map((agent) => ({ ...agent, time: "" })),
      scopeKey: () => "account",
      audienceScope: () => "account/host",
      readSelection: () => "a",
      writeSelection: () => {},
      supported: () => true,
      audienceSupported: () => true,
      deletionSupported: () => true,
      beforeOpen: () => {},
      canMarkRead: () => false,
    });
  });
  try {
    await waitFor(() => expect(controller.state.page?.channel.id).toBe("a"));
    const oldCallback = vi.fn();
    const first = controller.audienceCommand(input("a"), oldCallback);
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    await controller.open("b");
    const second = controller.audienceCommand(input("b"));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    a.resolve({
      channel: (await window.openbot.agent.readChannel({ channelId: "a" })).channel,
      requestMessageId: "accepted-a",
      targets: [
        { agentId: "chief", taskId: "a-1" },
        { agentId: "sales-outbound", taskId: "a-2" },
      ],
    });
    expect(await first).toBe(false);
    expect(oldCallback).not.toHaveBeenCalled();
    expect(controller.state.pending).toBe(true);
    expect(controller.state.pendingAudience).toEqual(input("b"));
    b.reject(new Error("Current request unconfirmed"));
    expect(await second).toBe(false);
    expect(controller.state.pending).toBe(false);
    expect(controller.state.error).toBe("Current request unconfirmed");
  } finally {
    dispose();
  }
});

it("a late group Stop failure cannot change another channel or send its remaining peer stop", async () => {
  const draft = {
    name: "Room",
    title: "",
    instructions: "",
    members: [{ agentId: "chief" }, { agentId: "sales-outbound" }],
    leadAgentId: "chief",
  };
  for (const channelId of ["a", "b"])
    await window.openbot.agent.channelCommand({ type: "save", channelId, operationId: `create-${channelId}`, draft });
  const result = await window.openbot.agent.channelAudienceCommand({
    channelId: "a",
    operationId: "group",
    text: "Original",
    audience: { kind: "all" },
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
  if ("status" in result) throw new Error("Unexpected refusal");
  const response = deferred<Awaited<ReturnType<typeof window.openbot.agent.channelCommand>>>();
  const stop = vi.spyOn(window.openbot.agent, "channelCommand").mockImplementationOnce(() => response.promise);
  let dispose = () => {};
  const controller = createRoot((d) => {
    dispose = d;
    return createChannelsController({
      port: channelsPort,
      agents: () => AGENTS.map((agent) => ({ ...agent, time: "" })),
      scopeKey: () => "account",
      audienceScope: () => "account/host",
      readSelection: () => "a",
      writeSelection: () => {},
      supported: () => true,
      audienceSupported: () => true,
      deletionSupported: () => true,
      beforeOpen: () => {},
      canMarkRead: () => false,
    });
  });
  try {
    await waitFor(() => expect(controller.state.page?.channel.id).toBe("a"));
    const pending = controller.stopAudience("a", result.targets);
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
    await controller.open("b");
    response.reject(new Error("Foreign Stop response unavailable"));
    expect(await pending).toBe(false);
    expect(stop).toHaveBeenCalledOnce();
    expect(controller.state.pending).toBe(false);
    expect(controller.state.error).toBeNull();
    expect(controller.state.page?.channel.id).toBe("b");
  } finally {
    dispose();
  }
});

it("full owned confirmation clears and discards its files; a changed reply retains the original file reference", async () => {
  const { chat, editor } = await openRoom(true);
  const file: AttachmentSummary = {
    id: "submitted-file",
    name: "submitted.txt",
    size: 1,
    kind: "file",
    mimeType: "text/plain",
    previewKind: "text",
    previewUrl: null,
  };
  vi.spyOn(window.openbot.agent, "chooseAttachments").mockResolvedValue([file]);
  const discard = vi.spyOn(window.openbot.agent, "discardDraftAttachment");
  const original = window.openbot.agent.channelAudienceCommand;
  const response = deferred<Awaited<ReturnType<typeof original>>>();
  let receipt: Awaited<ReturnType<typeof original>> | undefined;
  vi.spyOn(window.openbot.agent, "channelAudienceCommand").mockImplementationOnce(async (input) => {
    receipt = await original(input);
    return response.promise;
  });
  await fireEvent.click(within(chat).getByRole("button", { name: /Attach/ }));
  await within(chat).findByRole("button", { name: "Remove submitted.txt" });
  editor.textContent = "@[Chief](agent:chief) @[Reviewer](agent:reviewer) Review";
  await fireEvent.input(editor);
  await fireEvent.click(within(chat).getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(receipt).toBeDefined());
  const reply = within(chat).getAllByRole("button", { name: "Reply to You message" })[0];
  if (!reply || !receipt) throw new Error("Missing accepted request");
  await fireEvent.click(reply);
  response.resolve(receipt);
  await waitFor(() =>
    expect(within(chat).queryByRole("button", { name: "Check channel acceptance" })).not.toBeInTheDocument(),
  );
  expect(within(chat).getByRole("button", { name: "Remove submitted.txt" })).toBeInTheDocument();
  expect(discard).not.toHaveBeenCalled();
  const sendButton = within(chat).getByRole("button", { name: "Send message" });
  await waitFor(() => expect(sendButton).toBeEnabled());
  await fireEvent.click(sendButton);
  await waitFor(() => expect(discard).toHaveBeenCalledWith("submitted-file"));
  expect(editor.textContent).toBe("");
  expect(within(chat).queryByRole("button", { name: "Remove submitted.txt" })).not.toBeInTheDocument();
});

it("restores the saved channel when capability arrives and retains audience ownership through reconnect", async () => {
  await window.openbot.agent.channelCommand({
    type: "save",
    operationId: "create-late-capability",
    channelId: "late-room",
    draft: {
      name: "Late room",
      title: "",
      instructions: "",
      members: [{ agentId: "chief" }, { agentId: "sales-outbound" }],
      leadAgentId: "chief",
    },
  });
  const scope = "late-account/late-host";
  const input: ChannelAudienceInput = {
    channelId: "late-room",
    operationId: "saved-audience",
    text: "Preserved request",
    audience: { kind: "members", agentIds: ["chief", "sales-outbound"] },
    replyToMessageId: null,
    attachmentDraftIds: [],
  };
  saveChannelAudience(scope, input);
  const query = vi.spyOn(window.openbot.agent, "channelAudienceReceipt").mockResolvedValue(null);
  const send = vi.spyOn(window.openbot.agent, "channelAudienceCommand");
  const [connection, setConnection] = createStore({ supported: false });
  let dispose = () => {};
  const controller = createRoot((cleanup) => {
    dispose = cleanup;
    return createChannelsController({
      port: channelsPort,
      agents: () => AGENTS.map((agent) => ({ ...agent, time: "" })),
      scopeKey: () => scope,
      audienceScope: () => scope,
      readSelection: () => "late-room",
      writeSelection: () => {},
      supported: () => connection.supported,
      audienceSupported: () => connection.supported,
      deletionSupported: () => connection.supported,
      beforeOpen: () => {},
      canMarkRead: () => false,
    });
  });
  try {
    expect(controller.state.selectedId).toBeNull();
    flush(() =>
      setConnection((state) => {
        state.supported = true;
      }),
    );
    await waitFor(() => expect(controller.state.page?.channel.id).toBe("late-room"));
    await waitFor(() => expect(query).toHaveBeenCalledOnce());
    expect(controller.state.pendingAudience).toEqual(input);
    flush(() =>
      setConnection((state) => {
        state.supported = false;
      }),
    );
    expect(controller.state.selectedId).toBe("late-room");
    expect(controller.state.pendingAudience).toEqual(input);
    flush(() =>
      setConnection((state) => {
        state.supported = true;
      }),
    );
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(controller.state.pendingAudience).toEqual(input);
    expect(send).not.toHaveBeenCalled();
    expect(pendingChannelAudience(scope, "late-room")).toEqual(input);
  } finally {
    dispose();
  }
});
