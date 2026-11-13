import { type SidebarPin, sidebarPinKey } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import {
  GestureDetector,
  GestureStateManager,
  type PanGesture,
  type PanGestureConfig,
  usePanGesture,
} from "react-native-gesture-handler";
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { useAppDrawer } from "@/features/servers/components/app-drawer-shell";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import {
  type ChatDropTarget,
  chatDropChange,
  chatDropTarget,
  type DraggedChat,
  type DragRect,
  type DropChange,
  type DropMark,
  type ListFrame,
  type PinnedTileFrame,
} from "@/features/workspace/model/chat-drag";
import type { MobileSidebarItem } from "@/features/workspace/model/sidebar-layout";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";
import { typeScale } from "@/shared/lib/type-scale";

/** The hold before a move drags the chat. A move before it scrolls the list or swipes the row. */
const HOLD_MS = 250;
/** A move this far before the hold is a scroll or a swipe, not a drag. A slow scroll passes it early. */
const SCROLL_SLOP = 6;
/** After the hold, a move this far starts the drag. iOS cancels its menu at about the same distance. */
const DRAG_SLOP = 8;
/** The band at the top and bottom of the list where a drag scrolls it. */
const EDGE = 72;
/** The fastest edge scroll, in points per millisecond: 14 points in a 60 Hz frame. */
const MAX_SCROLL_SPEED = 14 / (1000 / 60);
/** The first frame of an edge scroll, and the longest step after a late frame, in milliseconds. */
const SCROLL_FRAME_MS = 1000 / 60;
const MAX_SCROLL_FRAME_MS = 50;
export const DRAG_AVATAR_SIZE = 40;

type ViewRef = ViewInstance;

/** A chat as a drag starts it. `preview` is the avatar that follows the finger. */
export interface ChatDragSource extends DraggedChat {
  name: string;
  preview: ReactNode;
}

/** What the screen gives the drag: the chats it shows, and how to scroll its list. */
export interface ChatDragScreen {
  /** The list entries, as the list shows them. */
  items: readonly MobileSidebarItem[];
  /** The pinned tiles, as the grid shows them: the agents, then the channels. */
  pins: readonly SidebarPin[];
  collapsedSectionIds: ReadonlySet<string> | undefined;
  /** False when the host keeps no layout: then a drag in the list only unpins. */
  sections: boolean;
  /** True when one more chat can be pinned. */
  canPin: boolean;
  /** The heights at the top and bottom of the list that the bars cover. */
  scrollInsets: { top: number; bottom: number };
  /** Called when a drag starts, before the first `scrollBy`. */
  beginScroll: () => void;
  /** Scrolls the list by `delta` points, and returns false at an end of the list. */
  scrollBy: (delta: number) => boolean;
  onDraggingChange: (dragging: boolean) => void;
  onDrop: (dragged: DraggedChat, target: ChatDropTarget, change: DropChange) => void;
  /** The pin list of the server in the order of the host, for the place of a new pin. */
  readPins: () => SidebarPin[];
  layout: () => Parameters<typeof chatDropChange>[3];
}

interface ChatDragContextValue {
  register: (key: string, view: ViewRef | null) => void;
  begin: (key: string, source: ChatDragSource, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: (drop: boolean) => void;
  /** The key of the dragged chat, or "". Rows read it on the UI thread to fade their own copy. */
  activeKey: SharedValue<string>;
  fingerX: SharedValue<number>;
  fingerY: SharedValue<number>;
}

const ChatDragContext = createContext<ChatDragContextValue | null>(null);

/** The key of a drop target or a drag source. */
function chatDragKey(place: "pin" | "row", chat: SidebarPin): string {
  return `${place}:${sidebarPinKey(chat)}`;
}

export const PIN_AREA_KEY = "pin-area";

export function sectionDragKey(sectionId: string): string {
  return `section:${sectionId}`;
}

function measure(view: ViewRef | undefined): DragRect | null {
  if (!view) return null;
  const rect = view.getBoundingClientRect();
  return rect.height >= 1 && rect.width >= 1 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
}

function sameMark(left: DropMark | null, right: DropMark | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.shape === right.shape &&
    Math.abs(left.rect.x - right.rect.x) < 0.5 &&
    Math.abs(left.rect.y - right.rect.y) < 0.5 &&
    Math.abs(left.rect.width - right.rect.width) < 0.5 &&
    Math.abs(left.rect.height - right.rect.height) < 0.5
  );
}

function sameTarget(left: ChatDropTarget | null, right: ChatDropTarget | null): boolean {
  if (left === null || right === null) return left === right;
  if (left.area === "pins" && right.area === "pins") return left.beforeKey === right.beforeKey;
  if (left.area === "list" && right.area === "list")
    return left.sectionId === right.sectionId && left.beforeChatId === right.beforeChatId;
  return false;
}

interface DragSession {
  key: string;
  source: ChatDragSource;
  target: ChatDropTarget | null;
  change: DropChange;
  x: number;
  y: number;
  origin: { x: number; y: number };
}

/**
 * Drag and drop of the chats of the home list. The user holds a row or a pinned tile, then moves the
 * finger: the chat follows the finger, a line shows where it goes, and the list scrolls at its ends.
 * A drop in the pins pins the chat or moves its pin; a drop in the list moves it in its section or to
 * another section, and unpins a pinned chat.
 */
export function ChatDragProvider({ screen, children }: PropsWithChildren<{ screen: ChatDragScreen }>) {
  const views = useRef(new Map<string, ViewRef>());
  const root = useRef<ViewRef>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const session = useRef<DragSession | null>(null);
  const frame = useRef<number | null>(null);
  const lastTick = useRef<number | null>(null);
  const activeKey = useSharedValue("");
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const [ghost, setGhost] = useState<{ source: ChatDragSource; grab: { x: number; y: number } } | null>(null);
  const [mark, setMark] = useState<DropMark | null>(null);

  const update = useCallback(() => {
    const current = session.current;
    if (!current) return;
    const { items, pins, collapsedSectionIds, sections, canPin } = screenRef.current;
    const list: ListFrame[] = [];
    let sectionId: string | null = null;
    for (const item of items) {
      // "Needs you" and "Unread" are not sections of the layout.
      if (item.kind === "waiting" || item.kind === "unread") {
        sectionId = null;
        continue;
      }
      if (item.kind === "section") {
        sectionId = item.id;
        const rect = measure(views.current.get(sectionDragKey(item.id)));
        if (rect) list.push({ kind: "section", id: item.id, rect, open: !collapsedSectionIds?.has(item.id) });
        continue;
      }
      const chat: SidebarPin = { kind: item.kind, id: item.id };
      const rect = measure(views.current.get(chatDragKey("row", chat)));
      if (rect) list.push({ kind: "chat", chat, sectionId, rect });
    }
    const tiles: PinnedTileFrame[] = pins.flatMap((chat) => {
      const rect = measure(views.current.get(chatDragKey("pin", chat)));
      return rect ? [{ chat, rect }] : [];
    });
    const found = chatDropTarget(
      { pinArea: measure(views.current.get(PIN_AREA_KEY)), pins: tiles, list },
      current.source,
      current.x,
      current.y,
      { canPin, sections },
    );
    const change = found
      ? chatDropChange(current.source, found.target, screenRef.current.readPins(), screenRef.current.layout())
      : {};
    const useful = found !== null && (change.pins !== undefined || change.move !== undefined);
    const target = useful ? found.target : null;
    if (!sameTarget(current.target, target) && target) void haptics.selection();
    current.target = target;
    current.change = change;
    const nextMark = useful ? found.mark : null;
    // The mark is in window coordinates, and the overlay starts at the top left corner of the list.
    const shifted = nextMark
      ? {
          ...nextMark,
          rect: { ...nextMark.rect, x: nextMark.rect.x - current.origin.x, y: nextMark.rect.y - current.origin.y },
        }
      : null;
    setMark((previous) => (sameMark(previous, shifted) ? previous : shifted));
  }, []);

  const tick = useCallback(
    (time: number) => {
      frame.current = null;
      // The scroll moves by the time since the last frame, so it has one speed at 60 and 120 Hz.
      const elapsed =
        lastTick.current === null ? SCROLL_FRAME_MS : Math.min(time - lastTick.current, MAX_SCROLL_FRAME_MS);
      lastTick.current = null;
      const current = session.current;
      if (!current) return;
      const { scrollInsets, scrollBy } = screenRef.current;
      const area = measure(root.current ?? undefined);
      const reach = MAX_SCROLL_SPEED * Math.max(0, elapsed);
      let step = 0;
      if (area) {
        const top = area.y + scrollInsets.top;
        const bottom = area.y + area.height - scrollInsets.bottom;
        if (current.y < top + EDGE) step = -reach * Math.min(1, (top + EDGE - current.y) / EDGE);
        else if (current.y > bottom - EDGE) step = reach * Math.min(1, (current.y - (bottom - EDGE)) / EDGE);
      }
      const scrolled = step !== 0 && scrollBy(step);
      update();
      // The list scrolls while the finger rests in a band, so the loop runs again without a move.
      if (scrolled) {
        lastTick.current = time;
        frame.current = requestAnimationFrame(tick);
      }
    },
    [update],
  );

  const schedule = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(tick);
  }, [tick]);

  const begin = useCallback(
    (key: string, source: ChatDragSource, x: number, y: number) => {
      if (session.current) return;
      const area = measure(root.current ?? undefined);
      const from = measure(views.current.get(key));
      const origin = { x: area?.x ?? 0, y: area?.y ?? 0 };
      session.current = { key, source, target: null, change: {}, x, y, origin };
      // The avatar stays under the same point of the finger, close to where the user took it.
      const grab = from
        ? { x: Math.min(Math.max(x - from.x, 0), 64), y: Math.min(Math.max(y - from.y, 0), from.height) }
        : { x: 32, y: 32 };
      setGhost({ source, grab: { x: grab.x + origin.x, y: grab.y + origin.y } });
      screenRef.current.beginScroll();
      screenRef.current.onDraggingChange(true);
      void haptics.impact("medium");
      schedule();
    },
    [schedule],
  );

  const move = useCallback(
    (x: number, y: number) => {
      const current = session.current;
      if (!current) return;
      current.x = x;
      current.y = y;
      schedule();
    },
    [schedule],
  );

  const end = useCallback(
    (drop: boolean) => {
      const current = session.current;
      session.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      lastTick.current = null;
      activeKey.set("");
      setGhost(null);
      setMark(null);
      if (!current) return;
      screenRef.current.onDraggingChange(false);
      if (drop && current.target) {
        void haptics.impact("light");
        screenRef.current.onDrop(current.source, current.target, current.change);
      }
    },
    [activeKey],
  );

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const register = useCallback((key: string, view: ViewRef | null) => {
    if (view) views.current.set(key, view);
    else views.current.delete(key);
  }, []);

  const value = useMemo(
    () => ({ register, begin, move, end, activeKey, fingerX, fingerY }),
    [register, begin, move, end, activeKey, fingerX, fingerY],
  );

  return (
    <ChatDragContext.Provider value={value}>
      <View ref={root} collapsable={false} style={styles.fill}>
        {children}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {mark ? <DropMarkView mark={mark} /> : null}
          {ghost ? <DragGhost source={ghost.source} grab={ghost.grab} x={fingerX} y={fingerY} /> : null}
        </View>
      </View>
    </ChatDragContext.Provider>
  );
}

function DropMarkView({ mark }: { mark: DropMark }) {
  const [accent] = useThemeColor(["accent"]);
  if (mark.shape === "zone") {
    return (
      <View
        style={{
          position: "absolute",
          left: mark.rect.x,
          top: mark.rect.y,
          width: mark.rect.width,
          height: mark.rect.height,
          borderRadius: 20,
          borderWidth: 2,
          borderColor: accent,
        }}
      />
    );
  }
  return (
    <View
      style={{
        position: "absolute",
        left: mark.rect.x,
        top: mark.rect.y,
        width: mark.rect.width,
        height: mark.rect.height,
        borderRadius: 2,
        backgroundColor: accent,
      }}
    />
  );
}

function DragGhost({
  source,
  grab,
  x,
  y,
}: {
  source: ChatDragSource;
  grab: { x: number; y: number };
  x: SharedValue<number>;
  y: SharedValue<number>;
}) {
  const reducedMotion = useReducedMotion();
  const lift = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (!reducedMotion) lift.set(withSpring(1, { damping: 18, stiffness: 320 }));
  }, [lift, reducedMotion]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() - grab.x }, { translateY: y.get() - grab.y }, { scale: 1 + 0.06 * lift.get() }],
  }));
  return (
    <Animated.View style={[styles.ghost, style]}>
      <View className="flex-row items-center gap-3 rounded-full bg-background py-1.5 pl-1.5 pr-4" style={styles.card}>
        {source.preview}
        <Typography.Paragraph className="font-semibold" numberOfLines={1} style={[typeScale.rowTitle, styles.name]}>
          {source.name}
        </Typography.Paragraph>
      </View>
    </Animated.View>
  );
}

/**
 * The drag of one chat: the gesture for its detector, the ref for its frame, and the style that fades
 * the chat while the user drags it. Without a `ChatDragProvider`, the gesture never starts.
 */
export function useChatDrag(place: "pin" | "row", source: () => ChatDragSource) {
  const drag = useContext(ChatDragContext);
  const { openingGesture } = useAppDrawer();
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const key = chatDragKey(place, source().chat);
  const keyRef = useRef(key);
  keyRef.current = key;
  const origin = useSharedValue({ x: 0, y: 0 });
  const downAt = useSharedValue(0);
  const dragging = useSharedValue(false);
  const enabled = drag !== null;

  const begin = useCallback((x: number, y: number) => drag?.begin(keyRef.current, sourceRef.current(), x, y), [drag]);
  const move = useCallback((x: number, y: number) => drag?.move(x, y), [drag]);
  const end = useCallback((drop: boolean) => drag?.end(drop), [drag]);
  const activeKey = drag?.activeKey;
  const fingerX = drag?.fingerX;
  const fingerY = drag?.fingerY;

  const config = useMemo<PanGestureConfig>(
    () => ({
      enabled,
      manualActivation: true,
      maxPointers: 1,
      // The drawer waits until the drag fails, as a hold and a move to the right would open it too.
      block: openingGesture,
      onTouchesDown: (event) => {
        "worklet";
        const touch = event.allTouches[0];
        if (!touch || event.numberOfTouches > 1) {
          GestureStateManager.fail(event.handlerTag);
          return;
        }
        origin.set({ x: touch.absoluteX, y: touch.absoluteY });
        downAt.set(Date.now());
      },
      onTouchesMove: (event) => {
        "worklet";
        if (dragging.get()) return;
        const touch = event.allTouches[0];
        if (!touch || event.numberOfTouches > 1) {
          GestureStateManager.fail(event.handlerTag);
          return;
        }
        const distance = Math.hypot(touch.absoluteX - origin.get().x, touch.absoluteY - origin.get().y);
        if (Date.now() - downAt.get() < HOLD_MS) {
          if (distance > SCROLL_SLOP) GestureStateManager.fail(event.handlerTag);
        } else if (distance > DRAG_SLOP) GestureStateManager.activate(event.handlerTag);
      },
      onActivate: (event) => {
        "worklet";
        dragging.set(true);
        activeKey?.set(key);
        fingerX?.set(event.absoluteX);
        fingerY?.set(event.absoluteY);
        scheduleOnRN(begin, event.absoluteX, event.absoluteY);
      },
      onUpdate: (event) => {
        "worklet";
        fingerX?.set(event.absoluteX);
        fingerY?.set(event.absoluteY);
        scheduleOnRN(move, event.absoluteX, event.absoluteY);
      },
      onFinalize: (event) => {
        "worklet";
        if (!dragging.get()) return;
        dragging.set(false);
        scheduleOnRN(end, !event.canceled);
      },
    }),
    [activeKey, begin, downAt, dragging, enabled, end, fingerX, fingerY, key, move, openingGesture, origin],
  );
  const gesture: PanGesture = usePanGesture(config);

  const ref = useCallback((view: ViewRef | null) => drag?.register(keyRef.current, view), [drag]);
  const style = useAnimatedStyle(() => ({ opacity: activeKey && activeKey.get() === key ? 0.35 : 1 }));

  return {
    gesture,
    ref,
    style,
    /** True while this chat is the dragged one. Read it after the finger lifts, not in a render. */
    isDragging: () => activeKey?.get() === keyRef.current,
  };
}

/** The view that a chat drag holds: it takes the gesture, gives the frame, and fades while dragged. */
export function ChatDragArea({
  drag,
  fill = false,
  children,
}: PropsWithChildren<{ drag: ReturnType<typeof useChatDrag>; fill?: boolean }>) {
  return (
    <GestureDetector gesture={drag.gesture}>
      <Animated.View style={fill ? [styles.fullWidth, drag.style] : drag.style}>
        <View ref={drag.ref} collapsable={false} style={fill ? styles.fullWidth : undefined}>
          {children}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * The long press of a chat. On iOS the system menu opens while the finger rests. On Android the menu
 * opens when the finger lifts, so a hold that then moves drags the chat instead.
 */
export function useHoldMenu(drag: ReturnType<typeof useChatDrag>, openAndroidMenu: () => void) {
  const armed = useRef(false);
  return {
    onLongPress: () => {
      void haptics.longPress();
      if (isAndroid) armed.current = true;
    },
    onPressOut: () => {
      if (!armed.current) return;
      armed.current = false;
      // A drag ends the press too. The drag starts first on the UI thread, so a frame later it shows.
      requestAnimationFrame(() => {
        if (!drag.isDragging()) openAndroidMenu();
      });
    },
  };
}

/** The avatar of an agent that follows the finger. */
export function AgentDragPreview({ agent }: { agent: MobileAgent }) {
  return (
    <BloubAvatar
      agentId={agent.id}
      serverId={agent.serverId}
      hue={agent.avatarHue}
      color={agent.avatarColor}
      seed={agent.avatarSeed}
      size={DRAG_AVATAR_SIZE}
      animateIdle={false}
    />
  );
}

/** Registers a view that takes a drop: a section header or the pin area. */
export function useChatDropTarget(key: string) {
  const drag = useContext(ChatDragContext);
  return useCallback((view: ViewRef | null) => drag?.register(key, view), [drag, key]);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fullWidth: { width: "100%" },
  ghost: { position: "absolute", left: 0, top: 0 },
  card: {
    maxWidth: 260,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  name: { flexShrink: 1 },
});
