import type {
  BrowserViewContextMenu,
  BrowserViewCursor,
  BrowserViewDialog,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { type SkImage, Skia } from "@shopify/react-native-skia";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { currentText } from "@/shared/lib/text";
import type { RemoteBrowserViewSession } from "../model/browser-view-bridge";
import type { Size } from "../model/live-view-geometry";
import { createLiveViewInputQueue } from "../model/live-view-input-queue";

export type BrowserLiveViewStatus =
  | { kind: "connecting" }
  | { kind: "live" }
  | { kind: "ended"; reason: string | null }
  | { kind: "offline" };

const SELECTION_TIMEOUT_MS = 5_000;
const RETIRED_FRAMES = 2;

export function useBrowserLiveView(
  serverId: string,
  tabId: string | null,
  active: boolean,
  onContextMenu: (menu: BrowserViewContextMenu) => void,
  onPageCopy: (text: string) => void,
) {
  const { openBrowserView } = useMobileWorkspaceActions();
  const contextMenu = useRef(onContextMenu);
  contextMenu.current = onContextMenu;
  const pageCopy = useRef(onPageCopy);
  pageCopy.current = onPageCopy;
  const image = useSharedValue<SkImage | null>(null);
  const [status, setStatus] = useState<BrowserLiveViewStatus>({ kind: "connecting" });
  const [frame, setFrame] = useState<Size | null>(null);
  const [cursor, setCursor] = useState<BrowserViewCursor>("default");
  const session = useRef<RemoteBrowserViewSession | null>(null);
  const drawn = useRef<number | null>(null);
  const selections = useRef<((text: string | null) => void)[]>([]);
  const shownTab = useRef(tabId);
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
    const view = openBrowserView(serverId, tabId, (event) => {
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
        queue.flush();
        view?.frameDone(event.sequence, decoded !== null);
      } else if (event.type === "message") {
        const message = event.message;
        if (message.type === "cursor") setCursor(message.cursor);
        else if (message.type === "copied") selections.current.shift()?.(message.text);
        else if (message.type === "copyTooLarge") selections.current.shift()?.(null);
        else if (message.type === "pageCopied") pageCopy.current(message.text);
        else if (message.type === "dialog") {
          if (message.dialog) showPageDialog(message.dialog, (input) => queue.push(input));
        } else contextMenu.current(message);
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
  }, [active, image, queue, serverId, tabId, openBrowserView]);

  const requestSelection = useCallback(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const view = session.current;
        if (!view) {
          reject(new Error("The live view is not connected."));
          return;
        }
        const timer = setTimeout(() => reject(new Error("The host did not answer.")), SELECTION_TIMEOUT_MS);
        const answer = (text: string | null) => {
          clearTimeout(timer);
          resolve(text);
        };
        selections.current.push(answer);
        queue.push({ type: "copy" });
      }),
    [queue],
  );

  return {
    image,
    status,
    frame,
    cursor,
    drawnSequence: useCallback(() => drawn.current, []),
    send: queue.push,
    requestSelection,
  };
}

function showPageDialog(
  dialog: BrowserViewDialog,
  send: (input: { type: "dialog"; id: string; accept: boolean }) => void,
) {
  const { t } = currentText();
  const answer = (accept: boolean) => send({ type: "dialog", id: dialog.id, accept });
  Alert.alert(
    t("mobile.browser.dialog.title"),
    dialog.message,
    [
      ...(dialog.type === "confirm"
        ? [{ text: t("common.cancel"), style: "cancel" as const, onPress: () => answer(false) }]
        : []),
      { text: t("mobile.browser.dialog.ok"), onPress: () => answer(true) },
    ],
    { cancelable: true, onDismiss: () => answer(false) },
  );
}
