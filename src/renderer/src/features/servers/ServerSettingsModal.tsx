import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AvatarImageInput,
  HostStatus,
  InviteSummary,
  ServerConnectionIssueCode,
  ServerNotificationLevel,
  ServerSummary,
  TeamInviteSummary,
  TeamPresenceMember,
  TeamRole,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import { SERVER_NOTIFICATION_LEVELS } from "@openbot/contracts/ipc";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Blocks,
  Button,
  buttonVariants,
  Card,
  Check,
  ChevronRight,
  ConfirmDialog,
  CopyButton,
  Download,
  DropdownMenu,
  Ellipsis,
  Field,
  HardDrive,
  Image,
  ImageRemoveButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Monitor,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Settings,
  SettingsSection,
  ShieldCheck,
  SlidingTabs,
  Sparkles,
  SwitchField,
  Tabs,
  Text,
  Trash2,
  toast,
  UserRound,
  UsersRound,
} from "@openbot/ui";
import { normalizeAvatarFile } from "@openbot/ui/avatar-image";
import { SERVER_NOTIFICATION_LEVEL_LABELS, serverMuteDescription } from "@openbot/ui/features/servers/ServerRail";
import { SaveBarDock, SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import { teamMemberName } from "@openbot/ui/features/team/TeamPersonAvatar";
import { useText } from "@openbot/ui/text";
import { truncateMiddle } from "@openbot/ui/utils";
import { createEffect, createMemo, createSignal, createStore, For, onCleanup, Show, snapshot } from "solid-js";
import { type ServerStorageOptions, ServerStoragePanel } from "../files/ServerStoragePanel";
import { type HostProviderSettings, HostProviderSettingsPanel } from "../settings/ProviderSettingsSection";
import type { McpServerConfig, McpTestResult } from "./mcp-servers";
import { RemoteDesktopSetup } from "./RemoteDesktopSetup";
import { type ServerImportOptions, ServerImportPanel } from "./ServerImportPanel";
import { type McpPanelDetail, ServerMcpPanel } from "./ServerMcpPanel";
import { serverCanAdminister, serverRoleCanAdminister, serverSupportsCapability } from "./server-capabilities";

export interface ServerSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: "darwin" | "win32" | "linux";
  /** False where no remote desktop can start, such as the browser client. The section is then absent. */
  remoteDesktopSupported?: boolean;
  server: ServerSummary;
  hostStatus?: HostStatus | null;
  members: TeamPresenceMember[];
  invites: TeamInviteSummary[];
  loading?: boolean;
  loadError?: string | null;
  restoreFocusTarget?: HTMLElement | null;
  onRetry: () => Promise<void>;
  onSaveIdentity: (input: { serverName: string; logo?: AvatarImageInput | null }) => Promise<void>;
  onSetPublished: (published: boolean) => Promise<void>;
  /** The Notifications section appears only when a caller supplies both: they are desktop notifications. */
  onSetMuted?: (muted: boolean) => Promise<void>;
  onSetNotificationLevel?: (level: ServerNotificationLevel) => Promise<void>;
  onCreateInvite: (input: { role: "admin" | "member"; email?: string; permanent?: boolean }) => Promise<InviteSummary>;
  onUpdateMember: (input: UpdateTeamMemberInput) => Promise<void>;
  onRemoveMember: (memberId: string) => Promise<void>;
  onRevokeInvite: (inviteId: string) => Promise<void>;
  /** Opens the macOS pane that grants OpenBot screen recording, for the host that was refused it. */
  onOpenScreenRecordingSettings: () => Promise<void>;
  /** Asks the host to read the grant again, so the owner who gave it sees the warning go. */
  onRecheckScreenRecording: () => Promise<void>;
  /**
   * The MCP section appears only when a caller supplies these. A caller that cannot manage MCP
   * servers - a remote host without the capability, or a `member` account - passes nothing, and
   * then neither the tab nor the panel exists.
   */
  mcpServers?: McpServerConfig[] | undefined;
  /** Why the MCP list is empty, when the read failed rather than found nothing. */
  mcpLoadError?: string | null;
  /**
   * What the managed runtime under a STDIO server is doing, when there is anything to say. The
   * caller decides: it describes this computer, and this dialog also opens for a remote server.
   */
  mcpToolRuntimeNote?: string | null;
  onRetryMcpServers?: () => void;
  onSaveMcpServer?: (config: McpServerConfig) => Promise<void>;
  onRemoveMcpServer?: (id: string) => Promise<void>;
  onSetMcpServerEnabled?: (id: string, enabled: boolean) => Promise<void>;
  onTestMcpServer?: (config: McpServerConfig) => Promise<McpTestResult>;
  /**
   * Fired when the MCP section becomes visible. The list is read then, not when the dialog opens,
   * because most visits to this dialog never reach that section.
   */
  onMcpSectionShown?: () => void;
  /**
   * The Storage section appears only when a caller supplies this: a remote host without
   * `storage-v1` passes nothing. Every member reads it; `canManage` adds Clear and Delete.
   */
  storage?: ServerStorageOptions | undefined;
  /**
   * The Providers section appears only when a caller supplies this. The desktop app passes nothing:
   * its own Settings holds the providers of every host it administers.
   */
  providers?: HostProviderSettings | undefined;
  /** The Import section appears only when a caller supplies this: agents import into the local server. */
  agentImport?: ServerImportOptions;
}

type Section = "general" | "members" | "desktop" | "mcp" | "storage" | "providers" | "import";
type InviteMode = "link" | "email" | "perma";
type InviteRole = Exclude<TeamRole, "owner">;

const ROLE_OPTIONS: InviteRole[] = ["member", "admin"];
const ROLE_LABELS = {
  owner: "server.role.owner",
  admin: "server.role.admin",
  member: "server.role.member",
} as const satisfies Record<TeamRole, AppTextKey>;
const ISSUE_TITLES = {
  client_update_required: "server.desktop.clientUpdateRequired",
  host_update_required: "server.desktop.hostUpdateRequired",
  protocol_error: "server.desktop.connectionUnavailable",
  authentication_required: "server.desktop.connectionUnavailable",
  network_unavailable: "server.desktop.connectionUnavailable",
} as const satisfies Record<ServerConnectionIssueCode, AppTextKey>;
const EMAIL_PLACEHOLDER = "person@company.com";
const REMOTE_HOST_GATEWAY_NAME = "OpenBot Remote Host Gateway";
const sections = {
  general: { title: "server.settings.generalTitle", description: "server.settings.generalDescription" },
  members: { title: "server.settings.membersTitle", description: "server.settings.membersDescription" },
  desktop: { title: "server.settings.desktopTitle", description: "server.settings.desktopDescription" },
  mcp: { title: "server.settings.mcpTitle", description: "server.settings.mcpDescription" },
  storage: { title: "server.settings.storageTitle", description: "server.settings.storageDescription" },
  providers: { title: "server.settings.providersTitle", description: "server.settings.providersDescription" },
  import: { title: "server.settings.importTitle", description: "server.settings.importDescription" },
} as const satisfies Record<Section, { title: AppTextKey; description: AppTextKey }>;

/**
 * The identity form: the name and logo as the server last confirmed them, the draft the user is
 * editing, and the validation feedback that belongs to that draft. `logo` is `undefined` while the
 * saved image stands, `null` once the user removes it, and an image once one is chosen, so it
 * carries the difference between "unchanged" and "cleared" that a save has to send.
 */
interface ServerIdentityDraft {
  editing: boolean;
  logo: AvatarImageInput | null | undefined;
  logoError: string | null;
  logoUrl: string | null;
  name: string;
  nameShaking: boolean;
  nameTouched: boolean;
  savedLogoUrl: string | null;
  savedName: string;
}

/** The invite composer. `mode` picks which of `email` and `link` the panel is filling in. */
interface InvitePanel {
  email: string;
  emailError: string | null;
  link: string;
  mode: InviteMode;
  result: InviteSummary | null;
  showQr: boolean;
  role: InviteRole;
}

interface MembersPanel {
  removeId: string | null;
  search: string;
}

/**
 * One record per panel of the dialog. Each group's fields are written together - a reset rewrites
 * the whole identity draft at once, and switching invite mode clears three of the composer's
 * fields - so they are one store rather than a signal each, and replacing one field re-renders
 * only what read that field.
 */
interface ServerSettingsPanels {
  offerRemoteDesktopSetup: boolean;
  identity: ServerIdentityDraft;
  invite: InvitePanel;
  members: MembersPanel;
}

export function ServerSettingsModal(props: ServerSettingsModalProps) {
  const { t, format, errorMessage, sourceText } = useText();
  const [panels, setPanels] = createStore<ServerSettingsPanels>({
    offerRemoteDesktopSetup: false,
    identity: {
      editing: false,
      logo: undefined,
      logoError: null,
      logoUrl: null,
      name: "",
      nameShaking: false,
      nameTouched: false,
      savedLogoUrl: null,
      savedName: "",
    },
    invite: {
      email: "",
      emailError: null,
      link: "",
      mode: "email",
      result: null,
      showQr: false,
      role: "member",
    },
    members: { removeId: null, search: "" },
  });
  const [section, setSection] = createSignal<Section>("general");
  /** Set while the MCP panel shows a form, so the header reads `MCP › Connect to a custom MCP`. */
  const [mcpDetail, setMcpDetail] = createSignal<McpPanelDetail | null>(null);
  /** The key of the one action in flight, gating every panel at once rather than belonging to any. */
  const [busy, setBusy] = createSignal<string | null>(null);
  /** A clock, not panel state: it retires an invite row as its `expiresAt` passes. */
  const [now, setNow] = createSignal(Date.now());
  const [modalElement, setModalElement] = createSignal<HTMLElement | undefined>();
  /**
   * The height of the error toast, or 0 while no toast is shown. The panel reserves this much
   * room at its end: the toast floats over the bottom of the panel, so without the reserve it
   * covers - and swallows the clicks of - whatever the open panel puts last.
   */
  const [toastHeight, setToastHeight] = createSignal(0);
  let logoInput: HTMLInputElement | undefined;
  let nameInput: HTMLInputElement | undefined;
  let inviteLinkInput: HTMLInputElement | undefined;
  let syncedServerId = "";
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let inviteLinkSwapTimer: ReturnType<typeof setTimeout> | undefined;
  const objectUrls: string[] = [];

  const local = () => props.server.kind === "local";
  /**
   * Permanent links need a transport that carries the flag: local IPC or the account
   * plane. The frozen Team API projections strip it on legacy HTTP, where even two
   * updated peers would silently mint single-use, so the tab stays hidden there.
   */
  const permanentSupported = () => local() || props.server.apiUrl === null;
  const remoteDesktopSection = () => props.remoteDesktopSupported !== false && props.platform === "darwin";
  const configured = () => (local() ? Boolean(props.hostStatus?.configured) : true);
  /** The host changes its own name and logo; an admin elsewhere asks it to while it is online. */
  const canEditIdentity = () => serverCanAdminister(props.server, "host-admin-v1") && actionsAvailable();
  const canManage = () => configured() && serverRoleCanAdminister(props.server);
  /**
   * The same role check without `configured()`. MCP servers belong to this machine and are spawned
   * by the agents on it, so they are manageable before the user publishes a Team API host at all.
   */
  const canManageMcp = () => serverRoleCanAdminister(props.server);
  const actionsAvailable = () => local() || props.server.state === "online";
  const published = () => (local() ? props.hostStatus?.phase === "online" : props.server.state === "online");
  const address = () => (local() ? props.hostStatus?.apiUrl : props.server.apiUrl);
  const trimmedName = () => panels.identity.name.trim();
  const nameError = () => {
    if (!canEditIdentity()) return null;
    if (trimmedName().length < INPUT_LIMITS.serverNameMin)
      return t("server.settings.nameTooShort", { limit: INPUT_LIMITS.serverNameMin });
    if (trimmedName().length > INPUT_LIMITS.serverName)
      return t("server.settings.nameTooLong", { limit: INPUT_LIMITS.serverName });
    return null;
  };
  const visibleNameError = () => (panels.identity.nameTouched ? nameError() : null);
  const identityDirty = () =>
    canEditIdentity() &&
    (trimmedName() !== panels.identity.savedName ||
      panels.identity.logo !== undefined ||
      panels.identity.logoUrl !== panels.identity.savedLogoUrl);
  /** Publishes the reserve to the shell stylesheet, which spends it as the panel's end padding. */
  createEffect(
    () => ({ element: modalElement(), height: toastHeight() }),
    ({ element, height }) => {
      element?.style.setProperty("--settings-modal-floating-space", `${height}px`);
    },
  );
  /** Follows the toast, which grows with the length of the sentence the failure produced. */
  function measureToast(element: HTMLElement): void {
    const observer = new ResizeObserver(() => setToastHeight(element.offsetHeight));
    observer.observe(element);
    setToastHeight(element.offsetHeight);
    onCleanup(() => {
      observer.disconnect();
      setToastHeight(0);
    });
  }
  // Both save bars dock in the same place, so the toast has to lift for either one. It is
  // `position: absolute` over the footer: without this it covers the bar and swallows its clicks.
  const saveBarDocked = () =>
    (section() === "general" && identityDirty()) || (section() === "mcp" && Boolean(mcpDetail()?.saveBar()));
  const activeInvites = createMemo(() =>
    props.invites.filter(
      (item) => (item.permanent || item.usedAt === null) && (item.permanent || Date.parse(item.expiresAt) > now()),
    ),
  );
  const inviteUsed = () =>
    Boolean(
      panels.invite.result &&
        !panels.invite.result.permanent &&
        props.invites.some((invite) => invite.id === panels.invite.result?.id && invite.usedAt),
    );
  const inviteExpired = () =>
    Boolean(
      panels.invite.result && !panels.invite.result.permanent && Date.parse(panels.invite.result.expiresAt) <= now(),
    );
  const activeMembers = createMemo(() => props.members.filter((member) => !member.disabled));
  const inactiveLegacyMembers = createMemo(() =>
    props.server.kind === "remote" && /^https?:\/\//u.test(props.server.apiUrl ?? "")
      ? props.members.filter((member) => member.disabled && member.role !== "owner")
      : [],
  );
  const filteredMembers = createMemo(() => {
    const query = panels.members.search.trim().toLowerCase();
    if (!query) return activeMembers();
    return activeMembers().filter((member) =>
      [teamMemberName(member), member.email, member.username].some((value) => value?.toLowerCase().includes(query)),
    );
  });
  const removeMember = createMemo(() => props.members.find((member) => member.id === panels.members.removeId) ?? null);
  const canInvite = createMemo(
    () =>
      canManage() &&
      published() &&
      busy() === null &&
      (panels.invite.mode !== "email" || normalizeEmailAddress(panels.invite.email) !== null),
  );

  createEffect(
    () => ({
      open: props.open,
      id: props.server.id,
      name: props.server.kind === "local" && !props.hostStatus?.configured ? "" : props.server.name,
      logoUrl: props.server.logoUrl,
      editing: panels.identity.editing,
    }),
    ({ open, id, name, logoUrl, editing }) => {
      if (!open) return;
      if (syncedServerId !== id) {
        syncedServerId = id;
        setSection("general");
        setPanels((state) => {
          state.offerRemoteDesktopSetup = false;
          state.identity.editing = false;
          state.identity.nameTouched = false;
          state.identity.nameShaking = false;
          state.invite.result = null;
          state.invite.showQr = false;
          state.members.search = "";
        });
        resetInviteLink();
      }
      if (!editing) {
        setPanels((state) => {
          state.identity.savedName = name;
          state.identity.name = name;
          state.identity.savedLogoUrl = logoUrl;
          state.identity.logoUrl = logoUrl;
          state.identity.logo = undefined;
          state.identity.nameTouched = false;
          state.identity.nameShaking = false;
        });
      }
    },
  );

  /** The latch keeps a section the user is already in from being reported again on every change. */
  let mcpSectionVisible = false;
  createEffect(
    () => props.open && section() === "mcp" && Boolean(props.mcpServers),
    (visible) => {
      if (visible === mcpSectionVisible) return;
      mcpSectionVisible = visible;
      if (visible) props.onMcpSectionShown?.();
    },
  );

  createEffect(
    () => ({ invites: props.invites, currentTime: now() }),
    ({ invites, currentTime }) => {
      const nextExpiry = invites
        .filter((item) => !item.permanent && item.usedAt === null)
        .map((item) => Date.parse(item.expiresAt))
        .filter((value) => value > currentTime)
        .sort((left, right) => left - right)[0];
      if (expiryTimer) clearTimeout(expiryTimer);
      expiryTimer = nextExpiry
        ? setTimeout(() => setNow(Date.now()), Math.min(nextExpiry - currentTime + 1, 2_147_483_647))
        : undefined;
    },
  );

  onCleanup(() => {
    if (expiryTimer) clearTimeout(expiryTimer);
    if (inviteLinkSwapTimer) clearTimeout(inviteLinkSwapTimer);
    for (const url of objectUrls) URL.revokeObjectURL(url);
  });

  function resetInviteLink(): void {
    if (inviteLinkSwapTimer) clearTimeout(inviteLinkSwapTimer);
    inviteLinkSwapTimer = undefined;
    inviteLinkInput?.classList.remove("is-exit", "is-enter-start");
    setPanels((state) => {
      state.invite.link = "";
    });
  }

  function swapInviteLink(next: string): void {
    const element = inviteLinkInput;
    if (!element || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)) {
      setPanels((state) => {
        state.invite.link = next;
      });
      return;
    }
    if (inviteLinkSwapTimer) clearTimeout(inviteLinkSwapTimer);
    const duration =
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-swap-dur")) || 150;
    element.classList.add("is-exit");
    inviteLinkSwapTimer = setTimeout(() => {
      inviteLinkSwapTimer = undefined;
      setPanels((state) => {
        state.invite.link = next;
      });
      element.classList.remove("is-exit");
      element.classList.add("is-enter-start");
      void element.offsetHeight;
      element.classList.remove("is-enter-start");
    }, duration);
  }

  async function run(key: string, action: () => Promise<void>): Promise<boolean> {
    if (busy()) return false;
    setBusy(key);
    try {
      await action();
      return true;
    } catch (error) {
      toast.error(t("server.settings.actionFailedTitle"), {
        description: errorMessage(error, t("server.settings.actionFailed")),
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function setPublished(value: boolean): Promise<void> {
    const serverId = props.server.id;
    const succeeded = await run("publish", () => props.onSetPublished(value));
    if (!succeeded || props.server.id !== serverId) return;
    setPanels((state) => {
      state.offerRemoteDesktopSetup = value && local() && props.platform === "darwin";
    });
  }

  function dismissRemoteDesktopSetup(): void {
    setPanels((state) => {
      state.offerRemoteDesktopSetup = false;
    });
  }

  async function chooseLogo(file: File | undefined): Promise<void> {
    if (!file) return;
    setPanels((state) => {
      state.identity.logoError = null;
    });
    try {
      const image = await normalizeAvatarFile(file);
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      setPanels((state) => {
        state.identity.editing = true;
        state.identity.logo = image;
        state.identity.logoUrl = url;
      });
    } catch (error) {
      setPanels((state) => {
        state.identity.logoError = errorMessage(error, t("server.settings.imageReadFailed"));
      });
    }
  }

  function resetIdentity(): void {
    setPanels((state) => {
      state.identity.name = state.identity.savedName;
      state.identity.logoUrl = state.identity.savedLogoUrl;
      state.identity.logo = undefined;
      state.identity.editing = false;
      state.identity.nameTouched = false;
      state.identity.nameShaking = false;
      state.identity.logoError = null;
    });
  }

  function updateDraftName(value: string): void {
    const namePristine = value.trim() === panels.identity.savedName;
    const logoPristine = panels.identity.logo === undefined && panels.identity.logoUrl === panels.identity.savedLogoUrl;
    // Decided before the write, so `nameError()` still sees the pre-write draft name - the same
    // value it saw when this was a signal, whose write was equally deferred.
    const stopShaking = namePristine || !nameError();
    setPanels((state) => {
      state.identity.name = value;
      state.identity.editing = !(namePristine && logoPristine);
      if (namePristine) state.identity.nameTouched = false;
      if (stopShaking) state.identity.nameShaking = false;
    });
  }

  function restartNameShake(): void {
    setPanels((state) => {
      state.identity.nameShaking = false;
    });
    queueMicrotask(() => {
      if (!nameInput || !nameError()) return;
      void nameInput.offsetWidth;
      setPanels((state) => {
        state.identity.nameShaking = true;
      });
    });
  }

  async function saveIdentity(): Promise<void> {
    setPanels((state) => {
      state.identity.nameTouched = true;
    });
    if (nameError()) {
      restartNameShake();
      queueMicrotask(() => nameInput?.focus({ preventScroll: true }));
      return;
    }
    if (!identityDirty()) return;
    const logo = panels.identity.logo;
    const serverName = trimmedName();
    const saved = await run("identity", () =>
      props.onSaveIdentity({
        serverName,
        // The image crosses to IPC, which structured-clones it, so it goes as a snapshot rather
        // than as whatever the store hands back.
        ...(logo === undefined ? {} : { logo: snapshot(logo) }),
      }),
    );
    if (!saved) return;
    setPanels((state) => {
      state.identity.savedName = serverName;
      state.identity.savedLogoUrl = state.identity.logoUrl;
      state.identity.logo = undefined;
      state.identity.editing = false;
      state.identity.nameTouched = false;
      state.identity.nameShaking = false;
    });
  }

  function showCopyError(): void {
    toast.error(t("server.settings.copyFailedTitle"), { description: t("server.settings.copyFailed") });
  }

  async function createInvite(): Promise<void> {
    const email = panels.invite.mode === "email" ? normalizeEmailAddress(panels.invite.email) : null;
    if (panels.invite.mode === "email" && !email) {
      setPanels((state) => {
        state.invite.emailError = t("server.invite.invalidEmail");
      });
      return;
    }
    let result: InviteSummary | undefined;
    const role = panels.invite.role;
    const permanent = panels.invite.mode === "perma";
    const saved = await run("invite", async () => {
      result = await props.onCreateInvite({ role, ...(email ? { email } : {}), ...(permanent ? { permanent } : {}) });
    });
    if (!saved || !result) return;
    const created = result;
    setPanels((state) => {
      state.invite.result = created;
      state.invite.emailError = null;
      if (email) state.invite.email = "";
    });
    if (!created.email) swapInviteLink(created.inviteUrl);
  }

  const sectionTabsProps = {
    get value() {
      return section();
    },
    orientation: "vertical" as const,
    activationMode: "automatic" as const,
    onChange(value: string) {
      if (
        value === "general" ||
        value === "members" ||
        value === "desktop" ||
        value === "mcp" ||
        value === "storage" ||
        value === "providers" ||
        value === "import"
      )
        setSection(value);
    },
  };

  const inviteTabsProps = {
    get value() {
      return panels.invite.mode;
    },
    onChange(value: string) {
      if (value !== "link" && value !== "email" && value !== "perma") return;
      setPanels((state) => {
        state.invite.mode = value;
        state.invite.result = null;
        state.invite.showQr = false;
        state.invite.emailError = null;
      });
      resetInviteLink();
    },
  };

  return (
    <Tabs.Root {...sectionTabsProps} class="settings-modal-tabs-root">
      <SettingsDialogShell
        class="server-settings-modal-shell"
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={
          <Show when={section() === "mcp" && mcpDetail()} fallback={t(sections[section()].title)}>
            {(detail) => (
              <span class="settings-modal-crumbs">
                <Button type="button" variant="ghost" class="settings-modal-crumb-parent" onClick={detail().back}>
                  {t(sections.mcp.title)}
                </Button>
                <ChevronRight class="settings-modal-crumb-separator" aria-hidden="true" />
                <span class="settings-modal-crumb-current">{detail().title}</span>
              </span>
            )}
          </Show>
        }
        description={t(sections[section()].description)}
        contentKey={`${props.server.id}:${section()}`}
        closeLabel={t("server.settings.close")}
        restoreFocusTarget={props.restoreFocusTarget}
        onContentElement={(element) => setModalElement(element)}
        floatingContent={
          <Show when={props.loadError && (section() === "general" || section() === "members")}>
            <Alert
              ref={measureToast}
              class="server-settings-error-toast"
              data-with-save-bar={saveBarDocked() ? "" : undefined}
              tone="danger"
              role="alert"
            >
              <AlertIcon>
                <ShieldCheck />
              </AlertIcon>
              <AlertContent>
                <AlertTitle>{t("server.settings.unavailableTitle")}</AlertTitle>
                <AlertDescription>{props.loadError}</AlertDescription>
              </AlertContent>
              <AlertActions>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  loading={props.loading}
                  onClick={() => void run("retry", props.onRetry)}
                >
                  <RefreshCw aria-hidden="true" />
                  {t("common.retry")}
                </Button>
              </AlertActions>
            </Alert>
          </Show>
        }
        footer={
          <>
            {/* The MCP form's save bar belongs to the dialog, not to the panel: the footer sits
                outside the scroll area, so the bar stays on screen and spans the whole panel. It
                appears only once the form holds a change, the way the General tab's bar does. */}
            <Show when={section() === "mcp" ? mcpDetail() : null}>
              {(detail) => (
                <SaveBarDock value={detail().saveBar()}>
                  {(bar) => (
                    <section class="settings-modal-save-bar" aria-label={t("server.settings.unsavedMcpChanges")}>
                      <Show
                        when={bar().failed}
                        fallback={
                          <Text variant="caption" tone="muted">
                            {bar().message}
                          </Text>
                        }
                      >
                        <Text variant="caption" tone="danger" role="alert">
                          {bar().message}
                        </Text>
                      </Show>
                      <div class="settings-modal-save-actions">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={bar().resetDisabled}
                          onClick={detail().reset}
                        >
                          {t("server.settings.reset")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          loading={bar().saving}
                          loadingLabel={t("common.saving")}
                          disabled={bar().saveDisabled}
                          onClick={detail().save}
                        >
                          {t("common.save")}
                        </Button>
                      </div>
                    </section>
                  )}
                </SaveBarDock>
              )}
            </Show>
            {/* `true` while the identity form is dirty: the dock only needs to know that there is
                something to show, so the bar's own markup stays as it was. */}
            <SaveBarDock value={section() === "general" && identityDirty() ? true : null}>
              {() => (
                <section class="settings-modal-save-bar" aria-label={t("server.settings.unsavedChanges")}>
                  <Text variant="caption" tone="muted">
                    {t("server.settings.changesNotSaved")}
                  </Text>
                  <div class="settings-modal-save-actions">
                    <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy())} onClick={resetIdentity}>
                      {t("server.settings.reset")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      loading={busy() === "identity"}
                      loadingLabel={t("common.saving")}
                      disabled={Boolean(busy())}
                      onClick={() => void saveIdentity()}
                    >
                      {t("common.save")}
                    </Button>
                  </div>
                </section>
              )}
            </SaveBarDock>
          </>
        }
        sidebar={
          <Tabs.List class="settings-modal-nav" aria-label={t("server.settings.sections")}>
            <Tabs.Trigger class="settings-modal-nav-item" value="general">
              <Settings aria-hidden="true" />
              <span>{t(sections.general.title)}</span>
            </Tabs.Trigger>
            <Tabs.Trigger class="settings-modal-nav-item" value="members">
              <UsersRound aria-hidden="true" />
              <span>{t(sections.members.title)}</span>
            </Tabs.Trigger>
            <Show when={remoteDesktopSection()}>
              <Tabs.Trigger class="settings-modal-nav-item" value="desktop">
                <Monitor aria-hidden="true" />
                <span>{t(sections.desktop.title)}</span>
              </Tabs.Trigger>
            </Show>
            <Show when={props.mcpServers}>
              <Tabs.Trigger class="settings-modal-nav-item" value="mcp">
                <Blocks aria-hidden="true" />
                <span>{t(sections.mcp.title)}</span>
              </Tabs.Trigger>
            </Show>
            <Show when={props.storage}>
              <Tabs.Trigger class="settings-modal-nav-item" value="storage">
                <HardDrive aria-hidden="true" />
                <span>{t(sections.storage.title)}</span>
              </Tabs.Trigger>
            </Show>
            <Show when={props.providers}>
              <Tabs.Trigger class="settings-modal-nav-item" value="providers">
                <Sparkles aria-hidden="true" />
                <span>{t(sections.providers.title)}</span>
              </Tabs.Trigger>
            </Show>
            <Show when={props.agentImport}>
              <Tabs.Trigger class="settings-modal-nav-item" value="import">
                <Download aria-hidden="true" />
                <span>{t(sections.import.title)}</span>
              </Tabs.Trigger>
            </Show>
          </Tabs.List>
        }
      >
        <Tabs.Content value="general" class="settings-modal-tab-panel server-settings-panel" data-tab="general">
          <GeneralPanel />
        </Tabs.Content>
        <Tabs.Content value="members" class="settings-modal-tab-panel server-settings-panel" data-tab="members">
          <MembersPanel />
        </Tabs.Content>
        <Show when={remoteDesktopSection()}>
          <Tabs.Content value="desktop" class="settings-modal-tab-panel server-settings-panel" data-tab="desktop">
            <DesktopPanel />
          </Tabs.Content>
        </Show>
        <Show when={props.mcpServers}>
          {(servers) => (
            <Tabs.Content value="mcp" class="settings-modal-tab-panel server-settings-panel" data-tab="mcp">
              <ServerMcpPanel
                servers={servers()}
                canManage={canManageMcp()}
                menuMount={modalElement()}
                loadError={props.mcpLoadError}
                toolRuntimeNote={props.mcpToolRuntimeNote}
                onRetryLoad={props.onRetryMcpServers}
                onDetailChange={setMcpDetail}
                onSave={(config) => props.onSaveMcpServer?.(config) ?? Promise.resolve()}
                onRemove={(id) => props.onRemoveMcpServer?.(id) ?? Promise.resolve()}
                onSetEnabled={(id, enabled) => props.onSetMcpServerEnabled?.(id, enabled) ?? Promise.resolve()}
                onTest={(config) =>
                  props.onTestMcpServer?.(config) ??
                  Promise.resolve({ toolCount: 0, error: t("mcp.panel.testUnavailable") })
                }
              />
            </Tabs.Content>
          )}
        </Show>
        {/* Mounted only while selected, so the host is measured when the section opens. */}
        <Show when={props.storage}>
          {(storage) => (
            <Tabs.Content value="storage" class="settings-modal-tab-panel server-settings-panel" data-tab="storage">
              <ServerStoragePanel serverId={props.server.id} {...storage()} />
            </Tabs.Content>
          )}
        </Show>
        <Show when={props.providers}>
          {(providers) => (
            <Tabs.Content value="providers" class="settings-modal-tab-panel server-settings-panel" data-tab="providers">
              <HostProviderSettingsPanel {...providers()} hostName={props.server.name} selectMount={modalElement()} />
            </Tabs.Content>
          )}
        </Show>
        <Show when={props.agentImport}>
          {(agentImport) => (
            <Tabs.Content value="import" class="settings-modal-tab-panel server-settings-panel" data-tab="import">
              <ServerImportPanel {...agentImport()} />
            </Tabs.Content>
          )}
        </Show>
      </SettingsDialogShell>

      {/* The dialog unmounts with its target, so its title never shows an empty name while it closes. */}
      <Show when={removeMember()}>
        {(member) => (
          <ConfirmDialog
            open
            initialFocus="cancel"
            pending={busy() === `remove:${member().id}`}
            title={t("server.members.removeTitle", { name: teamMemberName(member()) })}
            description={t("server.members.removeDescription")}
            confirmLabel={t("server.members.remove")}
            pendingLabel={t("common.removing")}
            onCancel={() =>
              setPanels((state) => {
                state.members.removeId = null;
              })
            }
            onConfirm={async () => {
              await run(`remove:${member().id}`, async () => {
                await props.onRemoveMember(member().id);
                setPanels((state) => {
                  state.members.removeId = null;
                });
              });
            }}
          />
        )}
      </Show>
    </Tabs.Root>
  );

  function GeneralPanel() {
    return (
      <>
        <SettingsSection title={t("server.settings.identity")}>
          <Input
            ref={(element) => (logoInput = element)}
            hidden
            type="file"
            aria-label={t("server.settings.logo")}
            accept="image/png,image/jpeg,image/webp"
            disabled={!canEditIdentity()}
            onChange={(event) => {
              void chooseLogo(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <ItemGroup class="settings-modal-card">
            <Show
              when={canEditIdentity()}
              fallback={
                <Item class="server-settings-readonly-name">
                  <ItemContent>
                    <ItemTitle>{t("server.settings.name")}</ItemTitle>
                    <ItemDescription>{t("server.settings.nameOwnerOnly")}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Text as="span" class="server-settings-readonly-value" variant="body">
                      {props.server.name}
                    </Text>
                  </ItemActions>
                </Item>
              }
            >
              <Item class="settings-identity-name-row">
                <ItemContent>
                  <ItemTitle id="server-settings-name-label">{t("server.settings.name")}</ItemTitle>
                  <ItemDescription id="server-settings-name-description">
                    {t("server.settings.nameDescription")}
                  </ItemDescription>
                </ItemContent>
                <ItemActions class="settings-identity-name-control" data-invalid={visibleNameError() ? "" : undefined}>
                  <Input
                    ref={(element) => (nameInput = element)}
                    class={
                      panels.identity.nameShaking
                        ? "settings-identity-name-input is-shaking"
                        : "settings-identity-name-input"
                    }
                    id="server-settings-name"
                    size="md"
                    maxlength={INPUT_LIMITS.serverName}
                    placeholder={t("server.settings.namePlaceholder")}
                    value={panels.identity.name}
                    aria-labelledby="server-settings-name-label"
                    aria-describedby={
                      visibleNameError() ? "server-settings-name-error" : "server-settings-name-description"
                    }
                    aria-invalid={visibleNameError() ? "true" : undefined}
                    onValueChange={updateDraftName}
                    onBlur={() => {
                      if (trimmedName() === panels.identity.savedName) return;
                      setPanels((state) => {
                        state.identity.nameTouched = true;
                      });
                      if (nameError()) restartNameShake();
                    }}
                    onAnimationEnd={() =>
                      setPanels((state) => {
                        state.identity.nameShaking = false;
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.isComposing) return;
                      event.preventDefault();
                      void saveIdentity();
                    }}
                  />
                  <span
                    id="server-settings-name-error"
                    class="ui-field-error settings-identity-name-error"
                    role="alert"
                    aria-hidden={visibleNameError() ? undefined : "true"}
                  >
                    {visibleNameError() ?? ""}
                  </span>
                </ItemActions>
              </Item>
            </Show>
            <Item class="settings-identity-image-row">
              <ItemContent>
                <ItemTitle>{t("server.settings.logo")}</ItemTitle>
                <ItemDescription class={panels.identity.logoError ? "server-settings-item-error" : undefined}>
                  {panels.identity.logoError ??
                    (canEditIdentity() ? t("server.settings.logoDescription") : t("server.settings.logoOwnerOnly"))}
                </ItemDescription>
              </ItemContent>
              <ItemActions class="settings-identity-image-control">
                <Show
                  when={canEditIdentity()}
                  fallback={
                    <ServerLogo name={panels.identity.name || props.server.name} url={panels.identity.logoUrl} />
                  }
                >
                  <div class="settings-identity-image-picker ui-removable-image">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-lg"
                      class="settings-identity-image-trigger server-settings-logo-trigger"
                      aria-label={
                        panels.identity.logoUrl ? t("server.settings.editLogo") : t("server.settings.addLogo")
                      }
                      onClick={() => logoInput?.click()}
                    >
                      <Show
                        when={panels.identity.logoUrl}
                        fallback={<Image class="server-settings-logo-placeholder" aria-hidden="true" />}
                      >
                        {(logoUrl) => <ServerLogo name={panels.identity.name || props.server.name} url={logoUrl()} />}
                      </Show>
                    </Button>
                    <Show when={panels.identity.logoUrl}>
                      <ImageRemoveButton
                        class="server-settings-logo-remove"
                        label={t("server.settings.removeLogo")}
                        onClick={() => {
                          setPanels((state) => {
                            state.identity.editing = true;
                            state.identity.logoUrl = null;
                            state.identity.logo = null;
                            state.identity.logoError = null;
                          });
                        }}
                      />
                    </Show>
                  </div>
                </Show>
              </ItemActions>
            </Item>
          </ItemGroup>
        </SettingsSection>
        <SettingsSection title={t("server.settings.access")}>
          <ItemGroup class="settings-modal-card">
            <SwitchField
              class="server-settings-publish-setting"
              size="default"
              checked={published()}
              disabled={!local() || !configured() || Boolean(busy())}
              onChange={(value) => void setPublished(value)}
              label={local() ? t("server.settings.publish") : t("server.settings.published")}
              description={accessDescription()}
            />
            <Item class="server-settings-address-setting">
              <ItemContent>
                <ItemTitle>{t("server.settings.address")}</ItemTitle>
                <ItemDescription>{t("server.settings.addressDescription")}</ItemDescription>
              </ItemContent>
              <Show
                when={address()}
                fallback={
                  <Badge tone="neutral" size="md" shape="pill">
                    {t("server.settings.private")}
                  </Badge>
                }
              >
                {(serverAddress) => (
                  <CopyButton
                    value={serverAddress()}
                    label={truncateMiddle(serverAddress(), 31)}
                    copiedLabel={t("common.copied")}
                    aria-label={t("server.settings.copyAddress")}
                    title={serverAddress()}
                    onCopyError={showCopyError}
                    class="server-settings-address-control"
                  />
                )}
              </Show>
            </Item>
          </ItemGroup>
        </SettingsSection>
        <Show when={panels.offerRemoteDesktopSetup}>
          <ItemGroup class="settings-modal-card">
            <Item>
              <ItemContent>
                <ItemTitle>{t("server.settings.setUpDesktopTitle")}</ItemTitle>
                <ItemDescription>{t("server.settings.setUpDesktopDescription")}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button size="sm" variant="ghost" onClick={dismissRemoteDesktopSetup}>
                  {t("server.settings.later")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    dismissRemoteDesktopSetup();
                    setSection("desktop");
                  }}
                >
                  {t("server.settings.setUp")}
                </Button>
              </ItemActions>
            </Item>
          </ItemGroup>
        </Show>
        <Show when={props.onSetMuted && props.onSetNotificationLevel}>
          <SettingsSection title={t("server.settings.notifications")}>
            <ItemGroup class="settings-modal-card">
              <SwitchField
                class="server-settings-mute-setting"
                size="default"
                checked={props.server.notificationsMuted}
                disabled={Boolean(busy())}
                onChange={(value) => void run("mute", () => props.onSetMuted?.(value) ?? Promise.resolve())}
                label={t("server.settings.muteNotifications")}
                description={
                  props.server.notificationsMutedUntil === null
                    ? t("server.settings.muteDescription")
                    : t("server.settings.mutedUntilDescription", {
                        until: serverMuteDescription(props.server, t, format),
                      })
                }
              />
              <Item>
                <ItemContent>
                  <ItemTitle id="server-settings-notification-level-label">
                    {t("server.settings.notifyAbout")}
                  </ItemTitle>
                  <ItemDescription>{t("server.settings.notifyAboutDescription")}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Select<ServerNotificationLevel>
                    options={[...SERVER_NOTIFICATION_LEVELS]}
                    value={props.server.notificationLevel}
                    disabled={Boolean(busy())}
                    placement="bottom-end"
                    onChange={(level) => {
                      if (level)
                        void run(
                          "notification-level",
                          () => props.onSetNotificationLevel?.(level) ?? Promise.resolve(),
                        );
                    }}
                    itemComponent={(item) => (
                      <SelectItem item={item.item}>
                        {t(SERVER_NOTIFICATION_LEVEL_LABELS[item.item.rawValue])}
                      </SelectItem>
                    )}
                  >
                    <SelectTrigger size="sm" aria-labelledby="server-settings-notification-level-label">
                      <SelectValue<ServerNotificationLevel>>
                        {(state) => t(SERVER_NOTIFICATION_LEVEL_LABELS[state.selectedOption()])}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent mount={modalElement()} />
                  </Select>
                </ItemActions>
              </Item>
            </ItemGroup>
          </SettingsSection>
        </Show>
      </>
    );
  }

  function MembersPanel() {
    return (
      <>
        <Show when={!configured() || !published()}>
          <Alert class="server-settings-members-alert" tone="warning" role="status">
            <AlertIcon>
              <ShieldCheck />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>
                {configured() ? t("server.members.invitationsPaused") : t("server.members.setupRequired")}
              </AlertTitle>
              <AlertDescription>
                {configured() ? t("server.members.publishToInvite") : t("server.members.saveIdentityFirst")}
              </AlertDescription>
            </AlertContent>
          </Alert>
        </Show>
        <Show when={canManage()}>{inviteComposer()}</Show>
        <SettingsSection
          class="server-settings-members-section"
          title={t("server.members.title")}
          description={t("server.members.count", { count: activeMembers().length })}
          actions={
            <label class="server-settings-search">
              <Search aria-hidden="true" />
              <span class="sr-only">{t("server.members.search")}</span>
              <Input
                size="sm"
                type="search"
                placeholder={t("server.members.search")}
                value={panels.members.search}
                onValueChange={(value) =>
                  setPanels((state) => {
                    state.members.search = value;
                  })
                }
              />
            </label>
          }
        >
          <ItemGroup class="settings-modal-card server-settings-members-list">
            <Show
              when={filteredMembers().length > 0}
              fallback={
                <Item class="server-settings-empty-row">
                  <ItemContent>
                    <ItemDescription>{t("server.members.noMatch")}</ItemDescription>
                  </ItemContent>
                </Item>
              }
            >
              <For each={filteredMembers()}>{(member) => memberRow(member)}</For>
            </Show>
          </ItemGroup>
        </SettingsSection>
        <Show when={canManage() && inactiveLegacyMembers().length > 0}>
          <SettingsSection
            title={t("server.members.inactiveTitle")}
            description={t("server.members.inactiveDescription")}
          >
            <ItemGroup class="settings-modal-card server-settings-members-list">
              <For each={inactiveLegacyMembers()}>{(member) => memberRow(member)}</For>
            </ItemGroup>
          </SettingsSection>
        </Show>
        <Show when={canManage()}>{pendingInvites()}</Show>
      </>
    );
  }

  function inviteComposer() {
    return (
      <SlidingTabs.Root {...inviteTabsProps}>
        <SettingsSection
          class="server-settings-invite-section"
          title={t("server.invite.title")}
          description={t("server.invite.description")}
          actions={
            <SlidingTabs.List aria-label={t("server.invite.method")}>
              <SlidingTabs.Trigger value="email">{t("server.invite.email")}</SlidingTabs.Trigger>
              <SlidingTabs.Trigger value="link">{t("server.invite.link")}</SlidingTabs.Trigger>
              <Show when={permanentSupported()}>
                <SlidingTabs.Trigger value="perma">{t("server.invite.permaLink")}</SlidingTabs.Trigger>
              </Show>
            </SlidingTabs.List>
          }
        >
          <Card class="server-settings-invite-card">
            <div class="server-settings-invite-composer">
              <SlidingTabs.ContentSlot>
                <SlidingTabs.Content value="email" class="server-settings-invite-mode-panel">
                  <Field
                    class="server-settings-invite-email-field"
                    label={t("server.invite.emailAddress")}
                    error={panels.invite.emailError}
                  >
                    <Input
                      size="md"
                      type="email"
                      autocomplete="email"
                      maxlength={INPUT_LIMITS.email}
                      disabled={!published()}
                      placeholder={EMAIL_PLACEHOLDER}
                      value={panels.invite.email}
                      onValueChange={(value) =>
                        setPanels((state) => {
                          state.invite.email = value;
                          state.invite.emailError = null;
                        })
                      }
                      onBlur={() =>
                        panels.invite.email &&
                        !normalizeEmailAddress(panels.invite.email) &&
                        setPanels((state) => {
                          state.invite.emailError = t("server.invite.invalidEmail");
                        })
                      }
                    />
                  </Field>
                </SlidingTabs.Content>
                <SlidingTabs.Content value="link" class="server-settings-invite-mode-panel">
                  <Input
                    ref={(element) => (inviteLinkInput = element)}
                    class="server-settings-invite-link-input t-text-swap"
                    size="md"
                    readonly
                    aria-label={t("server.invite.linkLabel")}
                    placeholder={t("server.invite.linkPlaceholder")}
                    value={panels.invite.link}
                    title={panels.invite.link || undefined}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </SlidingTabs.Content>
                <SlidingTabs.Content value="perma" class="server-settings-invite-mode-panel">
                  <Input
                    class="server-settings-invite-link-input"
                    size="md"
                    readonly
                    aria-label={t("server.invite.permanentLink")}
                    placeholder={t("server.invite.linkPlaceholder")}
                    value={panels.invite.link}
                    title={panels.invite.link || undefined}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </SlidingTabs.Content>
              </SlidingTabs.ContentSlot>
              <Select<InviteRole>
                options={ROLE_OPTIONS}
                value={panels.invite.role}
                disabled={!published()}
                placement="bottom-end"
                onChange={(value) =>
                  value &&
                  setPanels((state) => {
                    state.invite.role = value;
                  })
                }
                itemComponent={(item) => <SelectItem item={item.item}>{t(ROLE_LABELS[item.item.rawValue])}</SelectItem>}
              >
                <SelectTrigger class="server-settings-role-select" size="sm" aria-label={t("server.invite.role")}>
                  <SelectValue<InviteRole>>{(state) => t(ROLE_LABELS[state.selectedOption()])}</SelectValue>
                </SelectTrigger>
                <SelectContent mount={modalElement()} />
              </Select>
              <Show
                when={
                  panels.invite.mode !== "email" && panels.invite.result && !panels.invite.result.email
                    ? panels.invite.result
                    : null
                }
                fallback={
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    loading={busy() === "invite"}
                    disabled={!canInvite()}
                    onClick={() => void createInvite()}
                  >
                    {panels.invite.mode === "email" ? t("server.invite.send") : t("server.invite.createLink")}
                  </Button>
                }
              >
                {(result) => (
                  <div class="server-settings-invite-share">
                    <Button
                      size="sm"
                      variant="ghost"
                      class="server-settings-invite-new-link"
                      aria-label={t("server.invite.createNewLinkLabel")}
                      title={t("server.invite.createNewLink")}
                      loading={busy() === "invite"}
                      disabled={!canInvite()}
                      onClick={() => void createInvite()}
                    >
                      <RefreshCw />
                      {t("server.invite.newLink")}
                    </Button>
                    <Show when={!inviteUsed() && !inviteExpired()}>
                      <CopyButton
                        class="server-settings-invite-copy"
                        value={result().inviteUrl}
                        label={t("server.invite.copyLink")}
                        copiedLabel={t("common.copied")}
                        size="sm"
                        variant="default"
                        onCopyError={showCopyError}
                      />
                      <Button
                        size="icon-sm"
                        variant="default"
                        aria-label={t("server.invite.showQr")}
                        aria-expanded={panels.invite.showQr ? "true" : "false"}
                        onClick={() =>
                          setPanels((state) => {
                            state.invite.showQr = !state.invite.showQr;
                          })
                        }
                      >
                        <ScanLine />
                      </Button>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
            <Show when={panels.invite.mode === "perma"}>
              <Text variant="caption" tone="muted" class="server-settings-perma-hint">
                {t("server.invite.permaHint")}
              </Text>
            </Show>
            <Show
              when={
                panels.invite.showQr &&
                !inviteUsed() &&
                !inviteExpired() &&
                panels.invite.mode !== "email" &&
                panels.invite.result
              }
            >
              {(result) => (
                <div class="server-settings-invite-qr">
                  <QrCode value={result().inviteUrl} label={t("server.invite.qrLabel")} />
                  <Text variant="caption" tone="muted">
                    {t("server.invite.qrDescription")}
                  </Text>
                </div>
              )}
            </Show>
            <Show when={panels.invite.result && !panels.invite.result.permanent ? panels.invite.result : null}>
              {(result) => (
                <Alert class="server-settings-invite-result" tone="success" role="status">
                  <AlertIcon>
                    <Check />
                  </AlertIcon>
                  <AlertContent>
                    <AlertTitle>
                      {inviteUsed()
                        ? t("server.invite.accepted")
                        : inviteExpired()
                          ? t("server.invite.expired")
                          : result().email
                            ? t("server.invite.sent")
                            : t("server.invite.linkReady")}
                    </AlertTitle>
                    <AlertDescription>
                      {inviteUsed()
                        ? t("server.invite.acceptedDescription")
                        : inviteExpired()
                          ? t("server.invite.expiredDescription")
                          : result().email || t("server.invite.linkReadyDescription")}
                    </AlertDescription>
                  </AlertContent>
                </Alert>
              )}
            </Show>
          </Card>
        </SettingsSection>
      </SlidingTabs.Root>
    );
  }

  function memberRow(member: TeamPresenceMember) {
    return (
      <Item class="server-settings-member-row" data-disabled={member.disabled ? "" : undefined}>
        <ItemContent>
          <ItemTitle>{teamMemberName(member)}</ItemTitle>
          <ItemDescription class="server-settings-member-meta">{member.email ?? member.username}</ItemDescription>
        </ItemContent>
        <ItemActions class="server-settings-member-actions">
          <Show when={member.role !== "owner"} fallback={<Badge tone="accent">{t(ROLE_LABELS.owner)}</Badge>}>
            <Text variant="label-sm" tone="secondary">
              {t(ROLE_LABELS[member.role])}
            </Text>
            <Show when={canManage() && actionsAvailable()}>
              <MemberActionsMenu
                member={member}
                mount={modalElement()}
                onRoleChange={(role) =>
                  void run(`member:${member.id}`, () => props.onUpdateMember({ memberId: member.id, role }))
                }
                onRemove={(trigger) => {
                  // The confirmation returns focus to the element focused when it opens.
                  trigger.focus({ preventScroll: true });
                  setPanels((state) => {
                    state.members.removeId = member.id;
                  });
                }}
              />
            </Show>
          </Show>
        </ItemActions>
      </Item>
    );
  }

  function pendingInvites() {
    return (
      <SettingsSection
        title={t("server.invite.pendingTitle")}
        actions={
          <Text variant="caption" tone="muted">
            {t("server.invite.pendingCount", { total: activeInvites().length })}
          </Text>
        }
      >
        <ItemGroup class="settings-modal-card server-settings-invites-list">
          <Show
            when={activeInvites().length > 0}
            fallback={
              <Item class="server-settings-empty-row">
                <ItemContent>
                  <ItemDescription>{t("server.invite.noPending")}</ItemDescription>
                </ItemContent>
              </Item>
            }
          >
            <For each={activeInvites()}>
              {(invite) => (
                <Item class="server-settings-invite-row">
                  <ItemContent>
                    <ItemTitle>
                      {invite.email ??
                        (invite.permanent ? t("server.invite.permanentLink") : t("server.invite.privateLink"))}
                    </ItemTitle>
                    <ItemDescription>
                      {t(ROLE_LABELS[invite.role])} ·{" "}
                      {invite.permanent
                        ? t("server.invite.neverExpires", { count: invite.useCount })
                        : t("server.invite.expires", {
                            date: format.date(new Date(invite.expiresAt), {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }),
                          })}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive-ghost"
                      disabled={!actionsAvailable() || Boolean(busy())}
                      onClick={() => void run(`invite:${invite.id}`, () => props.onRevokeInvite(invite.id))}
                    >
                      {t("server.invite.revoke")}
                    </Button>
                  </ItemActions>
                </Item>
              )}
            </For>
          </Show>
        </ItemGroup>
      </SettingsSection>
    );
  }

  function DesktopPanel() {
    return (
      <SettingsSection title={t("server.desktop.accessTitle")}>
        <RemoteDesktopSetup server={props.server} platform={props.platform} />
        <ItemGroup class="settings-modal-card server-settings-desktop-card">
          <Show when={local()} fallback={remoteDesktopConnection()}>
            <Item size="spacious">
              <ItemMedia class="server-settings-desktop-icon">
                <Monitor />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{REMOTE_HOST_GATEWAY_NAME}</ItemTitle>
                <ItemDescription class="server-settings-desktop-description">
                  {t("server.desktop.gatewayDescription")}
                </ItemDescription>
              </ItemContent>
              <ItemActions class="server-settings-desktop-meta">
                <Badge tone={props.hostStatus?.remoteDesktopReady ? "success" : "warning"} shape="pill">
                  {props.hostStatus?.remoteDesktopReady
                    ? t("server.desktop.componentInstalled")
                    : t("server.desktop.componentNotInstalled")}
                </Badge>
                <Text as="span" variant="caption" tone="muted">
                  {t("server.desktop.sessions", {
                    unattended: props.hostStatus?.remoteDesktopUnattended
                      ? t("server.desktop.unattendedEnabled")
                      : t("server.desktop.unattendedUnavailable"),
                    active: props.hostStatus?.remoteDesktopActiveSessions ?? 0,
                    max: props.hostStatus?.remoteDesktopMaxSessions ?? 4,
                  })}
                </Text>
              </ItemActions>
            </Item>
          </Show>
        </ItemGroup>
      </SettingsSection>
    );
  }

  function remoteDesktopConnection() {
    const status = () => {
      const server = props.server;
      if (server.issue) {
        return {
          title: t(ISSUE_TITLES[server.issue.code]),
          message: sourceText(server.issue.message),
          available: false,
        };
      }
      if (server.state !== "online") {
        return {
          title: t("server.desktop.hostOffline"),
          message: t("server.desktop.hostOfflineDescription"),
          available: false,
        };
      }
      if (!serverSupportsCapability(server, "remote-desktop")) {
        return {
          title: t("server.desktop.hostUpdateRequired"),
          message: t("server.desktop.hostUpdateDescription"),
          available: false,
        };
      }
      return server.remoteDesktopAvailable
        ? {
            title: t("server.desktop.serviceAvailable"),
            message: t("server.desktop.serviceAvailableDescription"),
            available: true,
          }
        : {
            title: t("server.desktop.serviceNotReady"),
            message: t("server.desktop.serviceNotReadyDescription"),
            available: false,
          };
    };
    return (
      <Item size="spacious">
        <ItemMedia class="server-settings-desktop-icon">
          <Monitor />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t("server.desktop.remoteControl")}</ItemTitle>
          <ItemDescription class="server-settings-desktop-description">{status().message}</ItemDescription>
          <Badge class="server-settings-desktop-status" tone={status().available ? "success" : "warning"} shape="pill">
            {status().title}
          </Badge>
        </ItemContent>
        <ItemActions class="server-settings-desktop-hint">
          <Text as="span" variant="caption" tone="muted">
            {t("server.desktop.startHint")}
          </Text>
        </ItemActions>
      </Item>
    );
  }

  function accessDescription() {
    if (!local()) return published() ? t("server.settings.remoteOnline") : t("server.settings.remoteOffline");
    if (!configured()) return t("server.settings.saveIdentityFirst");
    return published() ? t("server.settings.reachable") : t("server.settings.notReachable");
  }
}

function ServerLogo(props: { name: string; url: string | null }) {
  const [failed, setFailed] = createSignal(false);
  createEffect(
    () => props.url,
    () => {
      setFailed(false);
    },
  );
  return (
    <span class="server-settings-logo" aria-hidden="true">
      <Show when={!failed() ? props.url : null} fallback={<span>{initials(props.name)}</span>}>
        {(url) => <img src={url()} alt="" draggable={false} onError={() => setFailed(true)} />}
      </Show>
    </span>
  );
}

function MemberActionsMenu(props: {
  member: TeamPresenceMember;
  mount: HTMLElement | undefined;
  onRoleChange: (role: InviteRole) => void;
  onRemove: (trigger: HTMLElement) => void;
}) {
  const { t } = useText();
  const name = () => teamMemberName(props.member);
  let triggerElement: HTMLElement | undefined;
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
      <DropdownMenu.Trigger
        ref={(element) => (triggerElement = element)}
        class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button server-settings-member-menu-trigger`}
        aria-label={t("server.members.actionsFor", { name: name() })}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.mount}>
        <DropdownMenu.Content class="server-settings-member-menu">
          <Show when={!props.member.disabled}>
            <DropdownMenu.Item onSelect={() => props.onRoleChange(props.member.role === "admin" ? "member" : "admin")}>
              {props.member.role === "admin" ? <UserRound aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              {props.member.role === "admin" ? t("server.members.makeMember") : t("server.members.makeAdmin")}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
          </Show>
          <DropdownMenu.Item
            class="ui-action-menu-danger"
            onSelect={() => triggerElement && props.onRemove(triggerElement)}
          >
            <Trash2 aria-hidden="true" />
            {t("server.members.remove")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  return (
    (parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : value.trim().slice(0, 2)).toUpperCase() || "OB"
  );
}
