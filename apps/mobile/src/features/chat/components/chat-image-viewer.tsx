import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import { createContext, type PropsWithChildren, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AnimatedRef,
  type SharedValue,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { haptics } from "@/shared/lib/haptics";
import { useAttachmentFile } from "./attachment-preview";
import { ImageViewer, type ImageViewerPage } from "./image-viewer";

/** An image the chat can show itself: one that is on the host and small enough to download. */
export function isViewableImage(attachment: AttachmentSummary) {
  return (
    attachment.kind === "image" &&
    attachment.size <= MOBILE_ATTACHMENT_BYTES &&
    !attachment.id.startsWith("mobile-draft-attachment-")
  );
}

interface ImageSource {
  origin: AnimatedRef;
  originRadius: number;
}

interface ChatImageViewerValue {
  /** The id of the image whose chat copy the viewer holds, or null. */
  hiddenSource: SharedValue<string | null>;
  register: (id: string, source: ImageSource) => () => void;
  open: (attachment: AttachmentSummary) => void;
}

const ChatImageViewerContext = createContext<ChatImageViewerValue | null>(null);

/**
 * One viewer for the whole conversation. A tap on any image opens it, and a swipe steps through
 * every image of the loaded messages, in chat order. Images in rows the list has not drawn
 * download when the reader reaches them, and put themselves away with a fade instead of a flight.
 */
export function ChatImageViewerProvider({
  serverId,
  images,
  children,
}: PropsWithChildren<{ serverId: string; images: readonly AttachmentSummary[] }>) {
  const hiddenSource = useSharedValue<string | null>(null);
  const sources = useRef(new Map<string, ImageSource>());
  const latestImages = useRef(images);
  latestImages.current = images;
  // The pages are fixed when the viewer opens, so a message that arrives behind it does not
  // renumber the pages under the reader.
  const [viewing, setViewing] = useState<{ pages: ImageViewerPage[]; index: number } | null>(null);

  const register = useCallback((id: string, source: ImageSource) => {
    sources.current.set(id, source);
    return () => {
      if (sources.current.get(id) === source) sources.current.delete(id);
    };
  }, []);

  const open = useCallback((attachment: AttachmentSummary) => {
    const list = latestImages.current.some((image) => image.id === attachment.id) ? latestImages.current : [attachment];
    const pages = list.map((image): ImageViewerPage => {
      const source = sources.current.get(image.id);
      return {
        key: image.id,
        attachment: image,
        origin: source?.origin ?? null,
        originRadius: source?.originRadius ?? 0,
      };
    });
    void haptics.impact("soft");
    setViewing({
      pages,
      index: Math.max(
        0,
        pages.findIndex((page) => page.key === attachment.id),
      ),
    });
  }, []);

  const value = useMemo(() => ({ hiddenSource, register, open }), [hiddenSource, register, open]);
  return (
    <ChatImageViewerContext value={value}>
      {children}
      {viewing ? (
        <ConversationImageViewer
          serverId={serverId}
          pages={viewing.pages}
          initialIndex={viewing.index}
          hiddenSource={hiddenSource}
          onDismissed={() => setViewing(null)}
        />
      ) : null}
    </ChatImageViewerContext>
  );
}

/** The viewer, with the share and save actions of the image on screen. */
function ConversationImageViewer({
  serverId,
  pages,
  initialIndex,
  hiddenSource,
  onDismissed,
}: {
  serverId: string;
  pages: ImageViewerPage[];
  initialIndex: number;
  hiddenSource: SharedValue<string | null>;
  onDismissed: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const page = pages[index] ?? pages[initialIndex];
  // The same query as the image in the chat, so the image on screen is not downloaded again.
  const file = useAttachmentFile(serverId, page?.attachment ?? PLACEHOLDER, Boolean(page));
  return (
    <ImageViewer
      serverId={serverId}
      pages={pages}
      initialIndex={initialIndex}
      hiddenSource={hiddenSource}
      busy={file.busy}
      onShare={file.share}
      onSave={file.saveToPhotos}
      onIndexChange={setIndex}
      onDismissed={onDismissed}
    />
  );
}

const PLACEHOLDER: AttachmentSummary = {
  id: "image-viewer-placeholder",
  name: "Image",
  size: 0,
  kind: "image",
  mimeType: "image/png",
  previewKind: "image",
  previewUrl: null,
};

/**
 * Connects an image in the chat to the conversation's viewer: the ref the viewer measures for
 * its flight, the style that hides this copy while the viewer holds the picture, and the tap.
 */
export function useChatImageSource(id: string | null, originRadius: number) {
  const viewer = use(ChatImageViewerContext);
  const origin = useAnimatedRef();
  const fallback = useSharedValue<string | null>(null);
  const hiddenSource = viewer?.hiddenSource ?? fallback;
  const hiddenStyle = useAnimatedStyle(() => ({ opacity: id !== null && hiddenSource.get() === id ? 0 : 1 }));
  const register = viewer?.register;
  useEffect(
    () => (id && register ? register(id, { origin, originRadius }) : undefined),
    [id, register, origin, originRadius],
  );
  return { origin, hiddenStyle, open: viewer?.open };
}
