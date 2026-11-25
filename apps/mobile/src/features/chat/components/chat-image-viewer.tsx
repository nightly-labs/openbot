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
import { savesToPhotos, showsAsImage, useAttachmentFile } from "./attachment-preview";
import { ImageViewer, type ImageViewerPage } from "./image-viewer";

export function isViewableImage(attachment: AttachmentSummary) {
  return isStackImage(attachment) && !attachment.id.startsWith("mobile-draft-attachment-");
}

export function isStackImage(attachment: AttachmentSummary) {
  return showsAsImage(attachment) && attachment.size <= MOBILE_ATTACHMENT_BYTES;
}

interface ImageSource {
  origin: AnimatedRef;
  originRadius: number;
}

interface ChatImageViewerValue {
  hiddenSource: SharedValue<string | null>;
  register: (id: string, source: ImageSource) => () => void;
  open: (attachment: AttachmentSummary) => void;
}

const ChatImageViewerContext = createContext<ChatImageViewerValue | null>(null);

export function ChatImageViewerProvider({
  serverId,
  images,
  children,
}: PropsWithChildren<{ serverId: string; images: readonly AttachmentSummary[] }>) {
  const hiddenSource = useSharedValue<string | null>(null);
  const sources = useRef(new Map<string, ImageSource>());
  const latestImages = useRef(images);
  latestImages.current = images;
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
  const file = useAttachmentFile(serverId, page?.attachment ?? PLACEHOLDER, Boolean(page), true);
  return (
    <ImageViewer
      serverId={serverId}
      pages={pages}
      initialIndex={initialIndex}
      hiddenSource={hiddenSource}
      busy={file.busy}
      onShare={file.share}
      onCopy={page && savesToPhotos(page.attachment) ? file.copyImage : undefined}
      onSave={page && savesToPhotos(page.attachment) ? file.saveToPhotos : undefined}
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
  return { origin, hiddenStyle, hiddenSource, open: viewer?.open };
}
