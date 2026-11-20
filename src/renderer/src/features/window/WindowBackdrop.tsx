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

function dataUrl(backdrop: SavedBackdrop): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(reader.error));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(backdrop.blob);
  });
}

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
  const customVersion = () => {
    const id = customId();
    if (id === null) return null;
    return `${id}\0${saved().find((backdrop) => backdrop.id === id)?.createdAt ?? ""}`;
  };
  type ShownBackdrop = { source: CustomBackdropSource; name: string; bubbles: ChatBackdropBubbles | null };
  const [custom, setCustom] = createSignal<ShownBackdrop | null>(null);

  let shownPage: string | undefined;
  const showCustom = (next: ShownBackdrop | null, page?: string) => {
    setCustom(next);
    const old = shownPage;
    shownPage = page;
    if (old !== page) releaseFilePreviewPage(old);
  };
  onCleanup(() => releaseFilePreviewPage(shownPage));
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
