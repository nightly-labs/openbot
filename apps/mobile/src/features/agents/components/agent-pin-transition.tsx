import type { AvatarHue, ChannelSummary } from "@openbot/contracts/ipc";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View, type ViewInstance } from "react-native";
import { Easing, ReduceMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { AgentPinTransitionOverlay } from "@/features/agents/components/agent-pin-transition-overlay";
import { type MobileAgent, useMobileWorkspaceReader } from "@/features/workspace/context/mobile-workspace-context";
import { canToggleAgentPin } from "@/features/workspace/model/agent-pins";
import { showsOnline } from "@/features/workspace/model/server-status";
import { haptics } from "@/shared/lib/haptics";

export type AgentAvatarLocation = "chat" | "pinned" | "row";

interface AvatarRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface AgentPinTransitionState {
  chatId: string;
  avatar:
    | { kind: "agent"; hue: AvatarHue | null; seed: string }
    | { kind: "channel"; channel: ChannelSummary; agents: ReadonlyMap<string, MobileAgent>; disconnected: boolean };
  from: AvatarRect;
  source: AgentAvatarLocation;
  target: AgentAvatarLocation;
  to?: AvatarRect;
}

interface AgentPinTransitionContextValue {
  registerAvatar: (agentId: string, location: AgentAvatarLocation, node: ViewInstance | null) => void;
  notifyAvatarLayout: (agentId: string, location: AgentAvatarLocation) => void;
  toggleAgentPinAnimated: (agentId: string, options?: { haptic: boolean }) => void;
  toggleChannelPinAnimated: (channel: ChannelSummary, serverId: string, options?: { haptic: boolean }) => void;
  transition: AgentPinTransitionState | null;
}

const AgentPinTransitionContext = createContext<AgentPinTransitionContextValue | null>(null);
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
const TRANSITION_DURATION = 320;

export function AgentPinTransitionProvider({ children }: PropsWithChildren) {
  // Read when a pin changes, so the rows that use this context do not render for every workspace update.
  const workspace = useMobileWorkspaceReader();
  const containerRef = useRef<ViewInstance>(null);
  const avatarRefs = useRef(new Map<string, Partial<Record<AgentAvatarLocation, ViewInstance>>>()).current;
  const avatarRects = useRef(new Map<string, Partial<Record<AgentAvatarLocation, AvatarRect>>>()).current;
  const transitionRef = useRef<AgentPinTransitionState | null>(null);
  const animationStartedRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transition, setTransition] = useState<AgentPinTransitionState | null>(null);
  const progress = useSharedValue(0);

  const finishTransition = useCallback(() => {
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    animationStartedRef.current = false;
    transitionRef.current = null;
    setTransition(null);
  }, []);

  const startMovement = useCallback(
    (nextTransition: AgentPinTransitionState) => {
      if (animationStartedRef.current) return;
      animationStartedRef.current = true;
      transitionRef.current = nextTransition;
      setTransition(nextTransition);
      progress.set(0);
      progress.set(
        withTiming(
          1,
          {
            duration: TRANSITION_DURATION,
            easing: EASE_IN_OUT,
            reduceMotion: ReduceMotion.System,
          },
          (finished) => {
            "worklet";
            if (finished) scheduleOnRN(finishTransition);
          },
        ),
      );
    },
    [finishTransition, progress],
  );

  const measureAvatar = useCallback(
    (agentId: string, location: AgentAvatarLocation) => {
      const node = avatarRefs.get(agentId)?.[location];
      const container = containerRef.current;
      if (!node || !container) return;

      container.measureInWindow((containerX, containerY) => {
        node.measureInWindow((x, y, width, height) => {
          const rect = { x: x - containerX, y: y - containerY, width, height };
          const rects = avatarRects.get(agentId) ?? {};
          rects[location] = rect;
          avatarRects.set(agentId, rects);

          const latest = transitionRef.current;
          if (!latest || latest.chatId !== agentId || latest.target !== location || latest.to) return;

          const nextTransition = {
            ...latest,
            to: rect,
          };
          startMovement(nextTransition);
        });
      });
    },
    [avatarRects, avatarRefs, startMovement],
  );

  const registerAvatar = useCallback(
    (agentId: string, location: AgentAvatarLocation, node: ViewInstance | null) => {
      const refs = avatarRefs.get(agentId) ?? {};
      if (node) {
        refs[location] = node;
        avatarRefs.set(agentId, refs);
        requestAnimationFrame(() => measureAvatar(agentId, location));
      } else {
        delete refs[location];
        if (Object.keys(refs).length === 0) avatarRefs.delete(agentId);
      }
    },
    [avatarRefs, measureAvatar],
  );

  const notifyAvatarLayout = useCallback(
    (agentId: string, location: AgentAvatarLocation) => {
      requestAnimationFrame(() => measureAvatar(agentId, location));
    },
    [measureAvatar],
  );

  const togglePinAnimated = useCallback(
    (
      chatId: string,
      avatar: AgentPinTransitionState["avatar"],
      isPinned: boolean,
      commit: () => string,
      options?: { haptic: boolean },
    ) => {
      const { pinnedAgentIds, pinnedChannelIds } = workspace();
      if (transitionRef.current || !canToggleAgentPin([...pinnedAgentIds, ...pinnedChannelIds], chatId)) return;
      const source: AgentAvatarLocation = isPinned ? "pinned" : "row";
      const target: AgentAvatarLocation = isPinned ? "row" : "pinned";
      const sourceNode = avatarRefs.get(chatId)?.[source];
      const container = containerRef.current;

      const commitWithoutMovement = () => {
        if (commit() === "error") {
          finishTransition();
          return;
        }
        if (options?.haptic !== false) void haptics.selection();
      };

      if (!sourceNode || !container) {
        commitWithoutMovement();
        return;
      }

      container.measureInWindow((containerX, containerY) => {
        sourceNode.measureInWindow((x, y, width, height) => {
          const nextTransition: AgentPinTransitionState = {
            chatId,
            avatar,
            from: { x: x - containerX, y: y - containerY, width, height },
            source,
            target,
          };
          transitionRef.current = nextTransition;
          setTransition(nextTransition);
          progress.set(0);

          requestAnimationFrame(() => {
            if (commit() === "error") {
              finishTransition();
              return;
            }
            if (options?.haptic !== false) void haptics.selection();
            fallbackTimerRef.current = setTimeout(finishTransition, 700);
          });
        });
      });
    },
    [avatarRefs, finishTransition, progress, workspace],
  );

  const toggleAgentPinAnimated = useCallback(
    (agentId: string, options?: { haptic: boolean }) => {
      const { agents, pinnedAgentIds } = workspace();
      const agent = agents.find((item) => item.id === agentId);
      if (!agent) return;
      togglePinAnimated(
        agentId,
        { kind: "agent", hue: agent.avatarHue, seed: agent.avatarSeed },
        pinnedAgentIds.includes(agentId),
        () => workspace().toggleAgentPin(agentId),
        options,
      );
    },
    [togglePinAnimated, workspace],
  );

  const toggleChannelPinAnimated = useCallback(
    (channel: ChannelSummary, serverId: string, options?: { haptic: boolean }) => {
      const { agents, servers, pinnedChannelIds } = workspace();
      togglePinAnimated(
        channel.id,
        {
          kind: "channel",
          channel,
          agents: new Map(agents.filter((agent) => agent.serverId === serverId).map((agent) => [agent.id, agent])),
          disconnected: !servers.some((server) => server.id === serverId && showsOnline(server)),
        },
        pinnedChannelIds.includes(channel.id),
        () => workspace().toggleChannelPin(channel.id, serverId),
        options,
      );
    },
    [togglePinAnimated, workspace],
  );

  useEffect(
    () => () => {
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    },
    [],
  );

  const contextValue = useMemo<AgentPinTransitionContextValue>(
    () => ({
      registerAvatar,
      notifyAvatarLayout,
      toggleAgentPinAnimated,
      toggleChannelPinAnimated,
      transition,
    }),
    [notifyAvatarLayout, registerAvatar, toggleAgentPinAnimated, toggleChannelPinAnimated, transition],
  );

  return (
    <AgentPinTransitionContext.Provider value={contextValue}>
      <View ref={containerRef} collapsable={false} style={{ flex: 1 }}>
        {children}
        <AgentPinTransitionOverlay progress={progress} transition={transition} />
      </View>
    </AgentPinTransitionContext.Provider>
  );
}

export function useAgentPinTransition(): AgentPinTransitionContextValue {
  const context = useContext(AgentPinTransitionContext);
  const workspace = useMobileWorkspaceReader();

  return useMemo(
    () =>
      context ?? {
        notifyAvatarLayout: () => undefined,
        registerAvatar: () => undefined,
        toggleAgentPinAnimated: (agentId: string) => {
          workspace().toggleAgentPin(agentId);
        },
        toggleChannelPinAnimated: (channel: ChannelSummary, serverId: string) => {
          workspace().toggleChannelPin(channel.id, serverId);
        },
        transition: null,
      },
    [context, workspace],
  );
}
