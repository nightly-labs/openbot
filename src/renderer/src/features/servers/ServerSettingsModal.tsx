import type {
  AvatarImageInput,
  HostStatus,
  InviteSummary,
  ServerNotificationLevel,
  ServerSummary,
  TeamInviteSummary,
  TeamPresenceMember,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Blocks,
  Button,
  ChevronRight,
  Download,
  HardDrive,
  Monitor,
  Plug,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Tabs,
  Text,
  toast,
  UsersRound,
} from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { SaveBarDock, SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";
import { ConnectorsPanel } from "../connectors/ConnectorsPanel";
import type { GitHubConnectorController } from "../connectors/github-connector";
import type { SlackConnectorController } from "../connectors/slack-connector";
import { type ServerStorageOptions, ServerStoragePanel } from "../files/ServerStoragePanel";
import { type HostProviderSettings, HostProviderSettingsPanel } from "../settings/ProviderSettingsSection";
import type { McpServerConfig, McpTestResult } from "./mcp-servers";
import { ServerDesktopPanel } from "./ServerDesktopPanel";
import { createServerGeneralSection } from "./ServerGeneralSection";
import { type ServerImportOptions, ServerImportPanel } from "./ServerImportPanel";
import { type McpPanelDetail, ServerMcpPanel } from "./ServerMcpPanel";
import { createServerMembersSection } from "./ServerMembersSection";
import { type ServerUpdateOptions, ServerUpdatePanel } from "./ServerUpdatePanel";
import { serverRoleCanAdminister } from "./server-capabilities";
import type { ServerSettingsSectionHost } from "./server-settings-section";

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
  /**
   * Ends this account's membership of a joined server. The Leave section appears only when a
   * caller supplies this: the browser client is attached to one host and cannot leave it.
   */
  onLeaveServer?: () => Promise<void>;
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
  /**
   * The Import section appears only when a caller supplies this: the local server, or a remote host
   * with `agent-import-v1`. Any member can import.
   */
  agentImport?: ServerImportOptions | undefined;
  /**
   * The Connectors section appears only when a caller supplies one of these: the GitHub connection
   * and the Slack apps belong to this computer, so a remote server passes neither, and a build
   * without a GitHub App passes no GitHub.
   */
  githubConnector?: GitHubConnectorController | undefined;
  slackConnector?: SlackConnectorController | undefined;
  /** This computer's agents, for the Slack page. */
  connectorAgents?: AgentProfile[] | undefined;
  /**
   * The Updates section appears only when a caller supplies this: a remote host with
   * `host-update-v1` that this member administers.
   */
  hostUpdate?: ServerUpdateOptions | undefined;
  /** The section to show when the dialog opens. Updates shows General when the server has no Updates section. */
  initialSection?: ServerSettingsSection | null;
}

export type ServerSettingsSection =
  | "general"
  | "members"
  | "desktop"
  | "mcp"
  | "storage"
  | "providers"
  | "updates"
  | "import"
  | "connectors";
type Section = ServerSettingsSection;

const sections = {
  general: { title: "server.settings.generalTitle", description: "server.settings.generalDescription" },
  members: { title: "server.settings.membersTitle", description: "server.settings.membersDescription" },
  desktop: { title: "server.settings.desktopTitle", description: "server.settings.desktopDescription" },
  mcp: { title: "server.settings.mcpTitle", description: "server.settings.mcpDescription" },
  storage: { title: "server.settings.storageTitle", description: "server.settings.storageDescription" },
  providers: { title: "server.settings.providersTitle", description: "server.settings.providersDescription" },
  updates: { title: "server.settings.updatesTitle", description: "server.settings.updatesDescription" },
  import: { title: "server.settings.importTitle", description: "server.settings.importDescription" },
  connectors: { title: "server.settings.connectorsTitle", description: "server.settings.connectorsDescription" },
} as const satisfies Record<Section, { title: AppTextKey; description: AppTextKey }>;

export function ServerSettingsModal(props: ServerSettingsModalProps) {
  const { t, errorMessage } = useText();
  const [section, setSection] = createSignal<Section>("general");
  /** Set while the MCP panel shows a form, so the header reads `MCP › Connect to a custom MCP`. */
  const [mcpDetail, setMcpDetail] = createSignal<McpPanelDetail | null>(null);
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
      toast.error(t("server.settings.actionFailedTitle"), {
        description: errorMessage(error, t("server.settings.actionFailed")),
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
      toast.error(t("server.settings.copyFailedTitle"), { description: t("server.settings.copyFailed") });
    },
  };
  const general = createServerGeneralSection(host, { onSetUpDesktop: () => setSection("desktop") });
  const members = createServerMembersSection(host);

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
      }
      if (!editing) general.syncFromServer(name, logoUrl);
    },
  );

  /** An opener that names a section of the same server moves to it; the effect above covers a new server. */
  createEffect(
    () => (props.open ? availableInitialSection() : null),
    (requested) => {
      if (requested) setSection(requested);
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
        value === "members" ||
        value === "desktop" ||
        value === "mcp" ||
        value === "storage" ||
        value === "providers" ||
        value === "updates" ||
        value === "import" ||
        value === "connectors"
      )
        setSection(value);
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
            <Show when={props.githubConnector || props.slackConnector}>
              <Tabs.Trigger class="settings-modal-nav-item" value="connectors">
                <Plug aria-hidden="true" />
                <span>{t(sections.connectors.title)}</span>
              </Tabs.Trigger>
            </Show>
          </Tabs.List>
        }
      >
        <Tabs.Content value="general" class="settings-modal-tab-panel server-settings-panel" data-tab="general">
          <general.Panel />
        </Tabs.Content>
        <Tabs.Content value="members" class="settings-modal-tab-panel server-settings-panel" data-tab="members">
          <members.Panel />
        </Tabs.Content>
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
                {(serverId) => <ServerImportPanel serverId={serverId} {...agentImport()} />}
              </Show>
            </Tabs.Content>
          )}
        </Show>
        <Show when={props.githubConnector || props.slackConnector}>
          <Tabs.Content value="connectors" class="settings-modal-tab-panel server-settings-panel" data-tab="connectors">
            <ConnectorsPanel
              github={props.githubConnector}
              slack={props.slackConnector}
              agents={props.connectorAgents ?? []}
            />
          </Tabs.Content>
        </Show>
      </SettingsDialogShell>

      <members.RemoveDialog />
      <general.LeaveDialog />
    </Tabs.Root>
  );
}
