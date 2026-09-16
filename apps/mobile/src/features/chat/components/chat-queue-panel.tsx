import { MenuView } from "@expo/ui/community/menu";
import type { AttachmentSummary, QueueDelivery } from "@openbot/contracts/ipc";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { skipToken, useQuery } from "@tanstack/react-query";
import { GlassView } from "expo-glass-effect";
import { Image } from "expo-image";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ChevronDown, CornerDownRight, FileText, ImageIcon, ListOrdered, Pencil, Trash2, X } from "lucide-react-native";
import { memo, useMemo, useState } from "react";
import { FlatList, useWindowDimensions, View, type ViewStyle } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import type { PendingChatMessage } from "../model/chat-messages";
import type { ChatQueueController } from "./use-chat-queue";

const queueDuration = 240;

// Queue previews use only host-generated inline thumbnails. Opening a chat image owns
// full-file downloads; expanding a queue must never start attachment-sized transfers.
const AttachmentStack = memo(function AttachmentStack({
  attachments,
  serverId,
}: {
  attachments: AttachmentSummary[];
  serverId: string;
}) {
  const [muted, background] = useThemeColor(["muted", "default"]);
  const visibleAttachments = attachments.slice(0, 3);
  const stackSize = 28 + Math.max(0, visibleAttachments.length - 1) * 3;
  return (
    <View style={{ width: 34, height: 36 }} accessibilityLabel={attachments.map((file) => file.name).join(", ")}>
      {visibleAttachments.map((file, index) => (
        <View
          key={file.id}
          style={{
            position: "absolute",
            left: (34 - stackSize) / 2 + index * 3,
            top: (36 - stackSize) / 2 + index * 3,
            width: 28,
            height: 28,
            borderRadius: 6,
            backgroundColor: background,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <QueueThumbnail file={file} serverId={serverId} color={muted} />
        </View>
      ))}
    </View>
  );
});

function QueueThumbnail({ file, serverId, color }: { file: AttachmentSummary; serverId: string; color: string }) {
  const cached = useQuery<RemoteFileUpload & { localUri?: string }>({
    queryKey: ["chat-attachment", serverId, file.id],
    queryFn: skipToken,
  });
  const { loadAttachmentThumbnail } = useMobileWorkspace();
  const [failed, setFailed] = useState(false);
  const thumbnail = useQuery({
    queryKey: ["queue-thumbnail", serverId, file.id],
    queryFn: () => loadAttachmentThumbnail(serverId, file.id),
    enabled: !cached.data?.localUri,
    retry: false,
    staleTime: Infinity,
  });
  const uri =
    file.previewUrl?.startsWith("data:image/") && file.previewUrl.length < 64_000
      ? file.previewUrl
      : (cached.data?.localUri ?? thumbnail.data);
  return uri && !failed ? (
    <Image
      source={uri}
      accessibilityLabel={file.name}
      contentFit="cover"
      recyclingKey={file.id}
      onError={() => setFailed(true)}
      style={{ width: 28, height: 28, borderRadius: 6 }}
    />
  ) : file.kind === "image" ? (
    <ImageIcon size={18} color={color} />
  ) : (
    <FileText size={18} color={color} />
  );
}

function QueueMessagePreview({
  item,
  canMove,
  moveFirst,
}: {
  item: QueueDelivery;
  canMove: boolean;
  moveFirst: ChatQueueController["moveFirst"];
}) {
  const [width, setWidth] = useState(0);
  const preview = item.text || item.attachments.map((file) => file.name).join(", ");
  return (
    <View className="min-w-0 flex-1" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <MenuView
        shouldOpenOnLongPress
        actions={[
          {
            id: "first",
            title: "Move to first",
            image: "arrow.up.to.line",
            attributes: { disabled: !canMove },
          },
        ]}
        onPressAction={({ nativeEvent }) => {
          if (nativeEvent.event === "first" && canMove) void moveFirst(item);
        }}
      >
        {/* The native menu measures its child outside the row's Yoga layout.
            Supply the available width; keep height intrinsic so text cannot collapse. */}
        <View
          style={{ width }}
          accessible
          accessibilityLabel={`Message ${item.position}: ${preview}`}
          accessibilityActions={canMove ? [{ name: "moveFirst", label: "Move to first" }] : []}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "moveFirst" && canMove) void moveFirst(item);
          }}
        >
          <Typography numberOfLines={2}>{preview}</Typography>
        </View>
      </MenuView>
    </View>
  );
}

interface QueuePanelProps {
  queue: ChatQueueController;
  pending?: { message: PendingChatMessage["message"]; progress: number; total: number; cancel: () => void };
  liquidGlassAvailable: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
  disabled?: boolean;
}

export const ChatQueuePanel = memo(function ChatQueuePanel({
  queue,
  pending,
  liquidGlassAvailable,
  fallbackBackground,
  disabled = false,
}: QueuePanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [listHeight, setListHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const reducedMotion = useReducedMotion();
  const [muted] = useThemeColor(["muted"]);
  const { height, fontScale } = useWindowDimensions();
  const visible = useMemo(
    () => queue.queued.filter((item) => item.id !== queue.edit?.delivery.id),
    [queue.queued, queue.edit?.delivery.id],
  );
  const open = expanded || visible.length === 1;
  const locked = queue.busy || !queue.online || disabled;
  const maxHeight = Math.min(240 * Math.min(fontScale, 1.5), height * 0.28);
  if (!visible.length && !pending && !queue.edit && !queue.loading) return null;
  function row({ item }: { item: QueueDelivery }) {
    return (
      <View className="flex-row items-center gap-1 px-3 py-1">
        <Typography className="w-5 text-muted">{item.position}</Typography>
        {item.attachments.length ? <AttachmentStack attachments={item.attachments} serverId={queue.serverId} /> : null}
        <QueueMessagePreview
          item={item}
          canMove={!locked && !queue.edit && item.position !== 1}
          moveFirst={queue.moveFirst}
        />
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          style={{ minWidth: 44, minHeight: 44 }}
          isDisabled={locked || !queue.activeTurnId || Boolean(queue.edit)}
          accessibilityLabel={`Steer message ${item.position}`}
          onPress={() => void queue.steer(item)}
        >
          <CornerDownRight size={20} color={muted} />
        </Button>
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          style={{ minWidth: 44, minHeight: 44 }}
          isDisabled={locked || !queue.canEdit || Boolean(queue.edit)}
          accessibilityLabel={`Edit message ${item.position}`}
          onPress={() => void queue.begin(item)}
        >
          <Pencil size={20} color={muted} />
        </Button>
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          style={{ minWidth: 44, minHeight: 44 }}
          isDisabled={locked}
          accessibilityLabel={`Delete message ${item.position}`}
          onPress={() => void queue.remove(item)}
        >
          <Trash2 size={20} color={muted} />
        </Button>
      </View>
    );
  }
  const panelHeight = headerHeight + footerHeight + (open ? Math.min(listHeight, maxHeight) : 0);
  return (
    <View className="mx-3 mb-2" style={{ height: panelHeight }}>
      {/* The spacer updates chat insets once. Only this bottom-anchored surface animates,
          so it cannot move into the composer or trigger chat layout work on every frame. */}
      <Animated.View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: panelHeight,
          overflow: "hidden",
          borderRadius: 24,
          transitionProperty: "height",
          transitionDuration: reducedMotion ? 0 : queueDuration,
          transitionTimingFunction: cubicBezier(0.32, 0.72, 0, 1),
        }}
      >
        <GlassView
          glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
          style={{
            backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
            flex: 1,
            borderRadius: 24,
            borderCurve: "continuous",
            overflow: "hidden",
          }}
        >
          <View
            style={{ position: "absolute", top: 0, left: 0, right: 0 }}
            onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
          >
            <Button
              variant="ghost"
              className="flex-row justify-start gap-2 px-4"
              isDisabled={visible.length < 2}
              accessibilityLabel={`${visible.length + (pending ? 1 : 0)} queued messages`}
              accessibilityState={{ expanded: open }}
              onPress={() => setExpanded((value) => !value)}
            >
              <ListOrdered size={18} color={muted} />
              <Typography className="flex-1 text-muted">Up next</Typography>
              <Typography className="text-muted">{visible.length + (pending ? 1 : 0)} queued</Typography>
              {visible.length > 1 ? (
                <Animated.View
                  style={{
                    transform: [{ rotate: open ? "180deg" : "0deg" }],
                    transitionProperty: "transform",
                    transitionDuration: reducedMotion ? 0 : queueDuration,
                    transitionTimingFunction: cubicBezier(0.32, 0.72, 0, 1),
                  }}
                >
                  <ChevronDown size={18} color={muted} />
                </Animated.View>
              ) : null}
            </Button>
          </View>
          <View
            style={{
              position: "absolute",
              top: headerHeight,
              bottom: footerHeight,
              left: 0,
              right: 0,
              overflow: "hidden",
            }}
            pointerEvents={open ? "auto" : "none"}
            accessibilityElementsHidden={!open}
            importantForAccessibility={open ? "auto" : "no-hide-descendants"}
          >
            {/* Keep the measured list outside the animated height constraint. This preserves
              its viewport, native menus and scroll position while the clipping area closes. */}
            <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: maxHeight }}>
              <FlatList
                data={visible}
                keyExtractor={(item) => item.id}
                renderItem={row}
                style={{ height: maxHeight }}
                onContentSizeChange={(_width, contentHeight) => setListHeight(contentHeight)}
                initialNumToRender={3}
                maxToRenderPerBatch={3}
                windowSize={3}
                keyboardShouldPersistTaps="handled"
              />
            </View>
          </View>
          <View
            style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
            onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
          >
            {pending ? (
              <View className="flex-row items-center gap-2 px-4 pb-2">
                <Typography numberOfLines={2} className="flex-1 text-muted">
                  {pending.total ? `Uploading ${pending.progress}/${pending.total}` : "Adding to queue…"}:{" "}
                  {pending.message.body || pending.message.attachments?.map((file) => file.name).join(", ")}
                </Typography>
                {pending.progress < pending.total ? (
                  <Button isIconOnly variant="ghost" accessibilityLabel="Cancel queued upload" onPress={pending.cancel}>
                    <X size={18} color={muted} />
                  </Button>
                ) : null}
              </View>
            ) : null}
            {queue.edit ? (
              <View className="gap-1 px-4 pb-2">
                {queue.editUnavailable ? (
                  <View className="flex-row items-center">
                    <Typography className="flex-1 text-muted">This message is no longer queued</Typography>
                    <Button variant="ghost" isDisabled={locked} onPress={() => void queue.discardFinishedEdit()}>
                      <Button.Label>Close edit</Button.Label>
                    </Button>
                  </View>
                ) : (
                  <>
                    <View className="flex-row items-center">
                      <Typography className="flex-1 text-muted">
                        {queue.confirmed ? "Editing queued message" : "Confirm edit to continue"}
                      </Typography>
                      <Button
                        isIconOnly
                        variant="ghost"
                        isDisabled={locked}
                        accessibilityLabel="Cancel queue edit"
                        onPress={() => void queue.cancelEdit()}
                      >
                        <X size={18} color={muted} />
                      </Button>
                    </View>
                    {!queue.confirmed ? (
                      <Button
                        variant="secondary"
                        isDisabled={locked}
                        onPress={() => queue.edit && void queue.begin(queue.edit.delivery)}
                      >
                        <Button.Label>Resume edit</Button.Label>
                      </Button>
                    ) : null}
                    {queue.edit.delivery.attachments
                      .filter((file) => queue.edit?.keepAttachmentIds.includes(file.id))
                      .map((file) => (
                        <View key={file.id} className="flex-row items-center gap-2">
                          <FileText size={16} color={muted} />
                          <Typography numberOfLines={1} className="flex-1 text-muted">
                            {file.name}
                          </Typography>
                          <Button
                            isIconOnly
                            variant="ghost"
                            isDisabled={locked}
                            accessibilityLabel={`Remove ${file.name} from edit`}
                            onPress={() => queue.removeAttachment(file.id)}
                          >
                            <X size={16} color={muted} />
                          </Button>
                        </View>
                      ))}
                    {queue.progress !== null ? (
                      <Button variant="ghost" onPress={queue.cancelUpload}>
                        <Button.Label>Cancel upload ({queue.progress} uploaded)</Button.Label>
                      </Button>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}
            {queue.loading ? <Typography className="px-4 pb-2 text-muted">Loading queue…</Typography> : null}
          </View>
        </GlassView>
      </Animated.View>
    </View>
  );
});
