import type {
  AvatarImageInput,
  HostedSitesDesktopApi,
  HostStatus,
  InviteSummary,
  ServerNotificationLevel,
  ServerSummary,
  TeamInviteSummary,
  TeamPresenceMember,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { classifyFailure } from "@openbot/telemetry";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  AppWindow,
  ArrowLeftRight,
  Blocks,
  Button,
  CalendarClock,
  ChevronRight,
  Download,
  Globe2,
  HardDrive,
  KeyRound,
  Monitor,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Tabs,
  Text,
  UsersRound,
} from "@openbot/ui";
import type { LicenseCalls } from "@openbot/ui/features/billing/license-store";
import type { ProviderSettingsDetail } from "@openbot/ui/features/settings/ProviderSettingsPage";
import {
  SaveBarDock,
  SettingsDialogShell,
  type SettingsPagePlacement,
} from "@openbot/ui/features/settings/SettingsDialogShell";
import { SettingsHostedSitesTab } from "@openbot/ui/features/settings/SettingsHostedSitesTab";
import {
  createSettingsHostedSitesStore,
  type HostedSiteDeleteResult,
} from "@openbot/ui/features/settings/stores/hosted-sites-store";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { type ServerBrowserProfilesOptions, ServerBrowserProfilesPanel } from "../browser/ServerBrowserProfilesPanel";
import { type ServerStorageOptions, ServerStoragePanel } from "../files/ServerStoragePanel";
import { type HostProviderSettings, HostProviderSettingsPanel } from "../settings/ProviderSettingsSection";
import type { HostPromptCacheTtlOptions, ProviderPromptCacheSource } from "../settings/provider-prompt-cache";
import { type ServerVaultOptions, ServerVaultPanel } from "../vault/ServerVaultPanel";
import type { McpServerConfig, McpTestResult } from "./mcp-servers";
import { ServerDesktopPanel } from "./ServerDesktopPanel";
import { createServerGeneralSection } from "./ServerGeneralSection";
import { type ServerImportDetail, type ServerImportOptions, ServerImportPanel } from "./ServerImportPanel";
import { type McpPanelDetail, type McpPanelSignIn, ServerMcpPanel } from "./ServerMcpPanel";
import { createServerMembersSection } from "./ServerMembersSection";
import type { ServerMemoryLimitOptions } from "./ServerMemoryLimitSetting";
import type { ServerMemoryReviewOptions } from "./ServerMemoryReviewSetting";
import { createServerRolesSection, type ServerAgentAccessOptions } from "./ServerRolesSection";
import { type ServerRoutineFeedOptions, ServerRoutineFeedPanel } from "./ServerRoutineFeedPanel";
import type { ServerTimezoneOptions } from "./ServerTimezoneSetting";
import { type ServerTransferOptions, ServerTransferPanel } from "./ServerTransferPanel";
import { type ServerUpdateOptions, ServerUpdatePanel } from "./ServerUpdatePanel";
import { serverCanAdminister, serverRoleCanAdminister } from "./server-capabilities";
import type { ServerSettingsSectionHost } from "./server-settings-section";

export interface ServerSettingsModalProps {
  open: boolean;
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
  /**
   * Changes the key of the server on this computer, and paired devices follow it. The Server key
   * section appears only when a caller supplies this.
   */
  onRotateHostKey?: (() => Promise<void>) | undefined;
  /** The Notifications section appears only when a caller supplies both: they are desktop notifications. */
  onSetMuted?: (muted: boolean) => Promise<void>;
  onSetNotificationLevel?: (level: ServerNotificationLevel) => Promise<void>;
  onCreateInvite: (input: { role: "admin" | "member"; email?: string; permanent?: boolean }) => Promise<InviteSummary>;
  /**
   * The license of the signed-in account. When the owner invites a person to a full license, the
   * Members section first asks to add a user to it. Absent on surfaces with no account license.
   */
  license?: Pick<LicenseCalls, "getState" | "setUsers" | "changePlan"> | undefined;
  /** Opens the contact page when a full license already has the most users that the app sells. */
  onContactUs?: () => void;
  onUpdateMember: (input: UpdateTeamMemberInput) => Promise<void>;
  onRemoveMember: (memberId: string) => Promise<void>;
  onRevokeInvite: (inviteId: string) => Promise<void>;
  /**
   * Ends this account's membership of a joined server. The Leave section appears only when a
   * caller supplies this: the browser client is attached to one host and cannot leave it.
   */
  onLeaveServer?: () => Promise<void>;
  /**
   * Removes a server that the user owns from the account service, also when its host is offline.
   * The Remove section appears only when a caller supplies this.
   */
  onRemoveServer?: (() => Promise<void>) | undefined;
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
  /** Browser sign-in for http MCP servers. Only the server on this computer gets it. */
  mcpSignIn?: McpPanelSignIn | undefined;
  /** An MCP row to sign in to when the list holds it: the user pressed Sign in on an agent's card. */
  mcpSignInRequest?: string | null | undefined;
  onMcpSignInRequestHandled?: (() => void) | undefined;
  /** Opens the MCP form for a new server once the section shows. */
  mcpAddRequest?: boolean | undefined;
  onMcpAddRequestHandled?: (() => void) | undefined;
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
   * The Sites section appears only when a caller supplies this: this computer, or a remote host with
   * `hosted-sites-v1`. Every member reads the list; an owner or admin can delete.
   */
  hostedSites?: ServerHostedSitesOptions | undefined;
  /**
   * The Providers section: this computer, or a remote host with `providers-v1` that this account
   * administers. A member gets no section.
   */
  providers?: HostProviderSettings | undefined;
  /**
   * For a server that the window has not selected. The provider state belongs to the selected server,
   * so the Providers section shows a note and this action in place of the list.
   */
  onSwitchToManageProviders?: (() => void) | undefined;
  /**
   * The Import section appears only when a caller supplies this: the local server, or a remote host
   * with `agent-import-v1`. Any member can import.
   */
  agentImport?: ServerImportOptions | undefined;
  /**
   * The Transfer section appears only when a caller supplies this: the local server, or a remote
   * host with `instance-transfer-v1` where the user is an owner or admin.
   */
  instanceTransfer?: ServerTransferOptions | undefined;
  /**
   * The Updates section appears only when a caller supplies this: a remote host with
   * `host-update-v1` that this member administers.
   */
  hostUpdate?: ServerUpdateOptions | undefined;
  /**
   * General shows the server timezone only when a caller supplies this, and only for the local
   * server or a remote host with `host-timezone-v1` that this member administers.
   */
  hostTimezone?: ServerTimezoneOptions | undefined;
  /**
   * General shows how many memories each agent keeps only when a caller supplies this, and only for
   * the local server or a remote host with `agent-memory-limit-v1` that this member administers.
   */
  hostMemoryLimit?: ServerMemoryLimitOptions | undefined;
  /**
   * General shows how often the agents review their memories only when a caller supplies this, and
   * only for the local server or a remote host with `memory-review-v1` that this member administers.
   */
  memoryReview?: ServerMemoryReviewOptions | undefined;
  /**
   * The Claude provider page shows how long Claude keeps the prompt cache only when a caller supplies
   * this, and only for the local server or a remote host with `prompt-cache-ttl-v1` that this member
   * administers.
   */
  hostPromptCacheTtl?: HostPromptCacheTtlOptions | undefined;
  /**
   * The Roles section appears only when a caller supplies this, and only for the local server or a
   * remote host with `agent-access-v1` that this member administers.
   */
  agentAccess?: ServerAgentAccessOptions | undefined;
  /**
   * The Routines section appears only when a caller supplies this: the feed listens on this
   * computer, so a remote server passes nothing.
   */
  routineFeed?: ServerRoutineFeedOptions | undefined;
  /**
   * The Browser profiles section appears only when a caller supplies this: for this computer, and for
   * a host that serves `browser-profiles-v1` to an owner or admin.
   */
  browserProfiles?: ServerBrowserProfilesOptions | undefined;
  /** The Vault section: this computer, or a joined server that serves `vault-v1` to an owner or admin. */
  vault?: ServerVaultOptions | undefined;
  /** The section to show when the dialog opens. Updates shows General when the server has no Updates section. */
  initialSection?: ServerSettingsSection | null;
  /** Where the settings page shows, or nothing while the page is not on screen. */
  page: SettingsPagePlacement | undefined;
}

export interface ServerHostedSitesOptions {
  /** Called with this dialog's server. */
  api: Pick<HostedSitesDesktopApi, "list" | "delete">;
  onOpenSite: (url: string) => void;
  /** Called as a deletion starts. It returns the call that records the result. */
  trackDelete?: () => (result: HostedSiteDeleteResult) => void;
}

export type ServerSettingsSection =
  | "general"
  | "vault"
  | "members"
  | "roles"
  | "desktop"
  | "mcp"
  | "storage"
  | "sites"
  | "providers"
  | "updates"
  | "import"
  | "transfer"
  | "routines"
  | "browser-profiles";
type Section = ServerSettingsSection;

const sections = {
  general: { title: "server.settings.generalTitle", description: "server.settings.generalDescription" },
  vault: { title: "server.settings.vaultTitle", description: "server.settings.vaultDescription" },
  members: { title: "server.settings.membersTitle", description: "server.settings.membersDescription" },
  roles: { title: "server.settings.rolesTitle", description: "server.settings.rolesDescription" },
  desktop: { title: "server.settings.desktopTitle", description: "server.settings.desktopDescription" },
  mcp: { title: "server.settings.mcpTitle", description: "server.settings.mcpDescription" },
  storage: { title: "server.settings.storageTitle", description: "server.settings.storageDescription" },
  sites: { title: "server.settings.hostedSitesTitle", description: "server.settings.hostedSitesDescription" },
  providers: { title: "server.settings.providersTitle", description: "server.settings.providersDescription" },
  updates: { title: "server.settings.updatesTitle", description: "server.settings.updatesDescription" },
  import: { title: "server.settings.importTitle", description: "server.settings.importDescription" },
  transfer: { title: "server.settings.transferTitle", description: "server.settings.transferDescription" },
  routines: { title: "server.settings.routinesTitle", description: "server.settings.routinesDescription" },
  "browser-profiles": { title: "browser.profiles.title", description: "browser.profiles.subtitle" },
} as const satisfies Record<Section, { title: AppTextKey; description: AppTextKey }>;

export function ServerSettingsModal(props: ServerSettingsModalProps) {
  const { t, errorMessage } = useText();
  const [section, setSection] = createSignal<Section>("general");
  /** Set while the MCP panel shows a form, so the header reads `MCP › Connect to a custom MCP`. */
  const [mcpDetail, setMcpDetail] = createSignal<McpPanelDetail | null>(null);
  /** Set while a provider page is open, so the header reads `Providers › Codex`. */
  const [providerDetail, setProviderDetail] = createSignal<ProviderSettingsDetail | null>(null);
  /** Set while an import source is open, so the header reads `Import › Hermes Agent`. */
  const [importDetail, setImportDetail] = createSignal<ServerImportDetail | null>(null);
  const crumbDetail = () => {
    if (section() === "mcp") return mcpDetail();
    if (section() === "import") return importDetail();
    if (section() === "roles") return roles.crumb();
    return section() === "providers" ? providerDetail() : null;
  };
  /** The key of the one action in flight, gating every panel at once rather than belonging to any. */
  const [busy, setBusy] = createSignal<string | null>(null);
  const [modalElement, setModalElement] = createSignal<HTMLElement | undefined>();
  /**
   * The height of the error toast, or 0 while no toast is shown. The panel reserves this much
   * room at its end: the toast floats over the bottom of the panel, so without the reserve it
   * covers - and swallows the clicks of - whatever the open panel puts last.
   */
  const [toastHeight, setToastHeight] = createSignal(0);
  let syncedServerId = "";

  const local = () => props.server.kind === "local";
  const remoteDesktopSection = () => props.remoteDesktopSupported !== false && props.platform === "darwin";
  const configured = () => (local() ? Boolean(props.hostStatus?.configured) : true);
  /**
   * The role check without `configured()`. MCP servers belong to this machine and are spawned
   * by the agents on it, so they are manageable before the user publishes a Team API host at all.
   */
  const canManageMcp = () => serverRoleCanAdminister(props.server);
  const actionsAvailable = () => local() || props.server.state === "online";
  function promptCacheSource(): ProviderPromptCacheSource | undefined {
    const options = props.hostPromptCacheTtl;
    if (!options || !actionsAvailable() || !serverCanAdminister(props.server, "prompt-cache-ttl-v1")) return undefined;
    return { ...options, serverId: props.server.id };
  }
  const availableInitialSection = (): Section | null =>
    props.initialSection === "updates" && !props.hostUpdate ? null : (props.initialSection ?? null);
  const published = () => (local() ? props.hostStatus?.phase === "online" : props.server.state === "online");

  async function run(key: string, action: () => Promise<void>): Promise<boolean> {
    if (busy()) return false;
    setBusy(key);
    try {
      await action();
      return true;
    } catch (error) {
      actionToast.error(t("server.settings.actionFailedTitle"), {
        ...{
          description: errorMessage(error, t("server.settings.actionFailed")),
        },
        report: { operation: "settings", source: "action", cause_code: classifyFailure(error) },
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const host: ServerSettingsSectionHost = {
    props,
    local,
    configured,
    published,
    actionsAvailable,
    menuMount: modalElement,
    busy,
    run,
    showCopyError() {
      actionToast.error(t("server.settings.copyFailedTitle"), {
        ...{ description: t("server.settings.copyFailed") },
        report: { operation: "settings", source: "action", cause_code: "unknown" },
      });
    },
  };
  const general = createServerGeneralSection(host);
  const roles = createServerRolesSection(host, () => section() === "roles" || section() === "members");
  const members = createServerMembersSection(
    host,
    {
      onSetUpDesktop: () => setSection("desktop"),
      saveIdentityDraft: general.saveIdentityDraft,
    },
    roles,
  );
  const hostedSites = createSettingsHostedSitesStore(
    {
      get open() {
        return props.open;
      },
      get serverId() {
        return props.server.id;
      },
      get hostedSitesApi() {
        return props.hostedSites?.api;
      },
      get trackDelete() {
        return props.hostedSites?.trackDelete;
      },
    },
    () => section() === "sites",
  );

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
    (section() === "general" && general.identityDirty()) || (section() === "mcp" && Boolean(mcpDetail()?.saveBar()));

  createEffect(
    () => ({
      open: props.open,
      id: props.server.id,
      name: props.server.kind === "local" && !props.hostStatus?.configured ? "" : props.server.name,
      logoUrl: props.server.logoUrl,
      editing: general.editing(),
    }),
    ({ open, id, name, logoUrl, editing }) => {
      if (!open) return;
      if (syncedServerId !== id) {
        syncedServerId = id;
        setSection(untrack(availableInitialSection) ?? "general");
        general.resetForServer();
        members.resetForServer();
        roles.resetForServer();
      }
      if (!editing) general.syncFromServer(name, logoUrl);
    },
  );

  /** Roles leaves with the access that gives it: a host that goes offline or a role that changes. */
  createEffect(
    () => section() === "roles" && !roles.available(),
    (gone) => {
      if (gone) setSection("members");
    },
  );

  /** A server with no Vault for this account has no Vault section. */
  createEffect(
    () => section() === "vault" && !props.vault,
    (gone) => {
      if (gone) setSection("general");
    },
  );

  /** An opener that names a section of the same server moves to it; the effect above covers a new server. */
  createEffect(
    () => (props.open ? availableInitialSection() : null),
    (requested) => {
      if (requested) setSection(requested);
    },
  );

  createEffect(
    () => props.open && section() === "providers" && props.providers !== undefined,
    (visible) => {
      if (visible) untrack(() => props.providers?.onShown?.());
    },
  );

  /** The latch keeps a section the user is already in from being reported again on every change. */
  let mcpSectionVisible = false;
  createEffect(
    () => props.open && section() === "mcp" && Boolean(props.mcpServers),
    (visible) => {
      if (visible === mcpSectionVisible) return;
      mcpSectionVisible = visible;
      if (visible) untrack(() => props.onMcpSectionShown?.());
    },
  );

  const sectionTabsProps = {
    get value() {
      return section();
    },
    orientation: "vertical" as const,
    activationMode: "automatic" as const,
    onChange(value: string) {
      if (
        value === "general" ||
        value === "vault" ||
        value === "members" ||
        value === "roles" ||
        value === "desktop" ||
        value === "mcp" ||
        value === "storage" ||
        value === "sites" ||
        value === "providers" ||
        value === "updates" ||
        value === "import" ||
        value === "transfer" ||
        value === "routines" ||
        value === "browser-profiles"
      )
        setSection(value);
    },
  };

  return (
    <Tabs.Root {...sectionTabsProps} class="settings-modal-tabs-root">
      <SettingsDialogShell
        class="server-settings-modal-shell"
        page={props.page}
        open={props.open}
        title={
          <Show when={crumbDetail()} fallback={t(sections[section()].title)}>
            {(detail) => (
              <span class="settings-modal-crumbs">
                <Button type="button" variant="ghost" class="settings-modal-crumb-parent" onClick={detail().back}>
                  {t(sections[section()].title)}
                </Button>
                <ChevronRight class="settings-modal-crumb-separator" aria-hidden="true" />
                <span class="settings-modal-crumb-current">{detail().title}</span>
              </span>
            )}
          </Show>
        }
        description={t(sections[section()].description)}
        contentKey={`${props.server.id}:${section()}`}
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
            <SaveBarDock value={section() === "general" && general.identityDirty() ? true : null}>
              {() => (
                <section class="settings-modal-save-bar" aria-label={t("server.settings.unsavedChanges")}>
                  <Text variant="caption" tone="muted">
                    {t("server.settings.changesNotSaved")}
                  </Text>
                  <div class="settings-modal-save-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(busy())}
                      onClick={general.resetIdentity}
                    >
                      {t("server.settings.reset")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      loading={busy() === "identity"}
                      loadingLabel={t("common.saving")}
                      disabled={Boolean(busy())}
                      onClick={() => void general.saveIdentity()}
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
            <Show when={props.vault}>
              <Tabs.Trigger class="settings-modal-nav-item" value="vault">
                <KeyRound aria-hidden="true" />
                <span>{t(sections.vault.title)}</span>
              </Tabs.Trigger>
            </Show>
            <Tabs.Trigger class="settings-modal-nav-item" value="members">
              <UsersRound aria-hidden="true" />
              <span>{t(sections.members.title)}</span>
            </Tabs.Trigger>
            <Show when={roles.available()}>
              <Tabs.Trigger class="settings-modal-nav-item" value="roles">
                <ShieldCheck aria-hidden="true" />
                <span>{t(sections.roles.title)}</span>
              </Tabs.Trigger>
            </Show>
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
            <Show when={props.hostedSites}>
              <Tabs.Trigger class="settings-modal-nav-item" value="sites">
                <Globe2 aria-hidden="true" />
                <span>{t(sections.sites.title)}</span>
              </Tabs.Trigger>
            </Show>
            <Show when={props.providers || props.onSwitchToManageProviders}>
              <Tabs.Trigger class="settings-modal-nav-item" value="providers">
                <Sparkles aria-hidden="true" />
                <span>{t(sections.providers.title)}</span>
              </Tabs.Trigger>
            </Show>
            <Show when={props.hostUpdate}>
              <Tabs.Trigger class="settings-modal-nav-item" value="updates">
                <RefreshCw aria-hidden="true" />
                <span>{t(sections.updates.title)}</span>
              </Tabs.Trigger>
            </Show>
            <Show when={props.agentImport}>
              <Tabs.Trigger class="settings-modal-nav-item" value="import">
                <Download aria-hidden="true" />
                <span>{t(sections.import.title)}</span>
              </Tabs.Trigger>
            </Show>
            <Show when={props.instanceTransfer}>
              <Tabs.Trigger class="settings-modal-nav-item" value="transfer">
                <ArrowLeftRight aria-hidden="true" />
                <span>{t(sections.transfer.title)}</span>
              </Tabs.Trigger>
            </Show>
            <Show when={props.routineFeed}>
              <Tabs.Trigger class="settings-modal-nav-item" value="routines">
                <CalendarClock aria-hidden="true" />
                <span>{t(sections.routines.title)}</span>
              </Tabs.Trigger>
            </Show>
            <Show when={props.browserProfiles}>
              <Tabs.Trigger class="settings-modal-nav-item" value="browser-profiles">
                <AppWindow aria-hidden="true" />
                <span>{t(sections["browser-profiles"].title)}</span>
              </Tabs.Trigger>
            </Show>
          </Tabs.List>
        }
      >
        <Tabs.Content value="general" class="settings-modal-tab-panel server-settings-panel" data-tab="general">
          <general.Panel />
        </Tabs.Content>
        <Show when={props.vault}>
          {(vault) => (
            <Tabs.Content value="vault" class="settings-modal-tab-panel server-settings-panel" data-tab="vault">
              <ServerVaultPanel {...vault()} menuMount={modalElement()} />
            </Tabs.Content>
          )}
        </Show>
        <Tabs.Content value="members" class="settings-modal-tab-panel server-settings-panel" data-tab="members">
          <members.Panel />
        </Tabs.Content>
        <Show when={roles.available()}>
          <Tabs.Content value="roles" class="settings-modal-tab-panel server-settings-panel" data-tab="roles">
            <roles.Panel />
          </Tabs.Content>
        </Show>
        <Show when={remoteDesktopSection()}>
          <Tabs.Content value="desktop" class="settings-modal-tab-panel server-settings-panel" data-tab="desktop">
            <ServerDesktopPanel server={props.server} platform={props.platform} hostStatus={props.hostStatus} />
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
                signIn={props.mcpSignIn}
                signInRequest={props.mcpSignInRequest}
                onSignInRequestHandled={props.onMcpSignInRequestHandled}
                addRequest={props.mcpAddRequest}
                onAddRequestHandled={props.onMcpAddRequestHandled}
              />
            </Tabs.Content>
          )}
        </Show>
        {/* Mounted only while selected, so the host is measured when the section opens. */}
        <Show when={props.storage}>
          {(storage) => (
            <Tabs.Content value="storage" class="settings-modal-tab-panel server-settings-panel" data-tab="storage">
              <ServerStoragePanel serverId={props.server.id} members={props.members} {...storage()} />
            </Tabs.Content>
          )}
        </Show>
        <Show when={props.hostedSites}>
          {(sites) => (
            <Tabs.Content value="sites" class="settings-modal-tab-panel server-settings-panel" data-tab="sites">
              <SettingsHostedSitesTab
                store={hostedSites}
                available
                canDelete={serverRoleCanAdminister(props.server)}
                onOpenSite={sites().onOpenSite}
              />
            </Tabs.Content>
          )}
        </Show>
        <Show when={props.providers || props.onSwitchToManageProviders}>
          <Tabs.Content value="providers" class="settings-modal-tab-panel server-settings-panel" data-tab="providers">
            <Show
              when={props.providers}
              fallback={
                <Alert>
                  <AlertIcon>
                    <Sparkles />
                  </AlertIcon>
                  <AlertContent>
                    <AlertDescription>
                      {t("server.settings.providersSwitchNote", { name: props.server.name })}
                    </AlertDescription>
                  </AlertContent>
                  <AlertActions>
                    <Button type="button" size="sm" onClick={() => props.onSwitchToManageProviders?.()}>
                      {t("server.settings.providersSwitch")}
                    </Button>
                  </AlertActions>
                </Alert>
              }
            >
              {(providers) => (
                <HostProviderSettingsPanel
                  {...providers()}
                  hostName={local() ? undefined : props.server.name}
                  selectMount={modalElement()}
                  onDetailChange={setProviderDetail}
                  promptCache={promptCacheSource()}
                />
              )}
            </Show>
          </Tabs.Content>
        </Show>
        <Show when={props.hostUpdate}>
          {(hostUpdate) => (
            <Tabs.Content value="updates" class="settings-modal-tab-panel server-settings-panel" data-tab="updates">
              <ServerUpdatePanel
                {...hostUpdate()}
                serverId={props.server.id}
                hostName={props.server.name}
                actionsAvailable={actionsAvailable()}
              />
            </Tabs.Content>
          )}
        </Show>
        <Show when={props.agentImport}>
          {(agentImport) => (
            <Tabs.Content value="import" class="settings-modal-tab-panel server-settings-panel" data-tab="import">
              {/* Keyed: an open export belongs to one server, so another server starts a new panel. */}
              <Show when={props.server.id} keyed>
                {(serverId) => (
                  <ServerImportPanel
                    serverId={serverId}
                    {...agentImport()}
                    hermes={local()}
                    onOpenTransfer={props.instanceTransfer ? () => setSection("transfer") : undefined}
                    onDetailChange={setImportDetail}
                  />
                )}
              </Show>
            </Tabs.Content>
          )}
        </Show>
        <Show when={props.instanceTransfer}>
          {(instanceTransfer) => (
            <Tabs.Content value="transfer" class="settings-modal-tab-panel server-settings-panel" data-tab="transfer">
              {/* Keyed: an open file belongs to one server, so another server starts a new panel. */}
              <Show when={props.server.id} keyed>
                {(serverId) => <ServerTransferPanel serverId={serverId} {...instanceTransfer()} />}
              </Show>
            </Tabs.Content>
          )}
        </Show>
        <Show when={props.routineFeed}>
          {(routineFeed) => (
            <Tabs.Content value="routines" class="settings-modal-tab-panel server-settings-panel" data-tab="routines">
              <ServerRoutineFeedPanel
                {...routineFeed()}
                busy={busy}
                run={run}
                menuMount={modalElement}
                showCopyError={host.showCopyError}
              />
            </Tabs.Content>
          )}
        </Show>
        <Show when={props.browserProfiles}>
          {(browserProfiles) => (
            <Tabs.Content
              value="browser-profiles"
              class="settings-modal-tab-panel server-settings-panel"
              data-tab="browser-profiles"
            >
              <ServerBrowserProfilesPanel {...browserProfiles()} menuMount={modalElement()} />
            </Tabs.Content>
          )}
        </Show>
      </SettingsDialogShell>

      <members.ConfirmDialogs />
      <general.LeaveDialog />
      <general.RotateKeyDialog />
    </Tabs.Root>
  );
}
