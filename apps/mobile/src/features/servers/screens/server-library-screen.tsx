import { canAdministerServer, libraryFolderPath, type StoredFileRow } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import {
  FILE_TYPE_FILTER_VALUES,
  type FileType,
  type FileTypeFilter,
  fileTypeCounts,
  fileTypeOf,
  queryFiles,
} from "@openbot/team-client/stored-files";
import { router, useLocalSearchParams } from "expo-router";
import { Chip, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import FileIcon from "lucide-react-native/icons/file";
import FileCode from "lucide-react-native/icons/file-code";
import FileImage from "lucide-react-native/icons/file-image";
import FilePlay from "lucide-react-native/icons/file-play";
import FileSpreadsheet from "lucide-react-native/icons/file-spreadsheet";
import FileText from "lucide-react-native/icons/file-text";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, useWindowDimensions, View, type ViewInstance } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable, useUniwind } from "uniwind";
import { useStoredFileDelete } from "@/features/agents/components/agent-files";
import { useAttachmentFile } from "@/features/chat/components/attachment-preview";
import { ChatGalleryTile } from "@/features/chat/components/chat-image-gallery";
import { ChatImageViewerProvider, isViewableImage } from "@/features/chat/components/chat-image-viewer";
import { useAttachmentPreview } from "@/features/chat/components/use-attachment-preview";
import { LibraryPathCapsule, useLibraryCapsuleRoom } from "@/features/servers/components/library-path-capsule";
import { bentoBlocks } from "@/features/servers/model/library-bento";
import {
  canHoldFolder,
  filesOfPlace,
  fromRemovedAgent,
  resolveLibraryPlace,
  useLibraryPlace,
} from "@/features/servers/model/library-place";
import { useLibrary } from "@/features/servers/model/use-library-folders";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { AndroidBlurTarget } from "@/shared/components/android-header-blur";
import { LargeTitle, LargeTitleBar, useLargeTitleScroll } from "@/shared/components/large-title";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, longPressDelay } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const PADDING = 20;
const GAP = 6;
const TILE_MIN = 104;
const MIN_COLUMNS = 3;
const TILE_RADIUS = 10;
const LARGE_CARD_SIZE = 160;

const TYPE_LABEL = {
  all: "mobile.server.library.type.all",
  images: "mobile.server.library.type.images",
  documents: "mobile.server.library.type.documents",
  code: "mobile.server.library.type.code",
  spreadsheets: "mobile.server.library.type.spreadsheets",
  media: "mobile.server.library.type.media",
  other: "mobile.server.library.type.other",
} as const satisfies Record<FileTypeFilter, MobileTextKey>;

const TYPE_ICON: Record<FileType, LucideIcon> = {
  images: FileImage,
  documents: FileText,
  code: FileCode,
  spreadsheets: FileSpreadsheet,
  media: FilePlay,
  other: FileIcon,
};

function isLibraryPicture(file: StoredFileRow): boolean {
  return isViewableImage(file) && file.status !== "failed";
}

export function ServerLibraryScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, agents } = useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const { storage, folders, canOrganize } = useLibrary(serverId);
  const { available, query, rescan } = storage;
  const snapshot = folders.snapshot;
  const living = folders.livingAgentIds;
  const capsuleRoom = useLibraryCapsuleRoom();
  const scroll = useLargeTitleScroll();
  const insets = useSafeAreaInsets();
  const dimensions = useWindowDimensions();
  const blurTarget = useRef<ViewInstance>(null);
  const [width, setWidth] = useState(dimensions.width - insets.left - insets.right);
  const [type, setType] = useState<FileTypeFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const files = useMemo(() => (query.data?.files ?? []).filter((file) => file.status !== "missing"), [query.data]);
  const removedFilesExist = useMemo(() => files.some((file) => fromRemovedAgent(file, living)), [files, living]);
  const storedPlace = useLibraryPlace(serverId);
  const place = useMemo(
    () => resolveLibraryPlace(storedPlace, snapshot, living, removedFilesExist),
    [storedPlace, snapshot, living, removedFilesExist],
  );
  const placeFiles = useMemo(() => filesOfPlace(files, place, snapshot, living), [files, place, snapshot, living]);
  const counts = useMemo(() => fileTypeCounts(placeFiles), [placeFiles]);
  const selected = counts[type] > 0 ? type : "all";
  const shown = useMemo(
    () => queryFiles(placeFiles, { search: "", type: selected, sort: "newest" }),
    [placeFiles, selected],
  );
  const pictures = useMemo(() => shown.filter(isLibraryPicture), [shown]);

  const gridWidth = Math.max(width - PADDING * 2, 1);
  const columns = Math.max(MIN_COLUMNS, Math.floor((gridWidth + GAP) / (TILE_MIN + GAP)));
  const blocks = useMemo(
    () => bentoBlocks(shown.map(isLibraryPicture), gridWidth, columns, GAP),
    [shown, gridWidth, columns],
  );
  const canDelete = server ? canAdministerServer(server.role) : false;
  const agentName = (agentId: string | null) =>
    agentId ? agents.find((agent) => agent.id === agentId && agent.serverId === serverId)?.name : undefined;
  const folderPath = place.kind === "folder" && snapshot ? libraryFolderPath(snapshot.folders, place.folderId) : [];
  const placeAgent = place.kind === "agent" || place.kind === "folder" ? (agentName(place.agentId) ?? "") : "";
  const title =
    place.kind === "removed"
      ? t("mobile.server.library.folders.removedAgents")
      : place.kind === "agent"
        ? placeAgent
        : (folderPath.at(-1)?.name ?? t("mobile.app.route.library"));
  const caption =
    place.kind === "folder"
      ? [placeAgent, ...folderPath.slice(0, -1).map((folder) => folder.name)].join(" / ")
      : server?.name;
  const segments =
    place.kind === "all"
      ? [t("mobile.server.library.folders.allFiles")]
      : place.kind === "removed"
        ? [t("mobile.server.library.folders.removedAgents")]
        : [placeAgent, ...folderPath.map((folder) => folder.name)];
  const placeFolderId = place.kind === "folder" ? place.folderId : undefined;
  const placeAgentId = place.kind === "agent" || place.kind === "folder" ? place.agentId : null;
  const addAgentId =
    snapshot !== null && canOrganize(placeAgentId) && canHoldFolder(snapshot.folders, placeFolderId)
      ? placeAgentId
      : null;

  const knownFileIds = useMemo(() => new Set((query.data?.files ?? []).map((file) => file.id)), [query.data]);
  const rescannedRevision = useRef<number | null>(null);
  useEffect(() => {
    if (!snapshot || !query.data || query.data.truncated || rescannedRevision.current === snapshot.revision) return;
    if (!Object.keys(snapshot.placement).some((fileId) => !knownFileIds.has(fileId))) return;
    rescannedRevision.current = snapshot.revision;
    void rescan().catch(() => undefined);
  }, [snapshot, query.data, knownFileIds, rescan]);

  function refresh() {
    setRefreshing(true);
    if (snapshot) void folders.query.refetch();
    rescan()
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }
  const changed = () => void rescan().catch(() => undefined);

  const note: ReactNode = !server ? (
    <LibraryNote title={t("mobile.server.unavailable")} />
  ) : !available ? (
    <LibraryNote title={t("mobile.workspace.error.filesUnsupported")} />
  ) : !query.data ? (
    query.isError ? (
      <LibraryNote
        title={errorMessage(query.error, t("mobile.server.storage.loadFailed"))}
        action={{ label: t("mobile.server.storage.retry"), disabled: query.isFetching, onPress: refresh }}
      />
    ) : (
      <LibraryNote title={t("mobile.server.storage.measuring")} />
    )
  ) : files.length === 0 ? (
    <LibraryNote title={t("mobile.server.library.emptyTitle")} body={t("mobile.server.library.emptyBody")} />
  ) : placeFiles.length === 0 && place.kind === "folder" ? (
    <LibraryNote
      title={t("mobile.server.library.folders.emptyTitle")}
      body={t("mobile.server.library.folders.emptyBody", {
        agent: placeAgent,
        path: folderPath.map((folder) => folder.name).join("/"),
      })}
    />
  ) : shown.length === 0 ? (
    <LibraryNote title={t("mobile.server.library.noMatches")} />
  ) : null;

  return (
    <ChatImageViewerProvider serverId={serverId} images={pictures}>
      <View
        className="flex-1 bg-sheet"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width - insets.left - insets.right)}
      >
        <AndroidBlurTarget target={blurTarget} surface="sheet">
          <Animated.FlatList
            className="flex-1"
            style={{ marginLeft: insets.left, marginRight: insets.right }}
            alwaysBounceVertical={false}
            contentInsetAdjustmentBehavior={scroll.ownsInset ? "never" : "always"}
            contentContainerClassName="pb-safe-offset-5"
            contentContainerStyle={{
              ...(scroll.ownsInset ? { paddingTop: scroll.headerHeight } : null),
              ...(snapshot ? { paddingBottom: capsuleRoom } : null),
            }}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={false}
            onScroll={scroll.onScroll}
            refreshControl={
              available && query.data ? (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={refresh}
                  progressViewOffset={scroll.ownsInset ? scroll.headerHeight : 0}
                />
              ) : undefined
            }
            data={note ? [] : blocks}
            keyExtractor={(block, index) => shown[block.tiles[0]?.index ?? -1]?.id ?? String(index)}
            renderItem={({ item: block }) => (
              <View style={{ height: block.height, marginHorizontal: PADDING, marginBottom: GAP }}>
                {block.tiles.map((tile) => {
                  const file = shown[tile.index];
                  return file ? (
                    <View
                      key={file.id}
                      style={{
                        position: "absolute",
                        left: tile.left,
                        top: tile.top,
                        width: tile.width,
                        height: tile.height,
                      }}
                    >
                      <LibraryTile
                        file={file}
                        serverId={serverId}
                        width={tile.width}
                        height={tile.height}
                        canDelete={canDelete && file.deletable}
                        source={file.conversation?.title ?? agentName(file.agentId)}
                        canMove={snapshot !== null && canOrganize(file.agentId)}
                        onChanged={changed}
                      />
                    </View>
                  ) : null;
                })}
              </View>
            )}
            ListHeaderComponent={
              <>
                <LargeTitle scroll={scroll} title={title} caption={caption} />
                {files.length > 0 ? <TypeFilters counts={counts} value={selected} onChange={setType} /> : null}
                {note}
              </>
            }
            ListFooterComponent={
              query.data?.truncated ? (
                <Typography.Paragraph className="px-5 pt-3 text-muted" style={typeScale.caption}>
                  {t("mobile.agent.files.truncated")}
                </Typography.Paragraph>
              ) : undefined
            }
          />
        </AndroidBlurTarget>
        <LargeTitleBar scroll={scroll} title={title} surface="sheet" blurTarget={blurTarget} />
        {snapshot && query.data ? (
          <LibraryPathCapsule
            segments={segments}
            onOpen={() => router.push({ pathname: "/library-folders", params: { serverId } })}
            onAdd={
              addAgentId
                ? () =>
                    router.push({
                      pathname: "/library-folders/name",
                      params: { serverId, agentId: addAgentId, ...(placeFolderId ? { parentId: placeFolderId } : {}) },
                    })
                : undefined
            }
          />
        ) : null}
      </View>
    </ChatImageViewerProvider>
  );
}

function TypeFilters({
  counts,
  value,
  onChange,
}: {
  counts: Record<FileTypeFilter, number>;
  value: FileTypeFilter;
  onChange: (type: FileTypeFilter) => void;
}) {
  const { t, format } = useText();
  const [foreground, background] = useThemeColor(["foreground", "background"]);
  const types = FILE_TYPE_FILTER_VALUES.filter((type) => type === "all" || counts[type] > 0);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t("mobile.server.library.fileType")}
      contentContainerClassName="gap-2 px-5 pb-3"
    >
      {types.map((type) => {
        const active = type === value;
        return (
          <Chip
            key={type}
            size="md"
            variant="secondary"
            color="default"
            style={active ? { backgroundColor: String(foreground) } : undefined}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              void haptics.selection();
              onChange(type);
            }}
          >
            <Chip.Label style={active ? { color: String(background) } : undefined}>{t(TYPE_LABEL[type])}</Chip.Label>
            <Chip.Label className="opacity-60" style={active ? { color: String(background) } : undefined}>
              {format.number(counts[type])}
            </Chip.Label>
          </Chip>
        );
      })}
    </ScrollView>
  );
}

function LibraryNote({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { label: string; disabled: boolean; onPress: () => void };
}) {
  return (
    <View className="gap-1 px-5 py-4">
      <Typography.Paragraph className="text-muted" style={typeScale.preview}>
        {title}
      </Typography.Paragraph>
      {body ? (
        <Typography.Paragraph className="text-muted" style={typeScale.caption}>
          {body}
        </Typography.Paragraph>
      ) : null}
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: action.disabled }}
          disabled={action.disabled}
          className="self-start py-2"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          onPress={action.onPress}
        >
          <Typography.Paragraph className="font-medium text-accent-text" style={typeScale.preview}>
            {action.label}
          </Typography.Paragraph>
        </Pressable>
      ) : null}
    </View>
  );
}

function LibraryTile({
  file,
  serverId,
  width,
  height,
  canDelete,
  canMove,
  source,
  onChanged,
}: {
  file: StoredFileRow;
  serverId: string;
  width: number;
  height: number;
  canDelete: boolean;
  canMove: boolean;
  source: string | undefined;
  onChanged: () => void;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const menu = useRef<MenuComponentRef | null>(null);
  const attachment = useAttachmentFile(serverId, file, false);
  const preview = useAttachmentPreview(serverId, file);
  const { deleting, confirmDelete } = useStoredFileDelete(serverId, file, onChanged);
  const picture = isLibraryPicture(file);
  const { agentId, messageId } = file;
  const actions: MenuAction[] = [];
  if (agentId && messageId)
    actions.push({
      id: "showInChat",
      title: t("mobile.server.library.showInChat"),
      image: "bubble.left.and.bubble.right",
    });
  if (canMove) actions.push({ id: "move", title: t("mobile.server.library.folders.moveTo"), image: "folder" });
  actions.push({
    id: "share",
    title: t("mobile.server.library.share"),
    image: "square.and.arrow.up",
    attributes: { disabled: attachment.busy },
  });
  if (canDelete)
    actions.push({
      id: "delete",
      title: t("common.delete"),
      image: "trash",
      attributes: { destructive: true, disabled: deleting },
    });

  function run(action: string) {
    if (action === "share") attachment.share();
    else if (action === "move") router.push({ pathname: "/library-folders", params: { serverId, fileId: file.id } });
    else if (action === "delete") confirmDelete();
    else if (action === "showInChat" && agentId && messageId)
      router.push({ pathname: "/chat/[agentId]", params: { agentId, serverId, messageId } });
  }

  function longPress() {
    void haptics.longPress();
    if (isAndroid) menu.current?.show();
  }

  return (
    <MenuView
      {...(isAndroid ? { ref: menu, colorScheme: theme === "dark" ? ("dark" as const) : ("light" as const) } : null)}
      shouldOpenOnLongPress
      actions={actions}
      onPressAction={({ nativeEvent }) => run(nativeEvent.event)}
      style={{ width, height }}
    >
      {picture ? (
        <View style={{ width, height, opacity: deleting ? 0.5 : 1 }}>
          <ChatGalleryTile
            attachment={file}
            serverId={serverId}
            tile={{ left: 0, top: 0, width, height }}
            onLongPress={longPress}
          />
        </View>
      ) : (
        <FileCard
          file={file}
          width={width}
          height={height}
          source={source}
          busy={attachment.busy || preview.opening}
          disabled={deleting}
          onPress={preview.kind ? preview.open : attachment.share}
          onLongPress={longPress}
        />
      )}
    </MenuView>
  );
}

function FileCard({
  file,
  width,
  height,
  source,
  busy,
  disabled,
  onPress,
  onLongPress,
}: {
  file: StoredFileRow;
  width: number;
  height: number;
  source: string | undefined;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { t } = useText();
  const [control, iconColor, iconBackground] = useCSSVariable([
    "--openbot-bg-control",
    "--openbot-file-default",
    "--openbot-file-default-soft",
  ]);
  const Icon = TYPE_ICON[fileTypeOf(file)];
  const large = width > LARGE_CARD_SIZE && height > LARGE_CARD_SIZE;
  const iconBox = large ? 44 : 32;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.chat.attachment.preview", { name: file.name })}
      accessibilityHint={source}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      className={large ? "justify-between p-3.5" : "justify-between p-2.5"}
      style={({ pressed }) => ({
        width,
        height,
        borderRadius: TILE_RADIUS,
        borderCurve: "continuous",
        backgroundColor: String(control),
        opacity: disabled || busy ? 0.6 : pressed ? 0.75 : 1,
      })}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
      delayLongPress={longPressDelay}
      onLongPress={onLongPress}
    >
      <View
        className="items-center justify-center"
        style={{
          width: iconBox,
          height: iconBox,
          borderRadius: iconBox * 0.28,
          backgroundColor: String(iconBackground),
        }}
      >
        <Icon color={String(iconColor)} size={large ? 24 : 18} strokeWidth={1.9} />
      </View>
      <View className="gap-0.5">
        <Typography.Paragraph
          numberOfLines={large ? 3 : 2}
          style={large ? typeScale.preview : typeScale.caption}
          className="font-medium"
        >
          {file.name}
        </Typography.Paragraph>
        {source ? (
          <Typography.Paragraph numberOfLines={1} className="text-muted" style={typeScale.caption}>
            {source}
          </Typography.Paragraph>
        ) : null}
      </View>
    </Pressable>
  );
}
