import { type ChatBackdropBubbles, chatBackdropBubbles } from "@openbot/contracts/chat-visual";
import { ChatBackdrop } from "@openbot/ui/features/conversation/ChatBackdrop";
import { CustomBackdrop, type CustomBackdropSource } from "@openbot/ui/features/conversation/CustomBackdrop";
import { customBackdropId, isChatBackdropScene } from "@openbot/ui/features/conversation/chat-backdrop";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useChatBackdrop } from "../../chat-backdrop-preference";
import { hideChatBackgroundForBackdrop } from "../../chat-background";
import { readCustomBackdrop, type CustomBackdrop as SavedBackdrop, useCustomBackdrops } from "../../custom-backdrops";
import { setWindowGlass } from "../../window-glass";
import { conversationPort, releaseFilePreviewPage } from "../conversation/conversation-port";
import { setShownBackdropBubbles } from "./backdrop-bubbles";

/** A picture as a data URL: the desktop page policy allows `data:` pictures, not `blob:`. */
function dataUrl(backdrop: SavedBackdrop): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(reader.error));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(backdrop.blob);
  });
}

/**
 * The scene behind the whole window: the page rail, the sidebar, the chat and the side panel. It is
 * a built-in animated scene, or a backdrop that the user added (`custom-backdrops.ts`). While one
 * shows, the window uses the clear surfaces of the transparent window, so the backdrop shows through
 * them, and the chat background color does not show.
 *
 * `pages` says how a page backdrop loads. The desktop policy stops scripts in `srcdoc`, so the
 * desktop keeps the page in main for the time it shows (`addPreviewPage`). The web client has no
 * main process and gives the HTML to the frame.
 *
 * A page can bring chat bubble colors (`chatBackdropBubbles`). The chat bubbles of the window take
 * them while that page shows (`backdrop-bubbles.tsx`).
 */
export function WindowBackdrop(props: { pages?: "desktop" | "srcdoc" }) {
  const choice = useChatBackdrop();
  const scene = () => {
    const current = choice();
    return isChatBackdropScene(current) ? current : null;
  };
  const customId = () => {
    const current = choice();
    return current === null ? null : customBackdropId(current);
  };
  const saved = useCustomBackdrops();
  /** The id and the save time: an agent that changes its scene keeps the id, so the time loads it again. */
  const customVersion = () => {
    const id = customId();
    if (id === null) return null;
    return `${id}\0${saved().find((backdrop) => backdrop.id === id)?.createdAt ?? ""}`;
  };
  type ShownBackdrop = { source: CustomBackdropSource; name: string; bubbles: ChatBackdropBubbles | null };
  const [custom, setCustom] = createSignal<ShownBackdrop | null>(null);

  /**
   * The page that shows now stays until the next one is ready, so a changed scene does not flash the
   * window. Main keeps a desktop page until it is released.
   */
  let shownPage: string | undefined;
  const showCustom = (next: ShownBackdrop | null, page?: string) => {
    setCustom(next);
    const old = shownPage;
    shownPage = page;
    if (old !== page) releaseFilePreviewPage(old);
  };
  onCleanup(() => releaseFilePreviewPage(shownPage));
  /**
   * The version that shows now. At start the list of backdrops is not read yet, so the version has no
   * time; when the list comes, the same backdrop does not load again.
   */
  let shownVersion: string | null = null;

  createEffect(customVersion, (version) => {
    const id = version === null ? null : customId();
    if (id === null) {
      shownVersion = null;
      showCustom(null);
      return;
    }
    if (version === shownVersion) return;
    let cancelled = false;
    const show = async () => {
      const backdrop = await readCustomBackdrop(id);
      if (cancelled) return;
      // A backdrop that is gone, such as one removed in another window, shows nothing.
      if (!backdrop) {
        shownVersion = null;
        showCustom(null);
        return;
      }
      const loaded = `${id}\0${backdrop.createdAt}`;
      if (backdrop.kind === "image") {
        const url = await dataUrl(backdrop);
        if (cancelled) return;
        shownVersion = loaded;
        showCustom({ source: { kind: "image", url }, name: backdrop.name, bubbles: null });
        return;
      }
      const html = await backdrop.blob.text();
      if (cancelled) return;
      const bubbles = chatBackdropBubbles(html);
      if (props.pages === "srcdoc") {
        shownVersion = loaded;
        showCustom({ source: { kind: "page", html }, name: backdrop.name, bubbles });
        return;
      }
      const src = await conversationPort().agent.addPreviewPage(html);
      if (cancelled) {
        releaseFilePreviewPage(src ?? undefined);
        return;
      }
      shownVersion = src === null ? null : loaded;
      if (src === null) showCustom(null);
      else showCustom({ source: { kind: "page", src }, name: backdrop.name, bubbles }, src);
    };
    show().catch(() => {
      if (cancelled) return;
      shownVersion = null;
      showCustom(null);
    });
    return () => {
      cancelled = true;
    };
  });

  createEffect(
    () => scene() !== null || custom() !== null,
    (active) => {
      if (!active) return;
      setWindowGlass("backdrop", true);
      hideChatBackgroundForBackdrop(true);
      return () => {
        setWindowGlass("backdrop", false);
        hideChatBackgroundForBackdrop(false);
      };
    },
  );
  createEffect(
    () => (scene() === null ? (custom()?.bubbles ?? null) : null),
    (bubbles) => {
      setShownBackdropBubbles(bubbles);
      return () => setShownBackdropBubbles(null);
    },
  );
  return (
    <Show
      when={scene()}
      fallback={
        <Show when={custom()}>{(current) => <CustomBackdrop source={current().source} title={current().name} />}</Show>
      }
    >
      {(current) => <ChatBackdrop scene={current()} />}
    </Show>
  );
}
