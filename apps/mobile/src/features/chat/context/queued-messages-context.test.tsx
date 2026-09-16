import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import type { ChatQueueController } from "../components/use-chat-queue";
import { QueuedMessagesProvider, usePublishedQueuedChat, useQueuedChat } from "./queued-messages-context";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function controller(chatId: string): ChatQueueController {
  const [serverId, agentId] = chatId.split(":");
  return {
    chatId,
    agentId,
    serverId,
    attachments: [],
    changeAttachments: async () => {},
    queued: [],
    deliveries: [],
    edit: null,
    editUnavailable: false,
    confirmed: false,
    busy: false,
    progress: null,
    error: null,
    loading: false,
    canEdit: true,
    online: true,
    activeTurnId: null,
    begin: async () => {},
    save: async () => true,
    refresh: () => {},
    changeText: () => {},
    removeAttachment: () => {},
    cancelUpload: () => {},
    cancelEdit: async () => true,
    discardFinishedEdit: async () => true,
    remove: async () => true,
    steer: async () => true,
    moveFirst: async () => true,
  };
}

function Publisher({ chatId, queue }: { chatId: string; queue: ChatQueueController | null }) {
  usePublishedQueuedChat(chatId, queue, null);
  return null;
}

function Reader({ chatId, read }: { chatId: string; read: (queue: ChatQueueController | null) => void }) {
  read(useQueuedChat(chatId).queue);
  return null;
}

it("keeps each chat queue under its own identity while other chats stay mounted", () => {
  const first = controller("host:first");
  const second = controller("host:second");
  const seen: (ChatQueueController | null)[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (chats: { chatId: string; queue: ChatQueueController }[]) =>
    act(() =>
      root.render(
        <QueuedMessagesProvider>
          {chats.map((chat) => (
            <Publisher key={chat.chatId} chatId={chat.chatId} queue={chat.queue} />
          ))}
          <Reader chatId="host:first" read={(queue) => seen.push(queue)} />
        </QueuedMessagesProvider>,
      ),
    );
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });

  render([{ chatId: "host:first", queue: first }]);
  expect(seen.at(-1)).toBe(first);
  // A second chat the native stack keeps mounted publishes beside the first, not over it.
  render([
    { chatId: "host:first", queue: first },
    { chatId: "host:second", queue: second },
  ]);
  expect(seen.at(-1)).toBe(first);
  // Leaving that chat removes its own entry and leaves the open sheet with its queue.
  render([{ chatId: "host:first", queue: first }]);
  expect(seen.at(-1)).toBe(first);
});
