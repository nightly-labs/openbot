import { type ConversationMessage, isAgentAnswer } from "@openbot/contracts/ipc";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentSteers } from "@/features/agents/model/use-agent-steers";
import { useAppLock } from "@/features/app-lock/model/app-lock";
import { appLockEnabled } from "@/features/app-lock/model/app-lock-storage";
import { useChatQueue } from "@/features/chat/components/use-chat-queue";
import { useAgentConversation } from "@/features/chat/components/use-conversation-message";
import { useLiveConversation } from "@/features/chat/components/use-live-conversation";
import { useOutbox } from "@/features/chat/context/outbox-context";
import type { LiveConversationPhase } from "@/features/chat/model/live-conversation";
import { outboxChatKey, outboxTargetKey } from "@/features/chat/model/outbox";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { readReply } from "@/features/voice/model/reply-voice";
import { useAgentFirstUnreadMessageId, useUnreadAgentIds } from "@/features/workspace/components/use-live-workspace";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { currentText, useText } from "@/shared/lib/text";
import {
  type CarPlayVoiceFrames,
  type CarPlayVoiceState,
  carPlay,
  carPlaySupported,
  onCarPlayMute,
  onCarPlayOpen,
  onCarPlayVoiceEnd,
  useCarPlayConnected,
} from "./carplay-native";
import { buildCarPlayHome, carPlayAgentKey, signedOutCarPlayHome } from "./model/carplay-home";
import { carPlayPicturePaths, saveCarPlayPictures } from "./model/carplay-pictures";
import { carPlayVoiceFrames, carPlayVoicePlaceholder, prepareCarPlayVoiceFrames } from "./model/carplay-voice-pictures";

const NO_PICTURES: ReadonlyMap<string, string> = new Map();
const UNAVAILABLE_CLOSE_MS = 4000;

const PHASE_STATE = {
  starting: "listening",
  listening: "listening",
  sending: "thinking",
  thinking: "thinking",
  speaking: "speaking",
  offline: "offline",
} as const satisfies Record<LiveConversationPhase, CarPlayVoiceState>;

type SessionStage = "loading" | "briefing" | "live";

interface Briefing {
  text: string;
  lastId: string;
}

export function CarPlaySync(): ReactNode {
  return carPlaySupported ? <CarPlayBridge /> : null;
}

function CarPlayBridge(): ReactNode {
  const { t } = useText();
  const connected = useCarPlayConnected();
  const agents = useMobileWorkspaceSelector((current) => current.activeAgents);
  const pinnedAgentIds = useMobileWorkspaceSelector((current) => current.pinnedAgentIds);
  const unreadAgentIds = useUnreadAgentIds();
  const locked = useAppLock((state) => state.status !== "ready" || (appLockEnabled(state.config) && state.locked));
  const pictures = useMemo(() => (connected ? carPlayPicturePaths(agents) : NO_PICTURES), [connected, agents]);
  const home = useMemo(
    () => buildCarPlayHome({ agents, pinnedAgentIds, unreadAgentIds, pictures, locked, t }),
    [agents, pinnedAgentIds, unreadAgentIds, pictures, locked, t],
  );
  const agentsByKey = useMemo(() => new Map(agents.map((agent) => [carPlayAgentKey(agent), agent])), [agents]);
  const [voiceKey, setVoiceKey] = useState<string | null>(null);
  const close = useCallback(() => setVoiceKey(null), []);

  useEffect(() => {
    if (connected) saveCarPlayPictures(agents);
  }, [connected, agents]);

  useEffect(() => {
    if (!connected || locked) return;
    const pinned = new Set(pinnedAgentIds);
    let wanted = true;
    void prepareCarPlayVoiceFrames(
      agents.filter((agent) => pinned.has(agent.id)),
      () => wanted,
    );
    return () => {
      wanted = false;
    };
  }, [connected, locked, agents, pinnedAgentIds]);

  useEffect(() => {
    carPlay.setHome(home);
  }, [home]);

  useEffect(() => () => carPlay.setHome(signedOutCarPlayHome(currentText().t)), []);

  useEffect(() => onCarPlayOpen(setVoiceKey), []);

  useEffect(() => {
    if (!connected || locked) setVoiceKey(null);
  }, [connected, locked]);

  const voiceAgent = voiceKey && connected && !locked ? (agentsByKey.get(voiceKey) ?? null) : null;
  return voiceAgent ? <CarPlayVoiceSession key={voiceKey} agent={voiceAgent} onClose={close} /> : null;
}

function briefingFrom(messages: readonly ConversationMessage[], firstUnreadId: string | null): Briefing | null {
  if (!firstUnreadId) return null;
  const start = messages.findIndex((message) => message.id === firstUnreadId);
  const unread = messages.slice(Math.max(start, 0));
  const answers = unread.filter((message) => isAgentAnswer(message) && message.status === "completed");
  const spoken = start >= 0 ? answers : answers.slice(-1);
  const last = spoken.at(-1);
  if (!last) return null;
  return { text: spoken.map((message) => message.text).join("\n\n"), lastId: last.id };
}

function CarPlayVoiceSession({ agent, onClose }: { agent: MobileAgent; onClose: () => void }): null {
  const { t } = useText();
  const workspace = useMobileWorkspaceReader();
  const online = useMobileWorkspaceSelector(
    (current) => current.servers.find((server) => server.id === agent.serverId)?.state === "online",
  );
  const stored = useAgentConversation(agent.id);
  const conversation = useMemo(
    () => (stored ? { messages: stored.messages, activeTurnId: stored.activeTurnId } : null),
    [stored],
  );
  const firstUnreadId = useAgentFirstUnreadMessageId(agent.id);
  const [briefFrom] = useState(firstUnreadId);
  const [stage, setStage] = useState<SessionStage>("loading");
  const [presented, setPresented] = useState(false);
  const [frames, setFrames] = useState<CarPlayVoiceFrames | null>(null);
  const { steers } = useAgentSteers(agent);
  const queue = useChatQueue(agent.id, agent.serverId, online, stored?.activeTurnId ?? null, steers, stored?.messages);
  const { store: outbox, snapshot: outboxSnapshot } = useOutbox();
  const chatKey = outboxChatKey({ kind: "agent", serverId: agent.serverId, id: agent.id });
  const outboxMessages = useMemo(
    () => outboxSnapshot.messages.filter((message) => outboxTargetKey(message.target) === chatKey),
    [outboxSnapshot.messages, chatKey],
  );
  const live = useLiveConversation({
    enabled: true,
    online,
    focused: true,
    foreground: true,
    conversation,
    provider: agent.provider,
    channel: null,
    deliveries: queue.deliveries,
    outboxMessages,
    send: (text) =>
      outbox.add(
        { kind: "agent", serverId: agent.serverId, agentId: agent.id },
        { text, replyToMessageId: null, files: [] },
      ),
  });
  const started = useRef(false);
  const wasOpen = useRef(false);
  const latest = useRef({ stored, briefFrom });
  const unavailableLogged = useRef(false);
  useEffect(() => {
    latest.current = { stored, briefFrom };
  });

  useEffect(() => {
    const current = workspace();
    if (current.conversationStore.isUpToDate(agent.id)) return;
    const leaveLoading = () => setStage((now) => (now === "loading" ? "live" : now));
    current
      .loadConversation(agent.id, agent.serverId)
      .then(() => {
        if (!workspace().conversationStore.get(agent.id)) leaveLoading();
      })
      .catch((error: unknown) => {
        supportLog.add("warn", "app", `CarPlay conversation not loaded: ${supportLogValue(error)}`);
        leaveLoading();
      });
  }, [workspace, agent.id, agent.serverId]);

  const { serverId, id, avatarUrl, avatarSeed, avatarHue, avatarColor } = agent;
  useEffect(() => {
    let current = true;
    void carPlayVoiceFrames({ serverId, id, avatarUrl, avatarSeed, avatarHue, avatarColor }).then((next) => {
      if (current) setFrames(next);
    });
    return () => {
      current = false;
    };
  }, [serverId, id, avatarUrl, avatarSeed, avatarHue, avatarColor]);

  useEffect(() => {
    if (stage !== "loading" || !stored) return;
    setStage(briefingFrom(stored.messages, briefFrom) ? "briefing" : "live");
  }, [stage, stored, briefFrom]);

  useEffect(() => {
    if (stage !== "briefing" || !presented) return;
    const { stored: messages, briefFrom: from } = latest.current;
    const briefing = messages ? briefingFrom(messages.messages, from) : null;
    if (!briefing) {
      setStage("live");
      return;
    }
    const reading = readReply(briefing.text, {
      onPart: () => {},
      onDone: () => {
        workspace().markAgentRead(agent.id, briefing.lastId, agent.serverId);
        setStage("live");
      },
      onError: () => setStage("live"),
    });
    return () => reading.stop();
  }, [stage, presented, workspace, agent.id, agent.serverId]);

  useEffect(() => {
    if (stage !== "live" || !presented || started.current) return;
    if (!live.available) {
      if (!unavailableLogged.current) supportLog.add("warn", "app", "CarPlay voice is not available");
      unavailableLogged.current = true;
      return;
    }
    started.current = true;
    live.start();
  }, [stage, presented, live.available, live.start]);

  useEffect(() => {
    if (live.open) {
      wasOpen.current = true;
      return;
    }
    if (wasOpen.current) onClose();
  }, [live.open, onClose]);

  useEffect(() => onCarPlayMute(live.toggleMute), [live.toggleMute]);

  useEffect(() => {
    carPlay.setVoiceMuted(live.muted);
  }, [live.muted]);

  useEffect(
    () =>
      onCarPlayVoiceEnd(() => {
        live.end();
        onClose();
      }),
    [live.end, onClose],
  );

  const unavailable = stage === "live" && !live.available && !live.open;
  useEffect(() => {
    if (!unavailable) return;
    const timer = setTimeout(onClose, UNAVAILABLE_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [unavailable, onClose]);

  useEffect(
    () => () => {
      if (started.current) workspace().markAgentRead(agent.id, undefined, agent.serverId);
    },
    [workspace, agent.id, agent.serverId],
  );

  const voiceState: CarPlayVoiceState =
    stage === "loading"
      ? "thinking"
      : stage === "briefing"
        ? "speaking"
        : !online
          ? "offline"
          : unavailable
            ? "unavailable"
            : live.muted && PHASE_STATE[live.phase] === "listening"
              ? "muted"
              : PHASE_STATE[live.phase];
  const firstState = useRef(voiceState);
  const latestFrames = useRef(frames);
  const sentFrames = useRef<CarPlayVoiceFrames | null>(null);
  useEffect(() => {
    firstState.current = voiceState;
    latestFrames.current = frames;
  });
  const placeholder = useMemo(
    () => carPlayVoicePlaceholder({ serverId, id, avatarUrl, avatarSeed, avatarHue, avatarColor }),
    [serverId, id, avatarUrl, avatarSeed, avatarHue, avatarColor],
  );
  const ready = stage !== "loading" || !online;
  useEffect(() => {
    if (ready) setPresented(true);
  }, [ready]);

  useEffect(() => {
    if (!presented) return;
    sentFrames.current = latestFrames.current;
    carPlay.showVoice(
      {
        listening: t("mobile.carplay.voice.listening"),
        muted: t("mobile.carplay.voice.muted"),
        thinking: t("mobile.carplay.voice.thinking", { name: agent.name }),
        speaking: agent.name,
        offline: t("mobile.carplay.voice.offline"),
        unavailable: t("mobile.carplay.voice.unavailable"),
      },
      firstState.current,
      latestFrames.current ?? placeholder,
    );
    return () => carPlay.hideVoice();
  }, [presented, placeholder, agent.name, t]);

  useEffect(() => {
    if (!presented || !frames || sentFrames.current === frames) return;
    sentFrames.current = frames;
    carPlay.setVoiceFrames(frames);
  }, [presented, frames]);

  useEffect(() => {
    carPlay.setVoiceState(voiceState);
  }, [voiceState]);

  return null;
}
