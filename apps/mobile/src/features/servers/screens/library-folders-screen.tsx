import {
  LIBRARY_FOLDER_LIMITS,
  type LibraryFolder,
  type LibraryFolderAction,
  type LibraryFoldersSnapshot,
  libraryFolderOfFile,
  libraryFolderPath,
  libraryFolderTree,
  type StoredFileRow,
} from "@openbot/contracts/ipc";
import { router, Stack, useLocalSearchParams, useNavigation } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Files from "lucide-react-native/icons/files";
import FolderIcon from "lucide-react-native/icons/folder";
import FolderPlus from "lucide-react-native/icons/folder-plus";
import UserX from "lucide-react-native/icons/user-x";
import X from "lucide-react-native/icons/x";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { AgentProviderAvatar } from "@/features/agents/components/agent-provider-avatar";
import {
  canHoldFolder,
  childFolders,
  folderFileCount,
  fromRemovedAgent,
  type LibraryPlace,
  resolveLibraryPlace,
  setLibraryPlace,
  useLibraryPlace,
} from "@/features/servers/model/library-place";
import { newLibraryFolderId, useLibrary } from "@/features/servers/model/use-library-folders";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";

/** Each level of the tree moves its rows in by this much. */
const INDENT = 18;
const ICON_BOX = 28;

type ChangeFolders = (action: LibraryFolderAction) => Promise<void>;

/** A refused or failed change. The folders already show what the host has now. */
function alertChangeFailed(cause: unknown): void {
  void haptics.notification("error");
  const text = currentText();
  const title = text.t("mobile.server.library.folders.changeFailed");
  Alert.alert(title, text.errorMessage(cause, title));
}

/** The page that names a new folder, or a folder that gets a new name, in the folder sheet. */
function openNamePage(params: {
  serverId: string;
  agentId?: string;
  parentId?: string;
  folderId?: string;
  fileId?: string;
}): void {
  void haptics.impact("light");
  router.push({ pathname: "/library-folders/name", params });
}

/** Asks first: a delete takes the folders in the folder too. The files stay with the agent. */
function confirmDelete(folder: LibraryFolder, change: ChangeFolders): void {
  const text = currentText();
  void haptics.notification("warning");
  Alert.alert(
    text.t("mobile.server.library.folders.deleteTitle", { name: folder.name }),
    text.t("mobile.server.library.folders.deleteBody"),
    [
      { text: text.t("common.cancel"), style: "cancel" },
      {
        text: text.t("mobile.server.library.folders.delete"),
        style: "destructive",
        onPress: () => void change({ type: "delete", folderId: folder.id }).catch(alertChangeFailed),
      },
    ],
  );
}

/** The "…" of a folder or an agent row: the native menu of its folder actions. */
function FolderActionsMenu({
  serverId,
  agentId,
  agentName,
  folder,
  folders,
  change,
}: {
  serverId: string;
  agentId: string;
  agentName: string;
  /** Absent: the menu of the agent row, which only makes a folder at the top level. */
  folder?: LibraryFolder;
  folders: readonly LibraryFolder[];
  change: ChangeFolders;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const menu = useRef<MenuComponentRef | null>(null);
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const canAdd = canHoldFolder(folders, folder?.id);
  const actions: MenuAction[] = [
    {
      id: "new",
      title: t("mobile.server.library.folders.new"),
      image: "folder.badge.plus",
      attributes: { disabled: !canAdd },
    },
  ];
  if (folder)
    actions.push(
      { id: "rename", title: t("mobile.server.library.folders.rename"), image: "pencil" },
      {
        id: "delete",
        title: t("mobile.server.library.folders.delete"),
        image: "trash",
        attributes: { destructive: true },
      },
    );
  function run(action: string) {
    if (action === "new") openNamePage({ serverId, agentId, ...(folder ? { parentId: folder.id } : {}) });
    else if (action === "rename" && folder) openNamePage({ serverId, folderId: folder.id });
    else if (action === "delete" && folder) confirmDelete(folder, change);
  }
  return (
    <MenuView
      {...(isAndroid ? { ref: menu, colorScheme: theme === "dark" ? ("dark" as const) : ("light" as const) } : null)}
      actions={actions}
      onPressAction={({ nativeEvent }) => run(nativeEvent.event)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.server.library.folders.actions", { name: folder?.name ?? agentName })}
        hitSlop={6}
        className="mr-2 size-10 items-center justify-center rounded-full"
        onPress={() => {
          if (isAndroid) menu.current?.show();
        }}
      >
        <Ellipsis size={20} color={muted} strokeWidth={1.8} />
      </Pressable>
    </MenuView>
  );
}

/** The chevron that shows or hides the folders of a row. It turns down while they show. */
function ExpandButton({ name, expanded, onPress }: { name: string; expanded: boolean; onPress: () => void }) {
  const { t } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(
        expanded ? "mobile.server.library.folders.collapse" : "mobile.server.library.folders.expand",
        { name },
      )}
      accessibilityState={{ expanded }}
      hitSlop={6}
      className="size-9 items-center justify-center"
      onPress={() => {
        void haptics.selection();
        onPress();
      }}
    >
      <ChevronRight
        size={18}
        color={muted}
        strokeWidth={1.8}
        style={[MIRROR_IN_RTL, expanded ? { transform: [{ rotate: "90deg" }] } : null]}
      />
    </Pressable>
  );
}

function Glyph({ children, depth = 0 }: { children: ReactNode; depth?: number }) {
  return (
    <View className="flex-row items-center" style={{ paddingStart: depth * INDENT }}>
      <View className="items-center justify-center" style={{ width: ICON_BOX, height: ICON_BOX }}>
        {children}
      </View>
    </View>
  );
}

/**
 * A tree row and its controls. The chevron and the "…" are beside the row, not in it: a control
 * inside the pressable row gives its tap to the row, and the native menu does not open.
 */
function TreeRow({ row, controls }: { row: ReactNode; controls: ReactNode }) {
  return (
    <View className="flex-row items-center">
      <View className="min-w-0 flex-1">{row}</View>
      {controls}
    </View>
  );
}

function RowTrailing({ count, children }: { count: string; children?: ReactNode }) {
  return (
    <View className="flex-row items-center gap-1">
      <Typography.Paragraph className="text-grouped-secondary">{count}</Typography.Paragraph>
      {children}
    </View>
  );
}

/** The note of a sheet whose folders did not load, or of a server without folders. */
function FoldersNote({ library }: { library: ReturnType<typeof useLibrary> }) {
  const { t, errorMessage } = useText();
  const { folders, storage } = library;
  const failed = folders.query.isError ? folders.query.error : storage.query.isError ? storage.query.error : null;
  return (
    <SettingsContent>
      <SettingsNote>
        {!folders.available
          ? t("mobile.server.library.folders.unsupported")
          : failed
            ? errorMessage(failed, t("mobile.server.library.folders.loadFailed"))
            : t("mobile.server.storage.measuring")}
      </SettingsNote>
    </SettingsContent>
  );
}

/**
 * Library > folder capsule: the place sheet. With `fileId` it is the move sheet of that file instead.
 * The rows follow the host: a change on another device or by an agent shows here at once.
 */
export function LibraryFoldersScreen() {
  const { fileId } = useLocalSearchParams<{ serverId: string; fileId?: string }>();
  return fileId ? <MoveFileSheet fileId={fileId} /> : <PlaceSheet />;
}

function PlaceSheet() {
  const { t, format } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const library = useLibrary(serverId);
  const { folders, storage, canOrganize } = library;
  const snapshot = folders.snapshot;
  const allAgents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  const files = useMemo(
    () => (storage.query.data?.files ?? []).filter((file) => file.status !== "missing"),
    [storage.query.data],
  );
  const accent = String(useCSSVariable("--openbot-accent"));
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const removedFiles = files.filter((file) => fromRemovedAgent(file, folders.livingAgentIds));
  const storedPlace = useLibraryPlace(serverId);
  const removedFilesExist = removedFiles.length > 0;
  const chosen = useMemo(
    () => resolveLibraryPlace(storedPlace, snapshot, folders.livingAgentIds, removedFilesExist),
    [storedPlace, snapshot, folders.livingAgentIds, removedFilesExist],
  );
  // The agent and the folders of the place show open, so the place is in view.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const open = new Set<string>();
    if (chosen.kind === "agent" || chosen.kind === "folder") open.add(`agent:${chosen.agentId}`);
    if (chosen.kind === "folder" && snapshot)
      for (const folder of libraryFolderPath(snapshot.folders, chosen.folderId)) open.add(folder.id);
    return open;
  });
  // A folder that is new since the list opened, from this phone or from another device, shows: its
  // agent and the folders above it open.
  const seenFolderIds = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    const seen = seenFolderIds.current;
    seenFolderIds.current = new Set(snapshot.folders.map((folder) => folder.id));
    if (!seen) return;
    const added = snapshot.folders.filter((folder) => !seen.has(folder.id));
    if (added.length === 0) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const folder of added) {
        next.add(`agent:${folder.agentId}`);
        for (const above of libraryFolderPath(snapshot.folders, folder.parentId)) next.add(above.id);
      }
      return next;
    });
  }, [snapshot]);
  if (!snapshot || !storage.query.data) return <FoldersNote library={library} />;
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const isChosen = (place: LibraryPlace) =>
    place.kind === chosen.kind &&
    (place.kind !== "agent" || (chosen.kind === "agent" && place.agentId === chosen.agentId)) &&
    (place.kind !== "folder" || (chosen.kind === "folder" && place.folderId === chosen.folderId));
  const choose = (place: LibraryPlace) => {
    void haptics.selection();
    setLibraryPlace(serverId, place);
    router.back();
  };
  const check = (place: LibraryPlace) => (isChosen(place) ? <Check size={18} color={accent} strokeWidth={2} /> : null);
  const countText = (count: number) => format.number(count);

  /** The folder rows under one parent, and the rows of each open folder under it. */
  const folderRows = (agentId: string, agentName: string, parentId: string | undefined, depth: number): ReactNode[] =>
    childFolders(snapshot.folders, agentId, parentId).flatMap((folder) => {
      const place: LibraryPlace = { kind: "folder", agentId, folderId: folder.id };
      const hasChildren = childFolders(snapshot.folders, agentId, folder.id).length > 0;
      const open = expanded.has(folder.id);
      return [
        <TreeRow
          key={folder.id}
          row={
            <SettingsRow
              checked={isChosen(place)}
              disclosure={false}
              leading={
                <Glyph depth={depth}>
                  <FolderIcon size={20} color={accent} strokeWidth={1.8} />
                </Glyph>
              }
              trailing={
                <RowTrailing count={countText(folderFileCount(files, snapshot, folder.id))}>{check(place)}</RowTrailing>
              }
              onPress={() => choose(place)}
            >
              <Typography.Paragraph numberOfLines={1}>{folder.name}</Typography.Paragraph>
            </SettingsRow>
          }
          controls={
            <>
              {hasChildren ? (
                <ExpandButton name={folder.name} expanded={open} onPress={() => toggle(folder.id)} />
              ) : null}
              {canOrganize(agentId) ? (
                <FolderActionsMenu
                  serverId={serverId}
                  agentId={agentId}
                  agentName={agentName}
                  folder={folder}
                  folders={snapshot.folders}
                  change={folders.change}
                />
              ) : null}
            </>
          }
        />,
        ...(open && depth < LIBRARY_FOLDER_LIMITS.levels ? folderRows(agentId, agentName, folder.id, depth + 1) : []),
      ];
    });

  const agentRows = agents.flatMap((agent) => {
    const place: LibraryPlace = { kind: "agent", agentId: agent.id };
    const key = `agent:${agent.id}`;
    const hasFolders = childFolders(snapshot.folders, agent.id, undefined).length > 0;
    const open = expanded.has(key);
    return [
      <TreeRow
        key={key}
        row={
          <SettingsRow
            checked={isChosen(place)}
            disclosure={false}
            leading={<AgentProviderAvatar agent={agent} size={ICON_BOX} />}
            trailing={
              <RowTrailing count={countText(files.filter((file) => file.agentId === agent.id).length)}>
                {check(place)}
              </RowTrailing>
            }
            onPress={() => choose(place)}
          >
            <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
          </SettingsRow>
        }
        controls={
          <>
            {hasFolders ? <ExpandButton name={agent.name} expanded={open} onPress={() => toggle(key)} /> : null}
            {canOrganize(agent.id) ? (
              <FolderActionsMenu
                serverId={serverId}
                agentId={agent.id}
                agentName={agent.name}
                folders={snapshot.folders}
                change={folders.change}
              />
            ) : null}
          </>
        }
      />,
      ...(open ? folderRows(agent.id, agent.name, undefined, 1) : []),
    ];
  });

  return (
    <SettingsContent>
      <Stack.Screen options={{ title: t("mobile.server.library.folders.title") }} />
      <SettingsSection>
        <SettingsRow
          checked={isChosen({ kind: "all" })}
          disclosure={false}
          leading={
            <Glyph>
              <Files size={20} color={accent} strokeWidth={1.8} />
            </Glyph>
          }
          trailing={<RowTrailing count={countText(files.length)}>{check({ kind: "all" })}</RowTrailing>}
          onPress={() => choose({ kind: "all" })}
        >
          <Typography.Paragraph>{t("mobile.server.library.folders.allFiles")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {agentRows.length > 0 ? <SettingsSection>{agentRows}</SettingsSection> : null}
      {removedFiles.length > 0 ? (
        <SettingsSection>
          <SettingsRow
            checked={isChosen({ kind: "removed" })}
            disclosure={false}
            leading={
              <Glyph>
                <UserX size={20} color={muted} strokeWidth={1.8} />
              </Glyph>
            }
            trailing={<RowTrailing count={countText(removedFiles.length)}>{check({ kind: "removed" })}</RowTrailing>}
            onPress={() => choose({ kind: "removed" })}
          >
            <Typography.Paragraph>{t("mobile.server.library.folders.removedAgents")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}

/** Library > a file's "Move to folder": the folders of the file's agent. A file never leaves its agent. */
function MoveFileSheet({ fileId }: { fileId: string }) {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const library = useLibrary(serverId);
  const { folders, storage, canOrganize } = library;
  const snapshot = folders.snapshot;
  const accent = String(useCSSVariable("--openbot-accent"));
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const [moving, setMoving] = useState(false);
  const file: StoredFileRow | undefined = storage.query.data?.files.find((item) => item.id === fileId);
  if (!snapshot || !storage.query.data) return <FoldersNote library={library} />;
  if (!file || !canOrganize(file.agentId))
    return (
      <SettingsContent>
        <Stack.Screen options={{ title: t("mobile.server.library.folders.moveTo") }} />
        <SettingsNote>{t("mobile.server.library.folders.fileGone")}</SettingsNote>
      </SettingsContent>
    );
  const agentId = file.agentId;
  const current = libraryFolderOfFile(snapshot, file)?.id ?? null;
  const move = (folderId: string | null) => {
    if (moving) return;
    if (folderId === current) {
      router.back();
      return;
    }
    setMoving(true);
    void haptics.impact("soft");
    folders
      .change({ type: "place", fileIds: [file.id], folderId })
      .then(() => {
        void haptics.notification("success");
        router.back();
      })
      .catch((cause: unknown) => {
        setMoving(false);
        alertChangeFailed(cause);
      });
  };
  const check = (folderId: string | null) =>
    folderId === current ? <Check size={18} color={accent} strokeWidth={2} /> : null;
  return (
    <SettingsContent>
      <Stack.Screen options={{ title: t("mobile.server.library.folders.moveTo") }} />
      <SettingsNote>{file.name}</SettingsNote>
      <SettingsSection>
        <SettingsRow
          checked={current === null}
          disabled={moving}
          disclosure={false}
          leading={
            <Glyph>
              <Files size={20} color={muted} strokeWidth={1.8} />
            </Glyph>
          }
          trailing={check(null)}
          onPress={() => move(null)}
        >
          <Typography.Paragraph>{t("mobile.server.library.folders.notInFolder")}</Typography.Paragraph>
        </SettingsRow>
        {libraryFolderTree(snapshot.folders, agentId).map(({ folder, depth }) => (
          <SettingsRow
            key={folder.id}
            checked={folder.id === current}
            disabled={moving}
            disclosure={false}
            leading={
              <Glyph depth={depth}>
                <FolderIcon size={20} color={accent} strokeWidth={1.8} />
              </Glyph>
            }
            trailing={check(folder.id)}
            onPress={() => move(folder.id)}
          >
            <Typography.Paragraph numberOfLines={1}>{folder.name}</Typography.Paragraph>
          </SettingsRow>
        ))}
        {canHoldFolder(snapshot.folders, undefined) ? (
          <SettingsRow
            disabled={moving}
            disclosure={false}
            leading={
              <Glyph>
                <FolderPlus size={20} color={accent} strokeWidth={1.8} />
              </Glyph>
            }
            onPress={() => openNamePage({ serverId, agentId, fileId: file.id })}
          >
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.library.folders.new")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsContent>
  );
}

/**
 * The folder sheet's name page: a new folder of an agent (in `parentId`, and with `fileId` in it), or a
 * new name for `folderId`. It closes the whole sheet when the host has the change.
 */
export function LibraryFolderNameScreen() {
  const { t } = useText();
  const params = useLocalSearchParams<{
    serverId: string;
    agentId?: string;
    parentId?: string;
    folderId?: string;
    fileId?: string;
  }>();
  const { serverId } = params;
  const navigation = useNavigation();
  // The stack that presents the sheet: going back in it closes the sheet with all its pages.
  const sheetStack = navigation.getParent();
  // Opened from the folder list or the move list of the sheet: the page goes back to that list, which
  // shows the change. Opened alone, from the "+" of the Library, it closes the sheet.
  const hasListBelow = (navigation.getState()?.index ?? 0) > 0;
  const { folders, canOrganize } = useLibrary(serverId);
  const snapshot: LibraryFoldersSnapshot | null = folders.snapshot;
  const renaming = params.folderId ? snapshot?.folders.find((folder) => folder.id === params.folderId) : undefined;
  const parent = params.parentId ? snapshot?.folders.find((folder) => folder.id === params.parentId) : undefined;
  const agentId = renaming?.agentId ?? params.agentId ?? null;
  const [name, setName] = useState(renaming?.name ?? "");
  // The folders can load after the page opens. The field then starts with the folder's name.
  const touched = useRef(false);
  const loadedName = renaming?.name;
  useEffect(() => {
    if (loadedName === undefined || touched.current) return;
    setName(loadedName);
  }, [loadedName]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const gone = Boolean(params.folderId && snapshot && !renaming) || Boolean(params.parentId && snapshot && !parent);
  const available = Boolean(snapshot) && !gone && canOrganize(agentId);
  const valid = trimmed.length > 0 && trimmed.length <= LIBRARY_FOLDER_LIMITS.name;
  const dirty = renaming ? trimmed !== renaming.name : trimmed.length > 0;
  const title = t(renaming ? "mobile.server.library.folders.renameTitle" : "mobile.server.library.folders.new");

  const leave = () => {
    if (!hasListBelow && sheetStack) sheetStack.goBack();
    else router.back();
  };
  const close = () => {
    void haptics.impact("soft");
    leave();
  };

  async function save() {
    if (!available || !valid || !dirty || saving || agentId === null) return;
    setSaving(true);
    setError(null);
    const action: LibraryFolderAction = renaming
      ? { type: "rename", folderId: renaming.id, name: trimmed }
      : {
          type: "create",
          id: newLibraryFolderId(),
          agentId,
          name: trimmed,
          ...(parent ? { parentId: parent.id } : {}),
          ...(params.fileId ? { fileIds: [params.fileId] } : {}),
        };
    try {
      await folders.change(action);
      void haptics.notification("success");
      leave();
    } catch (cause) {
      void haptics.notification("error");
      const text = currentText();
      setError(text.errorMessage(cause, text.t("mobile.server.library.folders.changeFailed")));
      setSaving(false);
    }
  }

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-5 px-5 pb-safe-offset-5 pt-5"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title }} />
      {/* Over a list, the native back button goes to it. Alone, the page closes the sheet. */}
      {hasListBelow ? null : isAndroid ? (
        <AndroidHeaderButton
          placement="left"
          icon={X}
          accessibilityLabel={t("common.close")}
          disabled={saving}
          onPress={close}
        />
      ) : (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="xmark" accessibilityLabel={t("common.close")} disabled={saving} onPress={close}>
            {t("common.close")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <SheetSaveAction
        dirty={dirty}
        canSave={available && valid}
        pending={saving}
        label={t(renaming ? "mobile.server.library.folders.save" : "mobile.server.library.folders.create")}
        onSave={() => void save()}
      />
      <SheetFormField
        label={t("mobile.server.library.folders.name")}
        value={name}
        onChangeText={(value) => {
          touched.current = true;
          setName(value);
          if (error) setError(null);
        }}
        editable={!saving}
        maxLength={LIBRARY_FOLDER_LIMITS.name}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
      {parent ? (
        <Typography.Paragraph className="text-muted">
          {t("mobile.server.library.folders.inFolder", { name: parent.name })}
        </Typography.Paragraph>
      ) : null}
      {snapshot && !available ? (
        <Typography.Paragraph className="text-muted">{t("mobile.server.library.folders.gone")}</Typography.Paragraph>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </SheetScrollView>
  );
}
