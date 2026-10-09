import type { BrowserViewContextMenu, BrowserViewCursor } from "@openbot/contracts/team-protocol/browser-view-v1";
import { type SkImage, Skia } from "@shopify/react-native-skia";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSharedValue } from "react-native-reanimated";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import type { RemoteBrowserViewSession } from "../model/browser-view-bridge";
import type { Size } from "../model/live-view-geometry";
import { createLiveViewInputQueue } from "../model/live-view-input-queue";

export type BrowserLiveViewStatus =
  | { kind: "connecting" }
  | { kind: "live" }
  /** The view ended. `reason` is the host's English text, or null. */
  | { kind: "ended"; reason: string | null }
  /** The phone has no connection to the host that could carry a view. */
  | { kind: "offline" };

/** How long a copy waits for the host's answer. */
const SELECTION_TIMEOUT_MS = 5_000;
/** Decoded frames kept after they leave the screen, so the UI thread never draws a released one. */
const RETIRED_FRAMES = 2;

/**
 * One live view of a host browser tab while `active` is true. A new tab or the end of `active`
 * closes the view and, when there is one, opens the next. To try again, mount the hook again.
 * `onContextMenu` hears the menu of a right-click, from a host that sends it.
 */
export function useBrowserLiveView(
  serverId: string,
  tabId: string | null,
  active: boolean,
  onContextMenu: (menu: BrowserViewContextMenu) => void,
) {
  const { openBrowserView } = useMobileWorkspace();
  // The workspace value changes with every server and agent update. A view stays open through them.
  const open = useRef(openBrowserView);
  open.current = openBrowserView;
  const contextMenu = useRef(onContextMenu);
  contextMenu.current = onContextMenu;
  const image = useSharedValue<SkImage | null>(null);
  const [status, setStatus] = useState<BrowserLiveViewStatus>({ kind: "connecting" });
  const [frame, setFrame] = useState<Size | null>(null);
  const [cursor, setCursor] = useState<BrowserViewCursor>("default");
  const session = useRef<RemoteBrowserViewSession | null>(null);
  const drawn = useRef<number | null>(null);
  const selections = useRef<((text: string | null) => void)[]>([]);
  const shownTab = useRef(tabId);
  /** Input for the page. Moves and scroll steps wait for the next frame of the screen and go as one. */
  const queue = useMemo(
    () =>
      createLiveViewInputQueue(
        (inputs) => session.current?.input(inputs),
        (callback) => {
          const id = requestAnimationFrame(() => callback());
          return () => cancelAnimationFrame(id);
        },
      ),
    [],
  );

  useEffect(() => {
    // A frame belongs to its tab. Another tab, or no tab, does not show it, as a closed tab does not.
    // The frame stays while the same tab is only paused, such as with the app in the background.
    if (shownTab.current !== tabId) {
      shownTab.current = tabId;
      image.value = null;
      setFrame(null);
      setCursor("default");
    }
    if (!active || !tabId) return;
    setStatus({ kind: "connecting" });
    setCursor("default");
    drawn.current = null;
    const retired: SkImage[] = [];
    let live = false;
    const view = open.current(serverId, tabId, (event) => {
      if (event.type === "frame") {
        let decoded: SkImage | null = null;
        try {
          decoded = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(event.jpeg));
        } catch {
          decoded = null;
        }
        if (decoded) {
          const previous = image.value;
          image.value = decoded;
          if (previous) retired.push(previous);
          while (retired.length > RETIRED_FRAMES) retired.shift()?.dispose();
          drawn.current = event.sequence;
          setFrame((current) =>
            current?.width === event.width && current.height === event.height
              ? current
              : { width: event.width, height: event.height },
          );
          if (!live) {
            live = true;
            setStatus({ kind: "live" });
          }
        }
        // A queued move or scroll names the frame that was on screen when the finger made it. It goes
        // before this frame is reported drawn: the host forgets older frames then, and drops input
        // that names one.
        queue.flush();
        view?.frameDone(event.sequence, decoded !== null);
      } else if (event.type === "message") {
        const message = event.message;
        if (message.type === "cursor") setCursor(message.cursor);
        else if (message.type === "copied") selections.current.shift()?.(message.text);
        else if (message.type === "copyTooLarge") selections.current.shift()?.(null);
        else contextMenu.current(message);
      } else {
        session.current = null;
        setStatus({ kind: "ended", reason: event.reason });
      }
    });
    if (!view) {
      setStatus({ kind: "offline" });
      return;
    }
    session.current = view;
    return () => {
      queue.clear();
      view.close();
      if (session.current === view) session.current = null;
      drawn.current = null;
      selections.current = [];
    };
  }, [active, image, queue, serverId, tabId]);

  /** The page's selected text, or null when it is longer than one copy carries. Rejects when the host does not answer. */
  const requestSelection = useCallback(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const view = session.current;
        if (!view) {
          reject(new Error("The live view is not connected."));
          return;
        }
        const timer = setTimeout(() => {
          selections.current = selections.current.filter((waiter) => waiter !== answer);
          reject(new Error("The host did not answer."));
        }, SELECTION_TIMEOUT_MS);
        const answer = (text: string | null) => {
          clearTimeout(timer);
          resolve(text);
        };
        selections.current.push(answer);
        // After the input that waits, such as the end of a drag that selected the text.
        queue.push({ type: "copy" });
      }),
    [queue],
  );

  return {
    image,
    status,
    frame,
    cursor,
    /** The frame on screen, which a point on the page belongs to. */
    drawnSequence: useCallback(() => drawn.current, []),
    /** Input for the page, in order. A move or a scroll step waits for the next frame of the screen. */
    send: queue.push,
    requestSelection,
  };
}
