import { playableMediaKind } from "@openbot/contracts/attachment-files";
import {
  CHAT_VISUAL_DEFAULT_HEIGHT,
  CHAT_VISUAL_PAGE_LIMIT,
  chatVisualFrameHeight,
  isChatVisualMimeType,
} from "@openbot/contracts/chat-visual";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { requireOptionalNativeModule } from "expo";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { Button, Skeleton, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Download from "lucide-react-native/icons/download";
import ExternalLink from "lucide-react-native/icons/external-link";
import ImageOff from "lucide-react-native/icons/image-off";
import { useEffect, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { useChatNavigation } from "@/features/chat/context/chat-navigation-context";
import { useFullVisualPreference } from "@/features/settings/model/visual-preview";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { attachmentFrame, FILL, FRAME_RADIUS, MAX_FRAME_WIDTH } from "../model/attachment-frame";
import { storeCodePreview } from "../model/code-preview-store";
import { type ImageDimensions, sameShape } from "../model/image-dimensions";
import { fileLimitText, MOBILE_LARGE_FILE_BYTES, useAttachmentDownload } from "../model/large-files";
import { attachmentTypeLabel, rememberImageDimensions, showsAsImage, useAttachmentFile } from "./attachment-preview";
import { ChatCodePreview } from "./chat-code-preview";
import { useChatImageSource } from "./chat-image-viewer";
import { HtmlPage } from "./html-page";
import { UPLOAD_BLUR_RADIUS, UploadProgressCircle, useUploadReveal } from "./upload-progress";
import { useAttachmentPreview } from "./use-attachment-preview";
import { useHistoryShown } from "./use-history-shown";
import { useListSettled } from "./use-list-settled";
import { useMediaFile } from "./use-media-file";

const reportedVisualHeights = new Map<string, number>();

const UNKNOWN_RATIO = 3 / 4;

const chatVideo: typeof import("./chat-video.native") | null = requireOptionalNativeModule("ExpoVideo")
  ? require("./chat-video.native")
  : null;
const chatAudio: typeof import("./chat-audio.native") | null = chatVideo ? require("./chat-audio.native") : null;

interface ChatAttachmentProps {
  attachment: AttachmentSummary;
  serverId: string;
  alignment?: "left" | "right";
  upload?: number;
  tint?: AttachmentTint;
  visual?: { height?: number } | undefined;
  videoRatio?: number;
}

export interface AttachmentTint {
  color: string;
  foreground: string;
}

export function ChatAttachmentView(props: ChatAttachmentProps) {
  const { attachment } = props;
  const { download } = useAttachmentDownload(props.serverId, attachment);
  const kind = playableMediaKind(attachment.mimeType);
  const playable =
    props.upload === undefined && download === "download" && !attachment.id.startsWith("mobile-draft-attachment-");
  const media = playable ? kind : null;
  if (chatVideo && media === "video")
    return <chatVideo.ChatVideoAttachment {...props} unknownRatio={props.videoRatio} />;
  if (chatAudio && media === "audio") return <chatAudio.ChatAudioAttachment {...props} />;
  if (
    props.visual &&
    playable &&
    isChatVisualMimeType(attachment.mimeType) &&
    attachment.size <= CHAT_VISUAL_PAGE_LIMIT
  )
    return <ChatVisualAttachment {...props} />;
  return (
    <ChatFileAttachment
      {...props}
      playsAfterDownload={Boolean((chatVideo && kind === "video") || (chatAudio && kind === "audio"))}
    />
  );
}

function ChatVisualAttachment(props: ChatAttachmentProps) {
  const { attachment, serverId } = props;
  const { t } = useText();
  const navigation = useChatNavigation();
  const { width } = useWindowDimensions();
  const settled = useListSettled();
  const historyShown = useHistoryShown();
  const full = useFullVisualPreference((state) => state.enabled);
  const [reported, setReported] = useState(() => reportedVisualHeights.get(attachment.id));
  const report = (height: number) => {
    reportedVisualHeights.set(attachment.id, height);
    setReported(height);
  };
  const pageHeight = full
    ? chatVisualFrameHeight(reported ?? props.visual?.height)
    : chatVisualFrameHeight(reported, props.visual?.height ?? CHAT_VISUAL_DEFAULT_HEIGHT);
  const cut = reported !== undefined && Math.ceil(reported) > pageHeight;
  const file = useMediaFile(serverId, attachment, true);
  const [page, setPage] = useState<{ uri: string; source: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const uri = file.data;
    if (!uri) return;
    let active = true;
    new File(uri)
      .text()
      .then((source) => {
        if (active) setPage({ uri, source });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [file.data]);
  if (failed || file.error) return <ChatFileAttachment {...props} />;
  if (!page)
    return (
      <Skeleton
        isLoading
        accessible
        accessibilityLabel={t("mobile.chat.attachment.downloading")}
        style={{ width: width - 80, height: HtmlPage ? pageHeight : (width - 80) / 2 + 42, borderRadius: 18 }}
      />
    );
  if (HtmlPage)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.chat.attachment.preview", { name: attachment.name })}
        accessibilityHint={cut ? t("mobile.chat.attachment.seeAll") : undefined}
        style={{
          width: width - 80,
          maxWidth: "100%",
          height: pageHeight,
          borderBottomLeftRadius: FRAME_RADIUS,
          borderBottomRightRadius: FRAME_RADIUS,
          overflow: "hidden",
        }}
        onPress={() => {
          void haptics.impact("soft");
          const local = { uri: page.uri, name: attachment.name, mimeType: attachment.mimeType };
          const previewId = storeCodePreview({ kind: "html", source: page.source, language: "html", file: local });
          navigation.push({ pathname: "/code-preview/[previewId]", params: { previewId } });
        }}
      >
        <View pointerEvents="none" style={FILL}>
          {settled && historyShown ? (
            <HtmlPage source={page.source} title={attachment.name} mode="chat" onHeight={report} />
          ) : null}
        </View>
        {cut ? (
          <View pointerEvents="none" className="absolute inset-x-0 bottom-2.5 items-center">
            <View className="rounded-full bg-background/70 px-2.5 py-1">
              <Typography.Paragraph type="body-xs" className="font-semibold text-foreground">
                {t("mobile.chat.attachment.seeAll")}
              </Typography.Paragraph>
            </View>
          </View>
        ) : null}
      </Pressable>
    );
  return (
    <ChatCodePreview
      kind="html"
      text={page.source}
      language="html"
      file={{ uri: page.uri, name: attachment.name, mimeType: attachment.mimeType }}
    />
  );
}

function ChatFileAttachment({
  attachment,
  serverId,
  alignment = "left",
  upload,
  playsAfterDownload = false,
}: ChatAttachmentProps & {
  playsAfterDownload?: boolean;
}) {
  const text = useText();
  const { t, format, sourceText } = text;
  const [fileColor, muted] = useThemeColor(["success", "muted"]);
  const [decoded, setDecoded] = useState<ImageDimensions | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const { shownUpload, revealStyle } = useUploadReveal(upload);
  const { width } = useWindowDimensions();
  const { download, request } = useAttachmentDownload(serverId, attachment);
  const tooLarge = download === "desktop";
  const ask = download === "ask";
  const image = showsAsImage(attachment) && download === "download";
  const { pending, localUri, uri, dimensions, query, sharing, share } = useAttachmentFile(serverId, attachment, image);
  const viewable = image && !attachment.id.startsWith("mobile-draft-attachment-");
  const source = useChatImageSource(viewable ? attachment.id : null, FRAME_RADIUS);
  const maxWidth = Math.min(MAX_FRAME_WIDTH, width - 80);
  const shape = decoded ?? dimensions;
  const frame = attachmentFrame(shape, maxWidth, UNKNOWN_RATIO);
  const failed = Boolean(query.error) || imageFailed;
  const preview = useAttachmentPreview(serverId, attachment);
  const previewable = preview.kind !== null;
  const busy = sharing || query.isFetching || preview.opening;

  if (image)
    return (
      <View className={`max-w-full gap-2 ${alignment === "right" ? "items-end" : "items-start"}`}>
        <View
          style={{
            width: frame.width,
            height: frame.height,
            maxWidth: "100%",
            borderRadius: FRAME_RADIUS,
            borderCurve: "continuous",
            overflow: "hidden",
          }}
        >
          <Animated.View ref={source.origin} collapsable={false} style={[FILL, source.hiddenStyle]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.chat.attachment.preview", { name: attachment.name })}
              accessibilityState={{ disabled: pending || !uri || failed }}
              disabled={pending || !uri || failed}
              onPress={() => source.open?.(attachment)}
              style={FILL}
            >
              {failed ? (
                <View className="items-center justify-center gap-2 p-3" style={FILL}>
                  <ImageOff size={24} color={String(muted)} />
                  <Typography.Paragraph type="body-xs" align="center" className="text-muted">
                    {query.error ? sourceText(query.error.message) : t("mobile.chat.attachment.displayFailed")}
                  </Typography.Paragraph>
                </View>
              ) : (
                <>
                  <Skeleton
                    isLoading={!imageLoaded}
                    accessible
                    accessibilityLabel={t("mobile.chat.attachment.loadingImage")}
                    className="rounded-none"
                    style={FILL}
                  />
                  {shownUpload !== undefined && uri ? (
                    <Image
                      source={uri}
                      blurRadius={UPLOAD_BLUR_RADIUS}
                      transition={0}
                      contentFit="contain"
                      accessible={false}
                      style={FILL}
                    />
                  ) : null}
                  <Animated.View style={[FILL, revealStyle]}>
                    <Image
                      source={uri}
                      transition={localUri ? 0 : 220}
                      contentFit="contain"
                      accessibilityLabel={attachment.name}
                      style={FILL}
                      onLoad={({ source }) => {
                        setImageLoaded(true);
                        if (source.width <= 0 || source.height <= 0) return;
                        const size = { width: source.width, height: source.height };
                        if (dimensions && sameShape(dimensions, size)) return;
                        rememberImageDimensions(attachment.id, size);
                        setDecoded(size);
                      }}
                      onError={() => setImageFailed(true)}
                    />
                  </Animated.View>
                </>
              )}
            </Pressable>
          </Animated.View>
          {upload !== undefined ? (
            <View
              pointerEvents="none"
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={t("mobile.chat.attachment.uploading", { name: attachment.name })}
              accessibilityValue={{ min: 0, max: 100, now: Math.round(upload * 100) }}
              style={FILL}
            />
          ) : null}
        </View>
        {failed ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => {
              setImageFailed(false);
              void query.refetch();
            }}
          >
            <Button.Label>{t("mobile.chat.attachment.retryImage")}</Button.Label>
          </Button>
        ) : null}
      </View>
    );

  const typeLabel = attachmentTypeLabel(attachment.name, attachment.mimeType, t);
  const detail = tooLarge
    ? t("mobile.chat.attachment.openOnDesktopDetail", { size: format.fileSize(attachment.size) })
    : ask && !busy
      ? t("mobile.chat.attachment.downloadLargeDetail", { size: format.fileSize(attachment.size) })
      : upload !== undefined
        ? t("mobile.chat.attachment.uploadingPercent", { percent: format.percent(upload) })
        : busy
          ? t("mobile.chat.attachment.downloading")
          : `${typeLabel} · ${format.fileSize(attachment.size)}`;
  return (
    <View className={`max-w-full ${alignment === "right" ? "items-end" : "items-start"}`}>
      <Button
        variant="secondary"
        className="h-auto flex-row justify-start gap-3 rounded-2xl border border-border bg-control p-3"
        style={{ width: maxWidth, maxWidth: "100%" }}
        isDisabled={pending || busy || tooLarge}
        accessibilityLabel={
          previewable
            ? t("mobile.chat.attachment.preview", { name: attachment.name })
            : t("mobile.chat.attachment.openOrSave", { name: attachment.name })
        }
        accessibilityHint={
          tooLarge
            ? t("mobile.chat.attachment.tooLargeHint", { limit: fileLimitText(text, MOBILE_LARGE_FILE_BYTES) })
            : ask
              ? t("mobile.chat.attachment.downloadLargeHint")
              : undefined
        }
        accessibilityValue={upload !== undefined ? { min: 0, max: 100, now: Math.round(upload * 100) } : undefined}
        onPress={() => {
          void haptics.impact("soft");
          if (ask) {
            request();
            if (showsAsImage(attachment) || playsAfterDownload) return;
          }
          if (previewable) preview.open();
          else share();
        }}
      >
        <View className="size-11 items-center justify-center rounded-xl bg-success/15">
          <Typography.Paragraph type="body-xs" className="font-semibold" style={{ color: fileColor }}>
            {typeLabel}
          </Typography.Paragraph>
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Typography.Paragraph type="body-sm" numberOfLines={2} className="font-semibold text-foreground">
            {attachment.name}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-xs" className="text-muted">
            {detail}
          </Typography.Paragraph>
        </View>
        {shownUpload !== undefined ? (
          <UploadProgressCircle progress={shownUpload} />
        ) : ask ? (
          <Download size={18} color={muted} />
        ) : previewable ? (
          <ChevronRight size={18} color={muted} style={MIRROR_IN_RTL} />
        ) : (
          <ExternalLink size={18} color={muted} />
        )}
      </Button>
    </View>
  );
}
