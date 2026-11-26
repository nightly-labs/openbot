import { classifyFailure } from "@openbot/telemetry";
import * as Crypto from "expo-crypto";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { reportMobileNotification } from "@/features/analytics/failure-reports";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { ChannelHistoryRefreshError } from "@/features/channels/model/channel-store";
import { donateShareTarget } from "@/features/share/model/share-extension";
import { supportLog } from "@/features/support/model/support-log";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { withUploadCancel } from "@/features/workspace/model/upload-cancels";
import type { MobileWorkspaceContextValue } from "@/features/workspace/model/workspace-types";
import { currentText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import type { OutboxMessage } from "../model/outbox";
import { createOutboxFiles } from "../model/outbox-files";
import {
  type OutboxDelivery,
  type OutboxDeliveryResult,
  type OutboxSnapshot,
  OutboxStore,
} from "../model/outbox-store";
import { uploadChatAttachments } from "../model/upload-chat-attachments";

const OutboxContext = createContext<OutboxStore | null>(null);
const NO_SERVERS: ReadonlySet<string> = new Set();

interface AccountOutbox {
  store: OutboxStore;
  workspace: { current: (() => MobileWorkspaceContextValue) | null };
}

const accountOutboxes = new Map<string, AccountOutbox>();

function createAccountOutbox(scope: string | null): AccountOutbox {
  const workspace: AccountOutbox["workspace"] = { current: null };
  const store = new OutboxStore({
    storage: scope ? createOutboxFiles(scope) : null,
    deliver: async (message, delivery) => {
      if (!workspace.current) throw new Error(currentText().t("mobile.workspace.error.transportNotReady"));
      return deliverOutboxMessage(workspace.current(), message, delivery);
    },
    describeError: (error) => {
      const { t, errorMessage } = currentText();
      return errorMessage(error, t("mobile.chat.outbox.failed"));
    },
    reportFailure: (error, message) => {
      const code = classifyFailure(error);
      const errorName = error instanceof Error ? error.name : typeof error;
      const bytes = message.files.reduce((total, file) => total + file.size, 0);
      supportLog.add(
        "warn",
        "app",
        `Chat message not sent: ${code}, ${errorName}, ${message.files.length} files, ${bytes} bytes`,
      );
      reportMobileNotification({ code }, "turn", "banner");
    },
    randomId: Crypto.randomUUID,
  });
  return { store, workspace };
}

function accountOutbox(scope: string | null): AccountOutbox {
  if (!scope) return createAccountOutbox(null);
  let outbox = accountOutboxes.get(scope);
  if (!outbox) {
    outbox = createAccountOutbox(scope);
    accountOutboxes.set(scope, outbox);
  }
  return outbox;
}

export function OutboxProvider({ children }: PropsWithChildren) {
  const readWorkspace = useMobileWorkspaceReader();
  const { session } = useMobileSession();
  const [{ store, workspace: current }] = useState(() =>
    accountOutbox(session ? `${session.apiUrl}:${session.user.id}` : null),
  );
  current.current = readWorkspace;
  const onlineKey = useMobileWorkspaceSelector((workspace) =>
    workspace.servers
      .filter((server) => server.state === "online")
      .map((server) => server.id)
      .sort()
      .join("\n"),
  );
  const foreground = useAppForeground();
  const online = useMemo(
    () => (foreground && onlineKey ? new Set(onlineKey.split("\n")) : NO_SERVERS),
    [foreground, onlineKey],
  );
  useEffect(() => {
    void store.load();
  }, [store]);
  useEffect(() => {
    store.setOnline(online);
  }, [store, online]);
  useEffect(() => () => store.setOnline(NO_SERVERS), [store]);
  return <OutboxContext value={store}>{children}</OutboxContext>;
}

export function useOutbox(): { store: OutboxStore; snapshot: OutboxSnapshot } {
  const store = useContext(OutboxContext);
  if (!store) throw new Error("OutboxProvider is missing.");
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot);
  return { store, snapshot };
}

async function deliverOutboxMessage(
  workspace: MobileWorkspaceContextValue,
  message: OutboxMessage,
  delivery: OutboxDelivery,
): Promise<OutboxDeliveryResult> {
  const { target } = message;
  const control = { cancelled: delivery.cancelled, progress: delivery.progress, fileProgress: delivery.fileProgress };
  if (target.kind === "agent") {
    const repeatSafe = workspace.canRetryMessage(target.serverId);
    const messageId = await uploadChatAttachments(delivery.files, {
      ...control,
      upload: (file, onProgress) =>
        withUploadCancel(file, delivery.cancelled, () =>
          workspace.uploadAttachment(target.agentId, file, target.serverId, onProgress),
        ),
      discard: (id) => workspace.discardAttachment(target.agentId, id, target.serverId),
      send: async (ids) => {
        await delivery.beforeStore(repeatSafe);
        return workspace.sendMessage(
          target.agentId,
          message.text,
          ids,
          message.replyToMessageId,
          target.serverId,
          repeatSafe ? message.clientMessageId : undefined,
        );
      },
    });
    const agent = workspace.agents.find((item) => item.serverId === target.serverId && item.id === target.agentId);
    if (agent) donateShareTarget(agent.serverId, agent.id, agent.name);
    return { messageId };
  }
  const { channelStore } = workspace;
  await uploadChatAttachments(delivery.files, {
    ...control,
    upload: (file, onProgress) => channelStore.upload(target.serverId, file, onProgress),
    discard: (id) => channelStore.discard(target.serverId, id),
    send: async (ids) => {
      await delivery.beforeStore(true);
      try {
        await channelStore.command(
          target.serverId,
          {
            type: "send",
            operationId: message.clientMessageId,
            channelId: target.channelId,
            text: message.text,
            recipientAgentId: target.recipientAgentId,
            replyToMessageId: message.replyToMessageId,
            attachmentDraftIds: ids,
          },
          { waitForRefresh: true },
        );
      } catch (error) {
        if (!(error instanceof ChannelHistoryRefreshError)) throw error;
      }
      return "";
    },
  });
  return { messageId: null };
}
