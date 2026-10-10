import {
  CHANNEL_AUDIENCE_CAPABILITY,
  CHANNEL_CHATS_CAPABILITY,
  type ChannelAudienceResult,
  type ChannelSummary,
  parseChannelAudienceInput,
} from "@openbot/contracts/ipc";
import { CHANNEL_AUDIENCE_ROUTES } from "@openbot/contracts/team-protocol/channels-audience-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { assert, expect, it, vi } from "vitest";
import { NativeChannelAudience } from "./channel-audience-send";
import { ChannelSend } from "./channel-send";
import { type ChannelRequest, MobileChannelStore } from "./channel-store";

const channel: ChannelSummary = {
  id: "channel-one",
  name: "Travel",
  title: "Planning",
  instructions: "Compare options",
  members: [{ agentId: "agent-one" }, { agentId: "agent-two" }],
  leadAgentId: "agent-one",
  archived: false,
  revision: 1,
  createdAt: "2026-09-14T00:00:00Z",
  unreadCount: 0,
  activeTasks: 0,
  lastMessage: null,
};
const accepted: ChannelAudienceResult = {
  channel,
  requestMessageId: "request-one",
  targets: [
    { agentId: "agent-one", taskId: "task-one" },
    { agentId: "agent-two", taskId: "task-two" },
  ],
};
const body = "@[One](agent:agent-one) @[Two](agent:agent-two) Review";
const file = { id: "file-one", name: "note.txt", mimeType: "text/plain", size: 1, base64: "eA==" };
function fixture(handler?: (path: string, body: TeamProtocolV2Json | undefined) => Promise<unknown>) {
  const saved = new Map<string, string>();
  const storage = {
    get: (key: string) => saved.get(key) ?? null,
    set: vi.fn((key: string, value: string) => {
      saved.set(key, value);
    }),
  };
  const bytes = new Map<string, string>();
  const files = {
    write: vi.fn(async (_op: string, input: typeof file) => {
      bytes.set(input.id, input.base64);
      return { ...input, base64: undefined, fileName: `${input.id}.txt` };
    }),
    read: vi.fn(async (_op: string, input: { id: string }) => {
      const value = bytes.get(input.id);
      assert(value);
      return value;
    }),
    remove: vi.fn(async (_op: string, input: { id: string }) => {
      bytes.delete(input.id);
    }),
  };
  const calls = vi.fn(async (path: string, input: TeamProtocolV2Json | undefined, _serverId: string) => {
    if (handler) return handler(path, input);
    if (path.includes("attachments"))
      return {
        id: "upload-one",
        name: file.name,
        mimeType: file.mimeType,
        size: 1,
        kind: "file",
        previewKind: "none",
        previewUrl: null,
      };
    if (path === CHANNEL_AUDIENCE_ROUTES.command || path === CHANNEL_AUDIENCE_ROUTES.receipt) return accepted;
    if (path === CHANNEL_ROUTES.list) return [channel];
    if (path === CHANNEL_ROUTES.command) return channel;
    return { channel, messages: [], tasks: [], olderCursor: null, throughSequence: 0 };
  });
  const request: ChannelRequest = async (_method, path, decode, input, serverId) =>
    decode(await calls(path, input, serverId));
  const store = new MobileChannelStore(request);
  store.configure("host-one", [CHANNEL_CHATS_CAPABILITY, CHANNEL_AUDIENCE_CAPABILITY]);
  store.configure("host-two", [CHANNEL_CHATS_CAPABILITY, CHANNEL_AUDIENCE_CAPABILITY]);
  let sequence = 0;
  const open = (scope = "account-one:host-one", channelId = channel.id, serverId = "host-one") =>
    new NativeChannelAudience(store, scope, serverId, channelId, () => `op-${++sequence}`, storage, files);
  return { open, store, calls, saved, storage, files, bytes };
}

it.each([body, "@all Review"])("compatible native audience sends one durable plural command: %s", async (text) => {
  const f = fixture();
  const audience = f.open();
  const sender = new ChannelSend(f.store, "host-one", channel.id, () => "singular", audience);
  await sender.send(text, [], "reply-one", channel.members);
  const commands = f.calls.mock.calls.filter(([path]) => path === CHANNEL_AUDIENCE_ROUTES.command);
  expect(commands).toHaveLength(1);
  expect(commands[0]?.[1]).toMatchObject({
    text,
    replyToMessageId: "reply-one",
    audience: text.startsWith("@all") ? { kind: "all" } : { kind: "members", agentIds: ["agent-one", "agent-two"] },
  });
  expect(audience.get().pending?.result).toEqual(accepted);
  expect(f.open().get().pending?.result).toEqual(accepted);
});

it("persists before any request and rejects storage failure without sending", async () => {
  const f = fixture();
  f.storage.set.mockImplementationOnce(() => {
    throw new Error("Disk full");
  });
  await expect(f.open().send(body, [file], null)).rejects.toThrow("Disk full");
  expect(f.calls).not.toHaveBeenCalled();
  expect(f.files.write).not.toHaveBeenCalled();
});

it("keeps exact uploaded IDs and original body/reply across lost response and cold manual retry", async () => {
  const f = fixture();
  f.calls.mockImplementationOnce(async () => ({
    id: "upload-one",
    name: file.name,
    mimeType: file.mimeType,
    size: 1,
    kind: "file",
    previewKind: "none",
    previewUrl: null,
  }));
  f.calls.mockImplementationOnce(async () => {
    throw new Error("Response lost");
  });
  const first = f.open();
  await expect(first.send(body, [file], "reply-one")).rejects.toThrow("Response lost");
  const input = first.get().pending?.input;
  expect(input?.attachmentDraftIds).toEqual(["upload-one"]);
  first.dispose();
  const cold = f.open();
  f.calls.mockImplementationOnce(async () => null);
  await cold.check();
  expect(cold.get().pending?.input).toEqual(input);
  expect(f.calls.mock.calls.filter(([path]) => path === CHANNEL_AUDIENCE_ROUTES.command)).toHaveLength(1);
  await cold.retry();
  expect(
    f.calls.mock.calls.filter(([path]) => path === CHANNEL_AUDIENCE_ROUTES.command).map(([, request]) => request),
  ).toEqual([input, input]);
  expect(f.calls.mock.calls.filter(([path]) => path.includes("attachments"))).toHaveLength(1);
  expect(cold.get().pending?.result).toEqual(accepted);
});

it("does not resend uncertain uploads and never submits incomplete preparation", async () => {
  const f = fixture();
  f.calls.mockImplementationOnce(async () => {
    throw new Error("Upload lost");
  });
  const first = f.open();
  await expect(first.send(body, [file], null)).rejects.toThrow("Upload lost");
  first.dispose();
  const cold = f.open();
  expect(cold.get().pending?.uploadingId).toBe(file.id);
  await expect(cold.retry()).rejects.toThrow("unconfirmed audience");
  expect(f.calls).toHaveBeenCalledTimes(1);
  await cold.close();
  expect(f.open().get().pending).toBeNull();
  const incomplete = f.open();
  f.files.write.mockRejectedValueOnce(new Error("Copy failed"));
  await expect(incomplete.send(body, [file], null)).rejects.toThrow("Copy failed");
  await expect(f.open().retry()).rejects.toThrow("unconfirmed audience");
  expect(f.calls).toHaveBeenCalledTimes(1);
});

it("retains completed uploads during cancellation and resumes once in FIFO file order", async () => {
  const f = fixture();
  const audience = f.open();
  let cancelled = false;
  await expect(
    audience.send(body, [file, { ...file, id: "file-two" }], null, {
      cancelled: () => cancelled,
      progress: (count) => {
        if (count === 1) cancelled = true;
      },
    }),
  ).rejects.toThrow("cancelled");
  expect(audience.get().pending?.submitted).toBe(false);
  expect(f.calls.mock.calls.filter(([path]) => path === CHANNEL_AUDIENCE_ROUTES.command)).toHaveLength(0);
  f.calls.mockImplementationOnce(async () => ({
    id: "upload-two",
    name: file.name,
    mimeType: file.mimeType,
    size: 1,
    kind: "file",
    previewKind: "none",
    previewUrl: null,
  }));
  await f.open().retry();
  expect(f.calls.mock.calls.find(([path]) => path === CHANNEL_AUDIENCE_ROUTES.command)?.[1]).toMatchObject({
    attachmentDraftIds: ["upload-one", "upload-two"],
  });
});

it("keeps refused uploads for draft correction and never changes accepted target identities", async () => {
  const f = fixture();
  f.calls.mockImplementationOnce(async (_path, input) => {
    const command = parseChannelAudienceInput(input);
    return { status: "not-accepted", reason: "validation", channelId: channel.id, operationId: command.operationId };
  });
  const audience = f.open();
  await audience.send(body, [], null);
  expect(audience.get().pending?.result).toMatchObject({ status: "not-accepted" });
  await audience.send("@all Corrected", [], null);
  expect(audience.get().pending?.input.operationId).toBe("op-2");
  f.store.configure("host-one", [CHANNEL_CHATS_CAPABILITY, CHANNEL_AUDIENCE_CAPABILITY]);
  expect(f.open().get().pending?.result).toEqual(accepted);
});

it.each(["account-two:host-one", "account-one:host-two"])(
  "isolates late response from another scope: %s",
  async (scope) => {
    const f = fixture();
    const delayed = Promise.withResolvers<unknown>();
    f.calls.mockImplementationOnce(() => delayed.promise);
    const first = f.open();
    const sending = first.send(body, [], null);
    await vi.waitFor(() => expect(f.calls).toHaveBeenCalledTimes(1));
    first.dispose();
    const host = scope.endsWith("host-two") ? "host-two" : "host-one";
    const second = f.open(scope, channel.id, host);
    await second.send("@all Another request", [], null);
    expect(f.calls.mock.calls.filter(([path]) => path === CHANNEL_AUDIENCE_ROUTES.command).at(-1)?.[2]).toBe(host);
    delayed.resolve(accepted);
    await sending;
    expect(second.get().pending?.input.text).toBe("@all Another request");
    expect(f.open(scope, channel.id, host).get().pending?.input.text).toBe("@all Another request");
    expect(first.get().pending?.result).toBeNull();
    expect(f.open().get().pending?.result).toEqual(accepted);
  },
);

it("uses separate durable root Stop IDs and resumes a partial/lost group Stop without repeating peers", async () => {
  const f = fixture();
  const audience = f.open();
  await audience.send(body, [], null);
  const result = audience.get().pending?.result;
  assert(result && !("status" in result));
  let stopCalls = 0;
  f.calls.mockImplementation(async (path) => {
    if (path === CHANNEL_ROUTES.command && ++stopCalls === 2) throw new Error("Stop response lost");
    return path === CHANNEL_ROUTES.list ? [channel] : channel;
  });
  await expect(audience.stop(accepted.targets)).rejects.toThrow("Stop response lost");
  const stops = audience.get().pending?.stops;
  expect(stops).toEqual([
    { taskId: "task-one", operationId: "op-2", done: true },
    { taskId: "task-two", operationId: "op-3", done: false },
  ]);
  const cold = f.open();
  await expect(cold.close()).rejects.toThrow("unconfirmed audience");
  await cold.stop(accepted.targets);
  expect(f.calls.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.command).map(([, input]) => input)).toEqual([
    { type: "stop", channelId: channel.id, taskId: "task-one", operationId: "op-2", recipientAgentId: null },
    { type: "stop", channelId: channel.id, taskId: "task-two", operationId: "op-3", recipientAgentId: null },
    { type: "stop", channelId: channel.id, taskId: "task-two", operationId: "op-3", recipientAgentId: null },
  ]);
});

it("stops only the selected accepted root and keeps its owner", async () => {
  const f = fixture();
  const audience = f.open();
  await audience.send(body, [], null);
  const target = accepted.targets[1];
  assert(target);
  await audience.stop([target]);
  await f.open().stop([target]);
  await expect(audience.stop([{ ...target, agentId: "foreign-agent" }])).rejects.toThrow();
  expect(f.calls.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.command).map(([, input]) => input)).toEqual([
    { type: "stop", channelId: channel.id, taskId: target.taskId, operationId: "op-2", recipientAgentId: null },
  ]);
  expect(audience.get().pending?.input.text).toBe(body);
  expect(audience.get().pending?.result).toEqual(accepted);
});

it("rejects bounded corrupt state and foreign receipt without clearing the saved input", async () => {
  const f = fixture();
  f.saved.set("channel-audience-pending-v1", JSON.stringify([{ scope: "other", input: {} }]));
  const corrupt = f.open();
  expect(corrupt.get().error).toBeTruthy();
  await expect(corrupt.send(body, [], null)).rejects.toThrow();
  expect(f.calls).not.toHaveBeenCalled();
  f.saved.clear();
  f.calls.mockImplementationOnce(async () => ({ ...accepted, channel: { ...channel, id: "foreign-channel" } }));
  const foreign = f.open();
  await expect(foreign.send(body, [], null)).rejects.toThrow();
  expect(f.open().get().pending?.input.text).toBe(body);
  expect(f.open().get().pending?.result).toBeNull();
});

it("keeps all unresolved records when storage is full and sends nothing from the rejected scope", async () => {
  const f = fixture();
  f.calls.mockImplementation(async () => {
    throw new Error("Lost");
  });
  for (let index = 0; index < 20; index++)
    await expect(f.open(`scope-${index}`).send(body, [], null)).rejects.toThrow("Lost");
  const before = [...f.saved.values()];
  await expect(f.open("scope-full").send(body, [], null)).rejects.toThrow("no room");
  expect([...f.saved.values()]).toEqual(before);
  expect(f.calls).toHaveBeenCalledTimes(20);
});

it("does not let a stale same-scope owner overwrite a settled result or durable root Stop", async () => {
  const f = fixture();
  const delayed = Promise.withResolvers<unknown>();
  f.calls.mockImplementationOnce(() => delayed.promise);
  const first = f.open();
  const sent = first.send(body, [], null);
  await vi.waitFor(() => expect(f.calls).toHaveBeenCalledTimes(1));
  const reopened = f.open();
  await reopened.check();
  const target = accepted.targets[0];
  assert(target);
  await reopened.stop([target]);
  const settled = reopened.get().pending;
  delayed.resolve(accepted);
  await expect(sent).rejects.toThrow("unconfirmed audience");
  expect(f.open().get().pending).toEqual(settled);
});

it("leaving during upload retains exact evidence and never submits a channel command", async () => {
  const f = fixture();
  const delayed = Promise.withResolvers<unknown>();
  f.calls.mockImplementationOnce(() => delayed.promise);
  const first = f.open();
  const sending = first.send(body, [file], null);
  await vi.waitFor(() => expect(f.calls).toHaveBeenCalledTimes(1));
  first.dispose();
  delayed.resolve({
    id: "upload-one",
    name: file.name,
    mimeType: file.mimeType,
    size: 1,
    kind: "file",
    previewKind: "none",
    previewUrl: null,
  });
  await expect(sending).rejects.toThrow("cancelled");
  expect(f.calls).toHaveBeenCalledTimes(1);
  expect(f.open().get().pending).toMatchObject({
    submitted: false,
    uploadingId: null,
    input: { attachmentDraftIds: ["upload-one"] },
  });
});

it("the native store reads audience metadata only on a capable host", async () => {
  const f = fixture();
  const release = f.store.observe("host-one", channel.id);
  await f.store.refresh("host-one");
  expect(f.calls.mock.calls.some(([path]) => path === CHANNEL_AUDIENCE_ROUTES.read)).toBe(true);
  f.store.configure("host-one", [CHANNEL_CHATS_CAPABILITY]);
  await f.store.refresh("host-one");
  expect(f.calls.mock.calls.some(([path]) => path === CHANNEL_ROUTES.read)).toBe(true);
  await expect(f.open().send(body, [], null)).rejects.toThrow("does not support");
  expect(f.saved.size).toBe(0);
  release();
});

it("keeps independent same-account channel ownership through a delayed response", async () => {
  const f = fixture();
  const delayed = Promise.withResolvers<unknown>();
  f.calls.mockImplementationOnce(() => delayed.promise);
  const first = f.open();
  const sending = first.send(body, [], null);
  await vi.waitFor(() => expect(f.calls).toHaveBeenCalledTimes(1));
  first.dispose();
  f.calls.mockImplementation(async (path, input) => {
    if (path === CHANNEL_AUDIENCE_ROUTES.command) {
      const command = parseChannelAudienceInput(input);
      return { ...accepted, channel: { ...channel, id: command.channelId } };
    }
    return [channel];
  });
  const second = f.open("account-one:host-one", "channel-two");
  await second.send("@all Another channel", [], "another-reply");
  delayed.resolve(accepted);
  await sending;
  expect(f.open("account-one:host-one", "channel-two").get().pending?.input).toMatchObject({
    text: "@all Another channel",
    replyToMessageId: "another-reply",
  });
  expect(f.open().get().pending?.input.text).toBe(body);
});

it("native Cancel preparation does not infer termination of an in-flight upload", async () => {
  const f = fixture();
  const delayed = Promise.withResolvers<unknown>();
  f.calls.mockImplementationOnce(() => delayed.promise);
  const owner = f.open();
  const sending = owner.send(body, [file], null);
  await vi.waitFor(() => expect(f.calls).toHaveBeenCalledTimes(1));
  owner.cancelPreparation();
  expect(owner.get().cancelRequested).toBe(true);
  expect(owner.get().pending?.uploadingId).toBe(file.id);
  delayed.resolve({
    id: "upload-one",
    name: file.name,
    mimeType: file.mimeType,
    size: 1,
    kind: "file",
    previewKind: "none",
    previewUrl: null,
  });
  await expect(sending).rejects.toThrow("cancelled");
  expect(owner.get().pending).toMatchObject({ submitted: false, uploadingId: null });
  expect(f.calls.mock.calls.filter(([path]) => path === CHANNEL_AUDIENCE_ROUTES.command)).toHaveLength(0);
});

it("a received host result with local write failure is reassociated locally without another request", async () => {
  const f = fixture();
  let writes = 0;
  f.storage.set.mockImplementation((key, value) => {
    if (++writes === 3) throw new Error("Local receipt write failed");
    f.saved.set(key, value);
  });
  const owner = f.open();
  await expect(owner.send(body, [], null)).rejects.toThrow("Local receipt write failed");
  expect(owner.get().localConfirmationPending).toBe(true);
  expect(f.open().get().pending?.result).toBeNull();
  const before = f.calls.mock.calls.filter(
    ([path]) => path === CHANNEL_AUDIENCE_ROUTES.command || path === CHANNEL_AUDIENCE_ROUTES.receipt,
  ).length;
  await owner.retry();
  expect(owner.get().localConfirmationPending).toBe(false);
  expect(f.open().get().pending?.result).toEqual(accepted);
  expect(
    f.calls.mock.calls.filter(
      ([path]) => path === CHANNEL_AUDIENCE_ROUTES.command || path === CHANNEL_AUDIENCE_ROUTES.receipt,
    ),
  ).toHaveLength(before);
});
