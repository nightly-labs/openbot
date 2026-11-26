import type { WatchCommand, WatchErrorCode, WatchResult, WatchSnapshot } from "@openbot/contracts/watch-protocol";
import type { RemoteWorkspacePreferences } from "@openbot/team-client";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useCSSVariable } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useChatOrderPreference } from "@/features/settings/model/chat-order";
import { shareAvatarFile, shareAvatarName } from "@/features/share/model/share-extension";
import { useWatchAwake } from "@/features/watch/model/watch-awake";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/workspace-store";
import { InactiveRequestError } from "@/features/workspace/model/pending-approvals";
import type { ServerCapabilities } from "@/features/workspace/model/server-capabilities";
import { showsOnline } from "@/features/workspace/model/server-status";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import { accountScope } from "@/shared/lib/account-scope";
import { useText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import {
  createWatchSession,
  loadWatchServers,
  supportsWatchRelay,
  watchDirectCredentials,
} from "./model/watch-pairing";
import { buildWatchSnapshot, questionsToLoad } from "./model/watch-snapshot";
import {
  knownWatchKey,
  rememberWatchKeys,
  rememberWatchSession,
  sendWatchSnapshot,
  setWatchCommandHandler,
  useWatchInstalled,
  watchSnapshotText,
  watchSupported,
} from "./watch-native";

interface WatchSyncProps {
  servers: readonly MobileServer[];
  serversReady: boolean;
  agents: readonly MobileAgent[];
  preferences: Readonly<Record<string, RemoteWorkspacePreferences>>;
  capabilities: ServerCapabilities;
  teamApi: (serverId: string) => TeamApiRequest;
}

const CONNECT_WAIT_MS = 8_000;
const CONNECT_POLL_MS = 250;
const SEND_DELAY_MS = 400;

const AVATAR_REPLY_LIMIT = 48_000;
const WATCH_KEY_RETRY_MS = 5 * 60_000;

function watchAvatar(agent: MobileAgent): string | undefined {
  const name = shareAvatarName(agent);
  return shareAvatarFile(name) ? name : undefined;
}

async function watchAvatarData(names: readonly string[]): Promise<Record<string, string>> {
  const avatars: Record<string, string> = {};
  let size = 0;
  for (const name of names) {
    const file = shareAvatarFile(name);
    if (!file) continue;
    const data = await file.base64();
    if (size + data.length > AVATAR_REPLY_LIMIT) break;
    avatars[name] = data;
    size += data.length;
  }
  return avatars;
}

export function WatchSync(props: WatchSyncProps): ReactNode {
  return watchSupported ? <WatchLinkSync {...props} /> : null;
}

function WatchLinkSync({ servers, serversReady, agents, preferences, capabilities, teamApi }: WatchSyncProps): null {
  const text = useText();
  const { t, errorMessage } = text;
  const accent = String(useCSSVariable("--openbot-accent"));
  const { session } = useMobileSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const watchInstalled = useWatchInstalled();
  const readWorkspace = useMobileWorkspaceReader();
  const actions = useMobileWorkspaceActions();
  const liveState = actions.liveState;
  const sidebarByServer = useMobileWorkspaceSelector((current) => current.sidebarByServer);
  const chatOrder = useChatOrderPreference((state) => state.order);
  const foreground = useAppForeground();
  const watchAwake = useWatchAwake();
  const paused = !foreground && !watchAwake;

  const build = useCallback(
    (): WatchSnapshot =>
      buildWatchSnapshot({
        servers,
        agents,
        hidden: (serverId) => preferences[serverId]?.hidden ?? [],
        pinned: (serverId) => preferences[serverId]?.pinned ?? [],
        layout: (serverId) => sidebarByServer[serverId]?.layout ?? null,
        recent: chatOrder === "recent",
        unreadFirst: chatOrder === "unread-first" || chatOrder === "unread-group",
        paused,
        live: liveState.get(),
        conversation: (agentId) => actions.conversationStore.get(agentId),
        avatar: watchAvatar,
        online: showsOnline,
        watchKey: knownWatchKey,
        account: session ? accountScope(session.apiUrl, session.user.id) : undefined,
        text,
        accent,
      }),
    [servers, agents, preferences, sidebarByServer, chatOrder, paused, liveState, actions, text, accent, session],
  );
  const buildRef = useRef(build);
  buildRef.current = build;

  const requested = useRef(new Set<string>());
  const keyRequests = useRef(new Map<string, number>());

  useEffect(() => {
    if (!watchInstalled || !serversReady) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const loadWatchKeys = () => {
      const now = Date.now();
      const missing = servers
        .filter(
          (server) =>
            showsOnline(server) &&
            supportsWatchRelay(capabilities.get(server.id)) &&
            !knownWatchKey(server.id) &&
            now - (keyRequests.current.get(server.id) ?? 0) >= WATCH_KEY_RETRY_MS,
        )
        .map((server) => server.id);
      if (missing.length === 0) return;
      for (const serverId of missing) keyRequests.current.set(serverId, now);
      void loadWatchServers(missing, teamApi).then((loaded) => {
        if (loaded.length === 0) return;
        rememberWatchKeys(loaded);
        schedule();
      });
    };
    const loadQuestions = () => {
      const conversation = (agentId: string) => actions.conversationStore.get(agentId);
      for (const { serverId, agentId } of questionsToLoad({ servers, live: liveState.get(), conversation })) {
        const key = `${serverId}/${agentId}`;
        if (requested.current.has(key)) continue;
        requested.current.add(key);
        void actions
          .loadConversation(agentId, serverId)
          .catch(() => undefined)
          .finally(() => requested.current.delete(key));
      }
    };
    const schedule = () => {
      if (timer || stopped) return;
      timer = setTimeout(() => {
        timer = null;
        loadQuestions();
        loadWatchKeys();
        sendWatchSnapshot(buildRef.current());
      }, SEND_DELAY_MS);
    };
    schedule();
    const unsubscribe = liveState.subscribe(schedule);
    return () => {
      stopped = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [watchInstalled, serversReady, liveState, servers, actions, capabilities, teamApi]);

  const run = useCallback(
    async (command: WatchCommand): Promise<WatchResult> => {
      const failure = (error: WatchErrorCode, message: string): WatchResult => ({ ok: false, error, message });
      const serverOnline = (serverId: string) =>
        showsOnline(readWorkspace().servers.find((server) => server.id === serverId));
      const connected = async (ready: () => boolean) => {
        const until = Date.now() + CONNECT_WAIT_MS;
        while (!ready() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, CONNECT_POLL_MS));
        return ready();
      };
      const done = (): WatchResult => {
        const snapshot = buildRef.current();
        sendWatchSnapshot(snapshot);
        return { ok: true, snapshot: watchSnapshotText(snapshot) };
      };

      if (command.type === "avatars") return { ok: true, avatars: await watchAvatarData(command.names) };
      if (command.type === "pair") {
        const credential = sessionRef.current;
        if (!credential) return failure("failed", t("mobile.watch.error.failed"));
        try {
          const grant = await createWatchSession(credential, command.publicKey);
          rememberWatchSession(credential, grant.watchSessionId);
          const relayServers = readWorkspace()
            .servers.filter((server) => showsOnline(server) && supportsWatchRelay(capabilities.get(server.id)))
            .map((server) => server.id);
          const direct = await loadWatchServers(relayServers, teamApi);
          rememberWatchKeys(direct);
          const snapshot = buildRef.current();
          sendWatchSnapshot(snapshot);
          return {
            ok: true,
            direct: watchDirectCredentials(
              accountScope(credential.apiUrl, credential.user.id),
              credential.apiUrl,
              grant,
              direct,
            ),
            snapshot: watchSnapshotText(snapshot),
          };
        } catch {
          return failure("failed", t("mobile.watch.error.failed"));
        }
      }
      if (command.type === "refresh") {
        await connected(() => readWorkspace().servers.some(showsOnline));
        return done();
      }
      const { serverId, agentId } = command;
      const agent = readWorkspace().agents.find((item) => item.id === agentId && item.serverId === serverId);
      if (!agent) return failure("inactive", t("mobile.watch.error.inactive"));

      if (command.type === "read") {
        actions.markAgentRead(agentId, undefined, serverId);
        return done();
      }

      if (command.type === "open") {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: t("mobile.watch.notification.title", { name: agent.name }),
            body: t("mobile.watch.notification.body"),
            data: { agentId, serverId },
          },
          trigger: null,
        });
        return { ok: true };
      }

      if (!(await connected(() => serverOnline(serverId)))) return failure("offline", t("mobile.watch.error.offline"));
      try {
        switch (command.type) {
          case "approve":
          case "deny": {
            const approval = liveState
              .get()
              .approvalRequests[serverId]?.find((item) => String(item.requestId) === command.requestId);
            if (!approval) return failure("inactive", t("mobile.watch.error.inactive"));
            if (command.type === "approve") {
              const current = buildRef.current();
              const shown =
                current.state === "ready"
                  ? current.agents.find((item) => item.serverId === serverId && item.id === agentId)?.wait
                  : null;
              if (shown?.kind !== "approval" || shown.requestId !== command.requestId || !shown.whole) {
                return failure("failed", t("mobile.watch.approval.tooLong"));
              }
            }
            await actions.respondToApproval(serverId, {
              requestId: approval.requestId,
              decision: command.type === "approve" ? "accept" : "decline",
            });
            return done();
          }
          case "answer": {
            const prompt = actions.conversationStore
              .get(agentId)
              ?.messages.find(
                (message) => String(message.questionPrompt?.requestId) === command.requestId,
              )?.questionPrompt;
            if (!prompt || prompt.resolution) return failure("inactive", t("mobile.watch.error.inactive"));
            const answerable = new Set(
              prompt.questions.filter((question) => !question.isSecret).map((question) => question.id),
            );
            if (!Object.keys(command.answers).every((questionId) => answerable.has(questionId))) {
              return failure("failed", t("mobile.watch.error.failed"));
            }
            await actions.respondToPrompt(agentId, { requestId: prompt.requestId, answers: command.answers });
            return done();
          }
          case "send": {
            const clientMessageId = readWorkspace().canRetryMessage(serverId)
              ? (command.messageId ?? Crypto.randomUUID())
              : undefined;
            await actions.sendMessage(agentId, command.text, [], null, serverId, clientMessageId);
            return done();
          }
          case "stop":
            await actions.interruptTurn(agentId, command.turnId, serverId);
            return done();
        }
      } catch (error) {
        if (error instanceof InactiveRequestError) return failure("inactive", t("mobile.watch.error.inactive"));
        return failure("failed", errorMessage(error, t("mobile.watch.error.failed")));
      }
    },
    [t, errorMessage, readWorkspace, liveState, actions, capabilities, teamApi],
  );
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => setWatchCommandHandler((command) => runRef.current(command)), []);

  return null;
}
