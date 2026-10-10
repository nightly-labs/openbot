import {
  CHANNEL_AUDIENCE_CAPABILITY,
  CHANNEL_CHATS_CAPABILITY,
  type ChannelAudienceReceipt,
  type ChannelAudienceResult,
  type ChannelPage,
  type ChannelSummary,
  type ChannelTask,
} from "@openbot/contracts/ipc";
import { CHANNEL_AUDIENCE_ROUTES } from "@openbot/contracts/team-protocol/channels-audience-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type PropsWithChildren, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, assert, expect, it, vi } from "vitest";
import { NativeChannelAudience } from "../model/channel-audience-send";
import { type ChannelRequest, MobileChannelStore } from "../model/channel-store";
import { ChannelAudienceStatus } from "./channel-audience-status";
import { useChannelAudienceDraft } from "./use-channel-audience-draft";

// Native primitives have no device in this React harness. The product panel, model and receipt hook are real.
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ScrollView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("heroui-native", () => {
  const Text = ({ children, accessibilityRole }: PropsWithChildren<{ accessibilityRole?: string }>) => (
    <span role={accessibilityRole}>{children}</span>
  );
  const Button = Object.assign(
    ({ children, isDisabled, onPress }: PropsWithChildren<{ isDisabled?: boolean; onPress: () => void }>) => (
      <button type="button" disabled={isDisabled} onClick={onPress}>
        {children}
      </button>
    ),
    { Label: Text },
  );
  return { Button, Typography: { Paragraph: Text } };
});
const channel: ChannelSummary = {
  id: "channel-one",
  name: "Work",
  title: "",
  instructions: "",
  members: [{ agentId: "one" }, { agentId: "two" }],
  leadAgentId: "one",
  archived: false,
  revision: 1,
  createdAt: "2026-09-14T00:00:00Z",
  unreadCount: 0,
  activeTasks: 0,
  lastMessage: null,
};
const receipt: ChannelAudienceReceipt = {
  channel,
  requestMessageId: "request",
  targets: [
    { agentId: "one", taskId: "task-one" },
    { agentId: "two", taskId: "task-two" },
  ],
};
const attachment = { id: "file-one", name: "note.txt", mimeType: "text/plain", size: 1, base64: "eA==" };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllMocks();
});
type FixtureResponse =
  | Awaited<ReturnType<MobileChannelStore["audienceReceipt"]>>
  | Awaited<ReturnType<MobileChannelStore["command"]>>
  | Awaited<ReturnType<MobileChannelStore["upload"]>>
  | ChannelSummary[]
  | ChannelPage;

function mount(plain = false) {
  const saved = new Map<string, string>();
  const calls = vi.fn(async (path: string): Promise<FixtureResponse> => {
    if (path === CHANNEL_AUDIENCE_ROUTES.command) throw new Error("Response lost");
    if (path === CHANNEL_AUDIENCE_ROUTES.receipt) return receipt;
    if (path.includes("attachments"))
      return {
        id: "upload-one",
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: 1,
        kind: "file",
        previewKind: "none",
        previewUrl: null,
      };
    if (path === CHANNEL_ROUTES.list) return [channel];
    if (path === CHANNEL_ROUTES.command) return channel;
    return { channel, messages: [], tasks: [], olderCursor: null, throughSequence: 0 };
  });
  const request: ChannelRequest = async (_method, path, decode) => decode(await calls(path));
  const store = new MobileChannelStore(request);
  store.configure("host", [CHANNEL_CHATS_CAPABILITY, CHANNEL_AUDIENCE_CAPABILITY]);
  let op = 0;
  const open = (scope = "account:host") =>
    new NativeChannelAudience(
      store,
      scope,
      "host",
      channel.id,
      () => `op-${++op}`,
      {
        get: (key) => saved.get(key) ?? null,
        set: (key, value) => {
          saved.set(key, value);
        },
      },
      {
        write: async (_op, file) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          fileName: "file.txt",
        }),
        read: async () => "eA==",
        remove: async () => {},
      },
    );
  let audience = open();
  const tasks: ChannelTask[] = [];
  const actions = { clears: vi.fn(), tasks };
  function Consumer({ owner }: { owner: NativeChannelAudience }) {
    const state = useSyncExternalStore(owner.subscribe, owner.get);
    const [text, setText] = useState("@all Review");
    const [files, setFiles] = useState(plain ? [] : [attachment]);
    const [reply, setReply] = useState<string | null>(plain ? null : "reply-one");
    useChannelAudienceDraft(
      state.pending,
      { text, files, replyToMessageId: reply },
      () => {
        actions.clears();
        setText("");
        setFiles([]);
        setReply(null);
      },
      state.draftOwnerOperationId,
    );
    return (
      <>
        <input aria-label="Draft" value={text} onChange={(event) => setText(event.target.value)} />
        <button type="button" onClick={() => setFiles([...files, { ...attachment, id: "new-file" }])}>
          Add file
        </button>
        <button type="button" onClick={() => setReply("new-reply")}>
          Change reply
        </button>
        <button type="button" onClick={() => void owner.send(text, files, reply).catch(() => undefined)}>
          Send
        </button>
        <ChannelAudienceStatus
          controls={{
            state,
            check: owner.check,
            retry: owner.retry,
            close: owner.close,
            cancelPreparation: owner.cancelPreparation,
            stop: owner.stop,
          }}
          members={[
            { id: "one", name: "One" },
            { id: "two", name: "Two" },
          ]}
          tasks={actions.tasks}
          online
        />
      </>
    );
  }
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  act(() => root.render(<Consumer owner={audience} />));
  cleanups.push(() => {
    act(() => root.unmount());
    audience.dispose();
    node.remove();
  });
  return {
    calls,
    actions,
    open,
    audience,
    render: (owner: NativeChannelAudience) => {
      audience.dispose();
      audience = owner;
      act(() => root.render(<Consumer key={String(op)} owner={owner} />));
    },
  };
}

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

function edit(text: string) {
  act(() => {
    fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), { target: { value: text } });
  });
}

it("later Stop preserves a fresh identical draft after the original confirmation", async () => {
  const f = mount(true);
  await click("Send");
  await click("Check saved request");
  expect(f.actions.clears).toHaveBeenCalledTimes(1);
  edit("@all Review");
  await click("Stop One");
  expect(f.calls.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.command)).toHaveLength(1);
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe("@all Review");
  expect(f.actions.clears).toHaveBeenCalledTimes(1);
});

it("a first mismatched confirmation cannot later own matching draft content", async () => {
  const f = mount(true);
  await click("Send");
  edit("@all New review");
  await click("Check saved request");
  expect(f.actions.clears).not.toHaveBeenCalled();
  edit("@all Review");
  await click("Stop One");
  expect(f.calls.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.command)).toHaveLength(1);
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe("@all Review");
  expect(f.actions.clears).not.toHaveBeenCalled();
});

it("a new explicit operation owns one new confirmation cleanup", async () => {
  const f = mount(true);
  await click("Send");
  await click("Check saved request");
  const firstOperation = f.audience.get().pending?.input.operationId;
  expect(f.actions.clears).toHaveBeenCalledTimes(1);
  edit("@all Review");
  await click("Send");
  expect(f.audience.get().pending?.input.operationId).not.toBe(firstOperation);
  await click("Check saved request");
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe("");
  expect(f.actions.clears).toHaveBeenCalledTimes(2);
  edit("@all Review");
  await click("Stop One");
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe("@all Review");
  expect(f.actions.clears).toHaveBeenCalledTimes(2);
  expect(f.calls.mock.calls.filter(([path]) => path === CHANNEL_AUDIENCE_ROUTES.command)).toHaveLength(2);
});

it.each(["unchanged", "file", "reply"])("actual receipt consumer protects full current draft: %s", async (change) => {
  const f = mount();
  await click("Send");
  await screen.findByRole("button", { name: "Check saved request" });
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Check saved request" }).disabled).toBe(false),
  );
  if (change === "file") await click("Add file");
  if (change === "reply") await click("Change reply");
  await click("Check saved request");
  await screen.findByText("One · Task status unavailable");
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe(
    change === "unchanged" ? "" : "@all Review",
  );
  expect(f.actions.clears).toHaveBeenCalledTimes(change === "unchanged" ? 1 : 0);
  expect(f.calls.mock.calls.filter(([path]) => path === CHANNEL_AUDIENCE_ROUTES.command)).toHaveLength(1);
});

it("hydrates the exact saved unknown request on reopen and distinguishes receipt miss from refusal", async () => {
  const f = mount();
  await click("Send");
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Check saved request" }).disabled).toBe(false),
  );
  const cold = f.open();
  f.render(cold);
  f.calls.mockImplementationOnce(async () => null);
  await click("Check saved request");
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Check saved request" }).disabled).toBe(false),
  );
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe("@all Review");
  const operationId = cold.get().pending?.input.operationId;
  assert(operationId);
  const refused: ChannelAudienceResult = {
    status: "not-accepted",
    channelId: channel.id,
    operationId,
    reason: "validation",
  };
  f.calls.mockResolvedValueOnce(refused);
  await click("Check saved request");
  await screen.findByText("The host did not accept this request. Correct the draft and send again.");
  expect(screen.queryByRole("button", { name: "Retry same request" })).toBeNull();
  expect(f.actions.clears).not.toHaveBeenCalled();
});

it("old foreign positive cannot clear a new consumer draft or block its own check", async () => {
  const f = mount();
  await click("Send");
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Check saved request" }).disabled).toBe(false),
  );
  const delayed = Promise.withResolvers<ChannelAudienceReceipt>();
  f.calls.mockImplementationOnce(() => delayed.promise);
  await click("Check saved request");
  const foreign = f.open("another-account:host");
  f.render(foreign);
  await click("Send");
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Check saved request" }).disabled).toBe(false),
  );
  await act(async () => {
    delayed.resolve(receipt);
  });
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe("@all Review");
  expect(f.actions.clears).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Check saved request" }).disabled).toBe(false);
});

it("a cold positive never owns a new composer with reused native file IDs", async () => {
  const f = mount();
  await click("Send");
  const cold = f.open();
  f.render(cold);
  await click("Check saved request");
  await screen.findByText("One · Task status unavailable");
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe("@all Review");
  expect(f.actions.clears).not.toHaveBeenCalled();
});

it("actual group Stop exposes a partial result and permits only manual recovery", async () => {
  const f = mount();
  await click("Send");
  await click("Check saved request");
  let stops = 0;
  f.calls.mockImplementation(async (path) => {
    if (path === CHANNEL_ROUTES.command && ++stops === 2) throw new Error("Stop response lost");
    return path === CHANNEL_ROUTES.list ? [channel] : channel;
  });
  await click("Stop these tasks");
  await screen.findByText("Two · Stop is not confirmed");
  expect(screen.queryByRole("button", { name: "Close confirmed request" })).toBeNull();
  expect(f.calls.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.command)).toHaveLength(2);
  await click("Retry Stop for Two");
  await screen.findByRole("button", { name: "Close confirmed request" });
  expect(f.calls.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.command)).toHaveLength(3);
});
