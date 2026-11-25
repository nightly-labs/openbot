import type {
  AvatarImageInput,
  HostedSitesDesktopApi,
  HostStatus,
  InviteSummary,
  ServerAppearance,
  ServerSummary,
  TeamInviteSummary,
  TeamPresenceMember,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import { CRM_CAPABILITY } from "@openbot/contracts/team-protocol/crm-v1";
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
  Bot,
  Brain,
  Button,
  CalendarClock,
  Download,
  FlaskConical,
  Globe2,
  HardDrive,
  History,
  ItemGroup,
  KeyRound,
  Monitor,
  RefreshCw,
  Settings,
  SettingsSection,
  ShieldCheck,
  Smile,
  Sparkles,
  Store,
  Tabs,
  Text,
  UsersRound,
} from "@openbot/ui";
import type { LicenseCalls } from "@openbot/ui/features/billing/license-store";
import type { ProviderSettingsDetail } from "@openbot/ui/features/settings/ProviderSettingsPage";
import {
  SaveBarDock,
  SettingsDialogShell,
  SettingsNavGroupLabel,
  type SettingsPagePlacement,
} from "@openbot/ui/features/settings/SettingsDialogShell";
import { SettingsHostedSitesTab } from "@openbot/ui/features/settings/SettingsHostedSitesTab";
import {
  createSettingsHostedSitesStore,
  type HostedSiteDeleteResult,
} from "@openbot/ui/features/settings/stores/hosted-sites-store";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { type ServerBrowserProfilesOptions, ServerBrowserProfilesPanel } from "../browser/ServerBrowserProfilesPanel";
import type { CrmHost } from "../crm/crm-port";
import { type ServerStorageOptions, ServerStoragePanel } from "../files/ServerStoragePanel";
import { hostedPlanStorageGb } from "../files/storage-usage";
import { type HostProviderSettings, HostProviderSettingsPanel } from "../settings/ProviderSettingsSection";
import type {
  HostClaudeCompactWindowOptions,
  ProviderClaudeCompactWindowSource,
} from "../settings/provider-claude-compact-window";
import type { HostClaudeUserSetupOptions, ProviderClaudeUserSetupSource } from "../settings/provider-claude-user-setup";
import type { HostProviderEnvironmentOptions, ProviderEnvironmentSource } from "../settings/provider-environment";
import type { HostDefaultProviderOptions, HostDefaultProviderSource } from "../settings/provider-host-default";
import type { HostModelVisibilityOptions, ProviderModelVisibilitySource } from "../settings/provider-model-visibility";
import type { HostPromptCacheTtlOptions, ProviderPromptCacheSource } from "../settings/provider-prompt-cache";
import { type ServerVaultOptions, ServerVaultPanel } from "../vault/ServerVaultPanel";
import { createServerAgentsSection, type ServerAgentDefaultsOptions } from "./ServerAgentsSection";
import { createServerAuditSection, type ServerAuditOptions } from "./ServerAuditSection";
import type { ServerBrowsingMemoryOptions } from "./ServerBrowsingMemorySetting";
import { type CompanySignInCalls, createServerCompanySignInSection } from "./ServerCompanySignInSection";
import { ServerCrmSetting } from "./ServerCrmSetting";
import { ServerDesktopPanel } from "./ServerDesktopPanel";
import { createServerGeneralSection } from "./ServerGeneralSection";
import {
  type HermesFolderPlace,
  type ServerImportDetail,
  type ServerImportOptions,
  ServerImportPanel,
} from "./ServerImportPanel";
import type { ServerMediaApprovalOptions } from "./ServerMediaApprovalSetting";
import { createServerMembersSection } from "./ServerMembersSection";
import type { ServerMemoryLimitOptions } from "./ServerMemoryLimitSetting";
import type { ServerMemoryReviewOptions } from "./ServerMemoryReviewSetting";
import { createServerMemorySection } from "./ServerMemorySection";
import { createServerOwnerTransferSection, type OwnerTransferCalls } from "./ServerOwnerTransferSection";
import { type ServerPersonalityOptions, ServerPersonalitySetting } from "./ServerPersonalitySetting";
import { createServerRolesSection, type ServerAgentAccessOptions } from "./ServerRolesSection";
import { type ServerRoutineFeedOptions, ServerRoutineFeedPanel } from "./ServerRoutineFeedPanel";
import type { ServerSignalHomeOptions } from "./ServerSignalHomeSetting";
import type { ServerSkillLearningOptions } from "./ServerSkillLearningSetting";
import type { ServerTimezoneOptions } from "./ServerTimezoneSetting";
import { type ServerTransferOptions, ServerTransferPanel } from "./ServerTransferPanel";
import type { ServerTurnLimitsOptions } from "./ServerTurnLimitsSetting";
import { type ServerUpdateOptions, ServerUpdatePanel } from "./ServerUpdatePanel";
import type { ServerVoiceModelOptions } from "./ServerVoiceModelSetting";
import { PROVIDER_SEARCH_NAMES, serverCanAdminister, serverRoleCanAdminister } from "./server-capabilities";
import type { ServerSettingsSectionHost } from "./server-settings-section";

export interface ServerSettingsModalProps {
  open: boolean;
  platform: "darwin" | "win32" | "linux";
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
  onSaveAppearance?: ((appearance: ServerAppearance | null) => Promise<void>) | undefined;
  onSetPublished: (published: boolean) => Promise<void>;
  onRotateHostKey?: (() => Promise<void>) | undefined;
  onCreateInvite: (input: { role: "admin" | "member"; email?: string; permanent?: boolean }) => Promise<InviteSummary>;
  license?: Pick<LicenseCalls, "getState" | "setUsers" | "changePlan"> | undefined;
  companySignIn?: CompanySignInCalls | undefined;
  ownerTransfer?: OwnerTransferCalls | undefined;
  onDownloadDesktopApp?: (() => void) | undefined;
  onContactUs?: () => void;
  onUpdateMember: (input: UpdateTeamMemberInput) => Promise<void>;
  onRemoveMember: (memberId: string) => Promise<void>;
  onRevokeInvite: (inviteId: string) => Promise<void>;
  onLeaveServer?: () => Promise<void>;
  onRemoveServer?: (() => Promise<void>) | undefined;
  onOpenScreenRecordingSettings: () => Promise<void>;
  onRecheckScreenRecording: () => Promise<void>;
  storage?: ServerStorageOptions | undefined;
  hostedSites?: ServerHostedSitesOptions | undefined;
  providers?: HostProviderSettings | undefined;
  onSwitchToManageProviders?: (() => void) | undefined;
  agentImport?: ServerImportOptions | undefined;
  instanceTransfer?: ServerTransferOptions | undefined;
  hostUpdate?: ServerUpdateOptions | undefined;
  hostTimezone?: ServerTimezoneOptions | undefined;
  hostVoiceModel?: ServerVoiceModelOptions | undefined;
  hostSignalHome?: ServerSignalHomeOptions | undefined;
  hostTurnLimits?: ServerTurnLimitsOptions | undefined;
  mediaApprovalCredits?: ServerMediaApprovalOptions | undefined;
  hostPersonality?: ServerPersonalityOptions | undefined;
  hostMemoryLimit?: ServerMemoryLimitOptions | undefined;
  memoryReview?: ServerMemoryReviewOptions | undefined;
  skillLearning?: ServerSkillLearningOptions | undefined;
  browsingMemory?: ServerBrowsingMemoryOptions | undefined;
  hostPromptCacheTtl?: HostPromptCacheTtlOptions | undefined;
  claudeUserSetup?: HostClaudeUserSetupOptions | undefined;
  claudeCompactWindow?: HostClaudeCompactWindowOptions | undefined;
  providerEnvironment?: HostProviderEnvironmentOptions | undefined;
  hostModelVisibility?: HostModelVisibilityOptions | undefined;
  hostDefaultProvider?: HostDefaultProviderOptions | undefined;
  agentAccess?: ServerAgentAccessOptions | undefined;
  serverAudit?: ServerAuditOptions | undefined;
  agentDefaults?: ServerAgentDefaultsOptions | undefined;
  routineFeed?: ServerRoutineFeedOptions | undefined;
  browserProfiles?: ServerBrowserProfilesOptions | undefined;
  vault?: ServerVaultOptions | undefined;
  crm?: CrmHost | undefined;
  initialSection?: ServerSettingsSection | null;
  initialSectionRequest?: number | undefined;
  onSectionChange?: ((section: ServerSettingsSection) => void) | undefined;
  page: SettingsPagePlacement | undefined;
  sectionQuery?: string | undefined;
  openFirstSectionRequest?: number | undefined;
  onFirstSectionOpened?: (() => void) | undefined;
  onOpenMarketplaceApps?: (() => void) | undefined;
}

export interface ServerHostedSitesOptions {
  api: Pick<HostedSitesDesktopApi, "list" | "delete">;
  onOpenSite: (url: string) => void;
  trackDelete?: () => (result: HostedSiteDeleteResult) => void;
  onSeePlans?: (() => void) | undefined;
}

export type ServerSettingsSection =
  | "general"
  | "personality"
  | "agents"
  | "memory"
  | "vault"
  | "members"
  | "roles"
  | "audit"
  | "desktop"
  | "storage"
  | "sites"
  | "providers"
  | "updates"
  | "import"
  | "transfer"
  | "routines"
  | "browser-profiles"
  | "experimental";
type Section = ServerSettingsSection;

const sections = {
  general: { title: "server.settings.generalTitle", description: "server.settings.generalDescription" },
  personality: { title: "server.settings.personalityTitle", description: "server.settings.personalityDescription" },
  agents: { title: "server.settings.agentDefaultsTitle", description: "server.settings.agentsDescription" },
  memory: { title: "server.settings.memoryTitle", description: "server.settings.memoryDescription" },
  vault: { title: "server.settings.vaultTitle", description: "server.settings.vaultDescription" },
  members: { title: "server.settings.membersTitle", description: "server.settings.membersDescription" },
  roles: { title: "server.settings.rolesTitle", description: "server.settings.rolesDescription" },
  audit: { title: "server.settings.auditTitle", description: "server.settings.auditDescription" },
  desktop: { title: "server.settings.desktopTitle", description: "server.settings.desktopDescription" },
  storage: { title: "server.settings.storageTitle", description: "server.settings.storageDescription" },
  sites: { title: "server.settings.hostedSitesTitle", description: "server.settings.hostedSitesDescription" },
  providers: { title: "server.settings.providersTitle", description: "server.settings.providersDescription" },
  updates: { title: "server.settings.updatesTitle", description: "server.settings.updatesDescription" },
  import: { title: "server.settings.importTitle", description: "server.settings.importDescription" },
  transfer: { title: "server.settings.transferTitle", description: "server.settings.transferDescription" },
  routines: { title: "server.settings.routinesTitle", description: "server.settings.routinesDescription" },
  "browser-profiles": { title: "browser.profiles.title", description: "browser.profiles.subtitle" },
  experimental: {
    title: "server.settings.experimentalTitle",
    description: "server.settings.experimentalDescription",
  },
} as const satisfies Record<Section, { title: AppTextKey; description: AppTextKey }>;

const SECTION_ROWS: Partial<Record<Section, readonly AppTextKey[]>> = {
  general: [
    "server.settings.name",
    "server.settings.logo",
    "server.settings.hostKeyTitle",
    "server.settings.leaveTitle",
    "server.settings.removeTitle",
  ],
  agents: [
    "server.settings.timezone",
    "server.settings.turnLimit",
    "server.settings.voiceModel.section",
    "server.settings.agentTaskLimit",
    "server.settings.mediaApprovalAgents",
    "server.settings.mediaApprovalCredits",
    "agentSettings.automation.title",
    "agentSettings.agentNewChat.title",
    "agentSettings.quickAcknowledgement.title",
    "settings.busyMessage.title",
    "settings.commitCoAuthor.sectionTitle",
  ],
  memory: [
    "server.settings.memoryLimit",
    "server.settings.memoryReview",
    "server.settings.skillLearning",
    "server.settings.browsingMemory",
  ],
  members: [
    "server.settings.publish",
    "server.companySignIn.title",
    "server.companySignIn.sso",
    "server.companySignIn.scim",
    "server.ownerTransfer.title",
  ],
  providers: ["provider.settings.accounts", "provider.account.add"],
  storage: ["settings.backgroundProcesses.title"],
  experimental: ["server.settings.experimentalCrm"],
};

const NAV_SECTIONS: ReadonlyArray<{ value: Section; icon: typeof Settings; group?: AppTextKey }> = [
  { value: "general", icon: Settings },
  { value: "providers", icon: Sparkles },
  { value: "personality", icon: Smile },
  { value: "agents", icon: Bot, group: "server.settings.group.agents" },
  { value: "memory", icon: Brain, group: "server.settings.group.agents" },
  { value: "vault", icon: KeyRound, group: "server.settings.group.agents" },
  { value: "browser-profiles", icon: AppWindow, group: "server.settings.group.agents" },
  { value: "routines", icon: CalendarClock, group: "server.settings.group.agents" },
  { value: "sites", icon: Globe2, group: "server.settings.group.agents" },
  { value: "members", icon: UsersRound, group: "server.settings.group.people" },
  { value: "roles", icon: ShieldCheck, group: "server.settings.group.people" },
  { value: "audit", icon: History, group: "server.settings.group.people" },
  { value: "storage", icon: HardDrive, group: "server.settings.group.server" },
  { value: "updates", icon: RefreshCw, group: "server.settings.group.server" },
  { value: "desktop", icon: Monitor, group: "server.settings.group.server" },
  { value: "import", icon: Download, group: "server.settings.group.server" },
  { value: "transfer", icon: ArrowLeftRight, group: "server.settings.group.server" },
  { value: "experimental", icon: FlaskConical, group: "server.settings.group.server" },
];

export function ServerSettingsModal(props: ServerSettingsModalProps) {
  const { t, errorMessage } = useText();
  const [section, setSection] = createSignal<Section>("general");
  createEffect(
    () => ({ shown: section(), notify: props.onSectionChange }),
    ({ shown, notify }) => {
      notify?.(shown);
    },
  );
  const [providerDetail, setProviderDetail] = createSignal<ProviderSettingsDetail | null>(null);
  const [importDetail, setImportDetail] = createSignal<ServerImportDetail | null>(null);
  const crumbDetail = () => {
    if (section() === "import") return importDetail();
    if (section() === "roles") return roles.crumb();
    if (section() === "agents") return agents.crumb();
    return section() === "providers" ? providerDetail() : null;
  };
  const [busy, setBusy] = createSignal<string | null>(null);
  const [modalElement, setModalElement] = createSignal<HTMLElement | undefined>();
  const [toastHeight, setToastHeight] = createSignal(0);
  let syncedServerId = "";

  const local = () => props.server.kind === "local";
  const hostName = () => (local() ? undefined : props.server.name);
  const remoteDesktopSection = () => props.remoteDesktopSupported !== false && (props.platform === "darwin" || local());
  const configured = () => (local() ? Boolean(props.hostStatus?.configured) : true);
  const actionsAvailable = () => local() || props.server.state === "online";
  const hermesFolderPlace = (): HermesFolderPlace | undefined => {
    if (local()) return "computer";
    return serverCanAdminister(props.server, "hermes-import-v1") ? "server" : undefined;
  };
  function promptCacheSource(): ProviderPromptCacheSource | undefined {
    const options = props.hostPromptCacheTtl;
    if (!options || !actionsAvailable() || !serverCanAdminister(props.server, "prompt-cache-ttl-v1")) return undefined;
    return {
      ...options,
      serverId: props.server.id,
      appliesToPi: local() || serverCanAdminister(props.server, "prompt-cache-ttl-pi-v1"),
      compaction: local() || serverCanAdminister(props.server, "cache-expiry-compaction-v1"),
    };
  }
  function claudeUserSetupSource(): ProviderClaudeUserSetupSource | undefined {
    const options = props.claudeUserSetup;
    if (!options || !actionsAvailable() || !serverCanAdminister(props.server, "claude-user-setup-v1")) return undefined;
    return { ...options, serverId: props.server.id, remote: !local() };
  }
  function claudeCompactWindowSource(): ProviderClaudeCompactWindowSource | undefined {
    const options = props.claudeCompactWindow;
    if (!options || !actionsAvailable() || !serverCanAdminister(props.server, "claude-compact-window-v1"))
      return undefined;
    return { ...options, serverId: props.server.id };
  }
  function providerEnvironmentSource(): ProviderEnvironmentSource | undefined {
    const options = props.providerEnvironment;
    if (!options || !actionsAvailable() || !serverCanAdminister(props.server, "provider-environment-v1"))
      return undefined;
    return { ...options, serverId: props.server.id };
  }
  function modelVisibilitySource(): ProviderModelVisibilitySource | undefined {
    const options = props.hostModelVisibility;
    if (!options || !actionsAvailable() || !serverCanAdminister(props.server, "model-visibility-v1")) return undefined;
    return { ...options, serverId: props.server.id };
  }
  function hostDefaultProviderSource(): HostDefaultProviderSource | undefined {
    const options = props.hostDefaultProvider;
    if (!options || local() || !actionsAvailable() || !serverCanAdminister(props.server, "provider-default-v1"))
      return undefined;
    return { ...options, serverId: props.server.id };
  }
  function personalityOptions(): ServerPersonalityOptions | undefined {
    const options = props.hostPersonality;
    if (!options || !actionsAvailable() || !serverCanAdminister(props.server, "host-personality-v1")) return undefined;
    return options;
  }
  function crmHost(): CrmHost | undefined {
    if (!props.crm || !actionsAvailable() || !serverCanAdminister(props.server, CRM_CAPABILITY)) return undefined;
    return props.crm;
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
  const audit = createServerAuditSection(host, () => section() === "audit");
  const agents = createServerAgentsSection(host, () => section() === "agents");
  const memory = createServerMemorySection(host);

  const sectionSupported = (value: Section): boolean => {
    switch (value) {
      case "general":
      case "members":
        return true;
      case "personality":
        return Boolean(personalityOptions());
      case "agents":
        return agents.available();
      case "memory":
        return memory.available();
      case "vault":
        return Boolean(props.vault);
      case "roles":
        return roles.available();
      case "audit":
        return audit.available();
      case "desktop":
        return remoteDesktopSection();
      case "storage":
        return Boolean(props.storage);
      case "sites":
        return Boolean(props.hostedSites);
      case "providers":
        return Boolean(props.providers || props.onSwitchToManageProviders);
      case "updates":
        return Boolean(props.hostUpdate);
      case "import":
        return Boolean(props.agentImport);
      case "transfer":
        return Boolean(props.instanceTransfer);
      case "routines":
        return Boolean(props.routineFeed);
      case "browser-profiles":
        return Boolean(props.browserProfiles);
      case "experimental":
        return Boolean(crmHost());
    }
  };
  const sectionMatches = (value: Section): boolean => {
    const needle = props.sectionQuery?.trim().toLocaleLowerCase();
    if (!needle) return true;
    const { title, description } = sections[value];
    const names = value === "providers" ? PROVIDER_SEARCH_NAMES : [];
    return [...[title, description, ...(SECTION_ROWS[value] ?? [])].map((key) => t(key)), ...names].some((words) =>
      words.toLocaleLowerCase().includes(needle),
    );
  };
  const matchingSections = createMemo(() =>
    NAV_SECTIONS.filter((item) => sectionSupported(item.value) && sectionMatches(item.value)),
  );
  const navSections = createMemo(() =>
    NAV_SECTIONS.filter(
      (item) => matchingSections().includes(item) || (item.value === section() && sectionSupported(item.value)),
    ),
  );
  const marketplaceAppsMatches = () => {
    const needle = props.sectionQuery?.trim().toLocaleLowerCase();
    if (!needle || !props.onOpenMarketplaceApps) return false;
    return t("app.settingsPage.marketplaceApps").toLocaleLowerCase().includes(needle);
  };
  let handledOpenFirstRequest = untrack(() => props.openFirstSectionRequest ?? 0);
  createEffect(
    () => props.openFirstSectionRequest ?? 0,
    (request) => {
      if (request === handledOpenFirstRequest) return;
      handledOpenFirstRequest = request;
      const first = untrack(matchingSections)[0];
      if (first) setSection(first.value);
      else if (untrack(marketplaceAppsMatches)) untrack(() => props.onOpenMarketplaceApps?.());
      else return;
      untrack(() => props.onFirstSectionOpened?.());
    },
  );
  const searchStatus = () => {
    if (!props.sectionQuery?.trim()) return "";
    const count = matchingSections().length + (marketplaceAppsMatches() ? 1 : 0);
    return count > 0 ? t("app.settingsPage.resultCount", { count }) : t("app.settingsPage.noResults");
  };
  const members = createServerMembersSection(
    host,
    {
      onSetUpDesktop: () => setSection("desktop"),
      saveIdentityDraft: general.saveIdentityDraft,
    },
    roles,
  );
  const companySignIn = createServerCompanySignInSection(
    host,
    () => props.companySignIn,
    () => props.onDownloadDesktopApp,
    () => props.open && section() === "members",
  );
  const ownerTransfer = createServerOwnerTransferSection(
    host,
    () => props.ownerTransfer,
    () => props.open && section() === "members",
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

  createEffect(
    () => ({ element: modalElement(), height: toastHeight() }),
    ({ element, height }) => {
      element?.style.setProperty("--settings-modal-floating-space", `${height}px`);
    },
  );
  function measureToast(element: HTMLElement): void {
    const observer = new ResizeObserver(() => setToastHeight(element.offsetHeight));
    observer.observe(element);
    setToastHeight(element.offsetHeight);
    onCleanup(() => {
      observer.disconnect();
      setToastHeight(0);
    });
  }
  const saveBarDocked = () => section() === "general" && general.identityDirty();

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
        companySignIn.resetForServer();
        ownerTransfer.resetForServer();
        roles.resetForServer();
        audit.resetForServer();
        agents.resetForServer();
      }
      if (!editing) general.syncFromServer(name, logoUrl);
    },
  );

  createEffect(
    () => section() === "roles" && !roles.available(),
    (gone) => {
      if (gone) setSection("members");
    },
  );

  createEffect(
    () => section() === "audit" && !audit.available(),
    (gone) => {
      if (gone) setSection("members");
    },
  );

  createEffect(
    () => section() === "agents" && !agents.available(),
    (gone) => {
      if (gone) setSection("general");
    },
  );

  createEffect(
    () => section() === "memory" && !memory.available(),
    (gone) => {
      if (gone) setSection("general");
    },
  );

  createEffect(
    () => section() === "vault" && !props.vault,
    (gone) => {
      if (gone) setSection("general");
    },
  );

  const requestedSection = createMemo(() => (props.open ? availableInitialSection() : null));
  createEffect(
    () => ({ requested: requestedSection(), request: props.initialSectionRequest }),
    ({ requested }) => {
      if (requested) setSection(requested);
    },
  );

  createEffect(
    () => props.open && section() === "providers" && props.providers?.onShown !== undefined,
    (visible) => {
      if (visible) untrack(() => props.providers?.onShown?.());
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
        value === "personality" ||
        value === "agents" ||
        value === "memory" ||
        value === "vault" ||
        value === "members" ||
        value === "roles" ||
        value === "audit" ||
        value === "desktop" ||
        value === "storage" ||
        value === "sites" ||
        value === "providers" ||
        value === "updates" ||
        value === "import" ||
        value === "transfer" ||
        value === "routines" ||
        value === "browser-profiles" ||
        value === "experimental"
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
        title={t(sections[section()].title)}
        crumb={crumbDetail()}
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
        }
        sidebar={
          <>
            <Tabs.List class="settings-modal-nav" aria-label={t("server.settings.sections")}>
              <For each={navSections()}>
                {(item, index) => {
                  const Icon = item.icon;
                  return (
                    <>
                      <Show when={item.group !== navSections()[index() - 1]?.group && item.group}>
                        {(group) => <SettingsNavGroupLabel label={t(group())} />}
                      </Show>
                      <Tabs.Trigger class="settings-modal-nav-item" value={item.value}>
                        <Icon aria-hidden="true" />
                        <span>{t(sections[item.value].title)}</span>
                      </Tabs.Trigger>
                    </>
                  );
                }}
              </For>
            </Tabs.List>
            <Show when={marketplaceAppsMatches()}>
              <ul class="settings-page-results" aria-label={t("app.settingsPage.results")}>
                <li>
                  <Button
                    variant="ghost"
                    type="button"
                    class="settings-page-result"
                    onClick={() => props.onOpenMarketplaceApps?.()}
                  >
                    <span class="settings-page-result-section">
                      <Store aria-hidden="true" />
                      {t("marketplace.title")}
                    </span>
                    <span class="settings-page-result-title">{t("app.settingsPage.marketplaceApps")}</span>
                  </Button>
                </li>
              </ul>
            </Show>
            <Show when={matchingSections().length === 0 && !marketplaceAppsMatches()}>
              <p class="settings-page-empty">{t("app.settingsPage.noResults")}</p>
            </Show>
            <span class="sr-only" role="status">
              {searchStatus()}
            </span>
          </>
        }
      >
        <Tabs.Content value="general" class="settings-modal-tab-panel server-settings-panel" data-tab="general">
          <general.Panel />
        </Tabs.Content>
        <Show when={memory.available()}>
          <Tabs.Content value="memory" class="settings-modal-tab-panel server-settings-panel" data-tab="memory">
            <memory.Panel />
          </Tabs.Content>
        </Show>
        <Show when={personalityOptions()}>
          {(options) => (
            <Tabs.Content
              value="personality"
              class="settings-modal-tab-panel server-settings-panel"
              data-tab="personality"
            >
              <SettingsSection title={t("server.settings.agents")}>
                <ItemGroup class="settings-modal-card">
                  <ServerPersonalitySetting
                    {...options()}
                    serverId={props.server.id}
                    disabled={Boolean(busy())}
                    menuMount={modalElement()}
                    run={run}
                  />
                </ItemGroup>
              </SettingsSection>
            </Tabs.Content>
          )}
        </Show>
        <Show when={agents.available()}>
          <Tabs.Content value="agents" class="settings-modal-tab-panel server-settings-panel" data-tab="agents">
            <agents.Panel />
          </Tabs.Content>
        </Show>
        <Show when={props.vault}>
          {(vault) => (
            <Tabs.Content value="vault" class="settings-modal-tab-panel server-settings-panel" data-tab="vault">
              <ServerVaultPanel {...vault()} menuMount={modalElement()} />
            </Tabs.Content>
          )}
        </Show>
        <Tabs.Content value="members" class="settings-modal-tab-panel server-settings-panel" data-tab="members">
          <members.Panel />
          <companySignIn.Panel />
          <ownerTransfer.Panel />
        </Tabs.Content>
        <Show when={roles.available()}>
          <Tabs.Content value="roles" class="settings-modal-tab-panel server-settings-panel" data-tab="roles">
            <roles.Panel />
          </Tabs.Content>
        </Show>
        <Show when={audit.available()}>
          <Tabs.Content value="audit" class="settings-modal-tab-panel server-settings-panel" data-tab="audit">
            <audit.Panel />
          </Tabs.Content>
        </Show>
        <Show when={remoteDesktopSection()}>
          <Tabs.Content value="desktop" class="settings-modal-tab-panel server-settings-panel" data-tab="desktop">
            <ServerDesktopPanel
              server={props.server}
              platform={props.platform}
              hostStatus={props.hostStatus}
              menuMount={modalElement()}
            />
          </Tabs.Content>
        </Show>
        <Show when={props.storage}>
          {(storage) => (
            <Tabs.Content value="storage" class="settings-modal-tab-panel server-settings-panel" data-tab="storage">
              <ServerStoragePanel
                serverId={props.server.id}
                storageGb={hostedPlanStorageGb(props.server)}
                members={props.members}
                {...storage()}
              />
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
                onSeePlans={sites().onSeePlans}
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
                  hostName={hostName()}
                  selectMount={modalElement()}
                  onDetailChange={setProviderDetail}
                  promptCache={promptCacheSource()}
                  claudeUserSetup={claudeUserSetupSource()}
                  claudeCompactWindow={claudeCompactWindowSource()}
                  providerEnvironment={providerEnvironmentSource()}
                  modelVisibility={modelVisibilitySource()}
                  hostDefaultProvider={hostDefaultProviderSource()}
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
              <Show when={props.server.id} keyed>
                {(serverId) => (
                  <ServerImportPanel
                    serverId={serverId}
                    {...agentImport()}
                    hermes={hermesFolderPlace()}
                    onServer={!local()}
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
        <Show when={crmHost()}>
          {(crm) => (
            <Tabs.Content
              value="experimental"
              class="settings-modal-tab-panel server-settings-panel"
              data-tab="experimental"
            >
              <SettingsSection title={t("server.settings.experimentalFeatures")}>
                <ItemGroup class="settings-modal-card">
                  <ServerCrmSetting host={crm()} disabled={Boolean(busy())} run={run} />
                </ItemGroup>
              </SettingsSection>
            </Tabs.Content>
          )}
        </Show>
      </SettingsDialogShell>

      <members.ConfirmDialogs />
      <ownerTransfer.Dialogs />
      <general.LeaveDialog />
      <general.RotateKeyDialog />
    </Tabs.Root>
  );
}
