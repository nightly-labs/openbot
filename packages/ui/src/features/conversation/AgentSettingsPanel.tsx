import type { ExpressionId } from "@norbert_bodziony/bloub";
import {
  agentProviderDescriptor,
  agentProviderName,
  agentSteersTurns,
  foreignProvider,
} from "@openbot/contracts/agent-providers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentBackupModels,
  type AgentBrowserProfile,
  type AgentDefaults,
  type AgentModelChoice,
  type AgentModelId,
  type AgentPermissionLevel,
  type AgentProviderId,
  type AgentReasoningEffort,
  type AgentStatus,
  type AvatarColor,
  type AvatarHue,
  type AvatarImageInput,
  agentAutomationAllowed,
  agentBrowserProfile,
  agentComputerUseEnabled,
  agentMemoryEnabled,
  agentNewChatAllowed,
  agentNextProviderAccountId,
  agentPermissionLevel,
  agentPermissionLevels,
  agentPermissionUpdate,
  agentQuickAcknowledgementEnabled,
  type BusyMessageMode,
  type ClientAgentModelOption,
  type CustomAgentSummary,
  type CustomProviderSummary,
  DEFAULT_AGENT_ACCESS,
  DEFAULT_AGENT_DEFAULTS,
  DEFAULT_BUSY_MESSAGE_MODE,
  type ProviderRuntimeStatus,
  type ServerNotificationLevel,
  type UpdateAgentAdminSettingsInput,
  type UpdateAgentInput,
  widensAgentPermission,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  ArrowLeftRight,
  Bell,
  Button,
  ConfirmDialog,
  Cpu,
  ErrorReference,
  IconButton,
  Input,
  Pencil,
  Popover,
  RotateCcw,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  SlidingTabs,
  Switch,
  Text,
  toast,
} from "@openbot/ui";
import { normalizeAvatarFile } from "@openbot/ui/avatar-image";
import {
  AVATAR_COLOR_CHOICES,
  AVATAR_EXPRESSIONS,
  AVATAR_STYLES,
  type AvatarColorChoice,
  type AvatarStyle,
  avatarDefaultSeed,
  avatarHueForColor,
  avatarSeedForFace,
  avatarStyleForSeed,
  bloubAvatarProfile,
  isAvatarColorChoice,
  SUPPORTED_AVATAR_SILHOUETTES,
  type SupportedAvatarSilhouetteId,
} from "@openbot/ui/bloub-avatar";
import { ProviderModelPicker } from "@openbot/ui/components/ProviderModelPicker";
import { findModelOption } from "@openbot/ui/components/provider-accounts";
import { ResizableTextarea } from "@openbot/ui/components/ResizableTextarea";
import {
  SettingsField,
  SettingsLinkGroup,
  SettingsLinkRow,
  SettingsPanel,
  SettingsPanelContent,
  SettingsPanelHeader,
} from "@openbot/ui/components/SettingsPanel";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { InstructionsLimit, instructionsTooLong } from "@openbot/ui/features/agents/InstructionsLimit";
import {
  type BrowserProfileChoice,
  BrowserProfileSelect,
  type BrowserProfileSelectProfile,
} from "@openbot/ui/features/browser/BrowserProfileSelect";
import { errorReference } from "@openbot/user-errors";
import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import { useText } from "../../text";
import { avatarColorChoiceLabel } from "../agents/avatar-hue-label";
import { SERVER_NOTIFICATION_LEVEL_LABELS } from "../servers/ServerActionItems";
import { AgentChatColorRow } from "../settings/ChatColorSetting";
import { AgentDeleteDialog } from "./AgentDeleteDialog";
import { AgentDeleteHistoryDialog } from "./AgentDeleteHistoryDialog";
import { type AgentFolderCalls, AgentFoldersPage, AgentFoldersRow, createAgentFolders } from "./AgentFolders";
import { AgentNewChatDialog } from "./AgentNewChatDialog";
import {
  AGENT_SETTING_LINK_ROWS,
  AGENT_SETTINGS_PAGE_TITLE,
  type AgentSettingReveal,
  type AgentSettingsPage,
  revealSettingRow,
  waitForSettingRow,
} from "./agent-setting-links";
import { BackupModelsPage } from "./BackupModels";

export interface AgentRuntimeSettings {
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
}

export type AgentRuntimeSettingsPatch =
  | (AgentRuntimeSettings & Pick<UpdateAgentInput, "providerAccountId">)
  | Pick<AgentRuntimeSettings, "reasoningEffort">;

export interface AgentSettingsPanelProps {
  agent: AgentProfile;
  runtimeSettings: AgentRuntimeSettings;
  agentStatus: AgentStatus;
  modelOptions: ClientAgentModelOption[];
  working: boolean;
  autoApprove?: boolean | undefined;
  onUpdatePermissions?: ((input: UpdateAgentAdminSettingsInput) => Promise<void>) | undefined;
  computerUseEditable?: boolean;
  automationEditable?: boolean;
  newChatEditable?: boolean;
  quickAcknowledgementEditable?: boolean;
  builtinMemoryEditable?: boolean;
  fastMode?: boolean | undefined;
  ultrafast?: boolean | undefined;
  onFastModeChange?: ((fastMode: boolean, ultrafast: boolean) => void) | undefined;
  browserProfiles?: AgentBrowserProfileOptions | undefined;
  notificationLevel?: AgentNotificationLevelOptions | undefined;
  busyMessageModeEditable?: boolean;
  busyMessageDefaultIsHost?: boolean;
  backupModelsEditable?: boolean;
  folders?: AgentFolderCalls | undefined;
  usageLimited?: ((choice: AgentModelChoice) => boolean) | undefined;
  providerFailed?: ((choice: AgentModelChoice) => boolean) | undefined;
  defaultBusyMessageMode?: BusyMessageMode | undefined;
  agentDefaults?: AgentDefaults | undefined;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  customAgents?: readonly CustomAgentSummary[] | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onConnectProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  canConnectProvider?: ((provider: AgentProviderId) => boolean) | undefined;
  onManageProviders?: ((trigger: HTMLElement) => void) | undefined;
  onOpenModelPicker?: (() => void) | undefined;
  maxWidth: () => number;
  onClose: () => void;
  width: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  preferredWidth?: (() => number) | undefined;
  reveal?: AgentSettingReveal | null | undefined;
  links?: JSX.Element;
  detailOpen?: boolean;
  children?: JSX.Element;
  onUpdateAgent: (agentId: string, updates: Omit<UpdateAgentInput, "agentId">) => Promise<void>;
  onUpdateRuntimeSettings: (
    agentId: string,
    settings: AgentRuntimeSettings,
    updates: AgentRuntimeSettingsPatch,
  ) => Promise<boolean>;
  onSetAgentAvatar: (agentId: string, image: AvatarImageInput | null) => Promise<void>;
  onUnshownSaveError?: ((message: string) => void) | undefined;
  onStartNewChat?: (() => Promise<void>) | undefined;
  onDeleteHistory?: (() => Promise<void>) | undefined;
  onDeleteAgent?: ((agentId: string) => Promise<void>) | undefined;
}

export interface AgentBrowserProfileOptions {
  profiles: readonly BrowserProfileSelectProfile[] | undefined;
  current?: AgentBrowserProfile | undefined;
  onChange: (agentId: string, profile: AgentBrowserProfile) => Promise<void>;
  onCreate: (name: string) => Promise<string>;
  onManage: (trigger: HTMLElement) => void;
}

export interface AgentNotificationLevelOptions {
  current: ServerNotificationLevel | null;
  serverLevel: ServerNotificationLevel;
  onOpen: (trigger: HTMLElement) => void;
}

function browserProfileChoice(profile: AgentBrowserProfile): BrowserProfileChoice {
  return profile.kind === "profile" ? profile.profileId : profile.kind;
}

function choiceBrowserProfile(choice: BrowserProfileChoice): AgentBrowserProfile {
  return choice === "shared" || choice === "agent" ? { kind: choice } : { kind: "profile", profileId: choice };
}

const INSTRUCTIONS_SAVE_DELAY_MS = 400;

interface AgentTextFields {
  description: string;
  name: string;
  title: string;
}

interface AvatarEditor {
  hue: AvatarHue | null;
  color: AvatarColor | null;
  pickerOpen: boolean;
  seed: string;
  uploadBusy: boolean;
}

interface AgentSettingsDraft {
  avatar: AvatarEditor;
  dirty: Record<keyof AgentTextFields, boolean>;
  fields: AgentTextFields;
  permission: AgentPermissionLevel;
  computerUse: boolean;
  allowAutomation: boolean;
  allowNewChat: boolean;
  quickAcknowledgement: boolean;
  memory: boolean;
  browserProfile: BrowserProfileChoice;
  browserProfileMoved: boolean;
  busyMessage: BusyMessageChoice;
  backupModels: AgentBackupModels | null;
  confirmingPermission: AgentPermissionLevel | null;
  runtime: AgentRuntimeSettings;
  saveError: string | null;
  saveErrorReference: string | null;
}

interface TextSaveRequest {
  agentId: string;
  draftValue: string;
  field: keyof AgentTextFields;
  storedValue: string;
}

export default function AgentSettingsPanel(props: AgentSettingsPanelProps) {
  const { t, errorMessage } = useText();
  const agentDefaults = () => props.agentDefaults ?? DEFAULT_AGENT_DEFAULTS;
  const [newChatOpen, setNewChatOpen] = createSignal(false);
  const [deleteHistoryOpen, setDeleteHistoryOpen] = createSignal(false);
  const [agentToDelete, setAgentToDelete] = createSignal<AgentProfile | null>(null);
  const [draft, setDraft] = createStore<AgentSettingsDraft>({
    avatar: {
      hue: null,
      color: null,
      pickerOpen: false,
      seed: "agent",
      uploadBusy: false,
    },
    dirty: { description: false, name: false, title: false },
    fields: { description: "", name: "", title: "" },
    permission: untrack(() => currentPermission()),
    computerUse: true,
    allowAutomation: false,
    allowNewChat: false,
    quickAcknowledgement: false,
    memory: true,
    browserProfile: "shared",
    browserProfileMoved: false,
    busyMessage: "default",
    backupModels: null,
    confirmingPermission: null,
    runtime: untrack(() => ({ ...props.runtimeSettings })),
    saveError: null,
    saveErrorReference: null,
  });
  const avatarUrl = () => props.agent.avatarUrl ?? null;
  const [page, setPage] = createSignal<AgentSettingsPage | null>(null);
  let returnFocusPage: AgentSettingsPage | null = null;

  function pageRowRef(target: AgentSettingsPage) {
    return (element: HTMLButtonElement) => {
      if (returnFocusPage !== target) return;
      returnFocusPage = null;
      queueMicrotask(() => element.focus());
    };
  }

  let pageRoot: HTMLDivElement | undefined;

  function openPage(target: AgentSettingsPage): void {
    setPage(target);
    queueMicrotask(() =>
      (
        pageRoot?.querySelector<HTMLElement>(
          'button:not(:disabled, [aria-disabled="true"]), input, textarea, select',
        ) ?? pageRoot?.closest("aside")?.querySelector<HTMLElement>(".settings-panel-nav-button")
      )?.focus(),
    );
  }

  createEffect(
    () => props.reveal,
    (reveal) => {
      if (!reveal) return;
      const row = AGENT_SETTING_LINK_ROWS[reveal.settingId];
      const pageShown = untrack(page) === row.page;
      setPage(row.page);
      if (untrack(() => props.detailOpen)) return;
      const root = pageRoot;
      if (!root) return;
      if (!row.match) {
        if (row.page) openPage(row.page);
        return;
      }
      const label = t(row.match);
      if (pageShown && revealSettingRow(root, label)) return;
      return waitForSettingRow(root, () => untrack(page) !== row.page || revealSettingRow(root, label));
    },
  );

  function closePage(): void {
    returnFocusPage = page();
    setPage(null);
  }

  function folderSource() {
    const calls = props.folders;
    return calls ? { agentId: props.agent.id, agentName: props.agent.name, calls } : undefined;
  }
  const agentFolders = createAgentFolders(folderSource);
  const folderLoadKey = createMemo(() =>
    props.folders
      ? [
          props.agent.id,
          page() === "folders",
          ...(props.agent.additionalFolders ?? []),
          "",
          ...(props.agent.excludedFolders ?? []),
        ].join("\n")
      : "",
  );
  createEffect(
    () => {
      folderLoadKey();
      return untrack(folderSource);
    },
    (source) => agentFolders.load(source),
  );

  function wideAccess(): string | null {
    const provider = knownProvider();
    if (provider !== undefined && agentProviderDescriptor(provider).foldersInFullAccess) return null;
    return draft.permission === "workspace" ? null : t(ACCESS_LABEL[draft.permission]);
  }

  function workspaceEnforcementNote(provider: AgentProviderId): string {
    switch (agentProviderDescriptor(provider).workspaceEnforcement) {
      case "tool-sandbox":
        return t("agentSettings.runtime.workspaceEnforcedClaude");
      case "command-sandbox":
        return t("agentSettings.runtime.workspaceEnforcedCommand");
      case "confined-process":
        return t("agentSettings.runtime.workspaceEnforcedProcess", { provider: agentProviderName(provider) });
    }
  }

  function currentPermission(): AgentPermissionLevel {
    return agentPermissionLevel({
      access: props.agent.access ?? DEFAULT_AGENT_ACCESS,
      autoApprove: props.autoApprove ?? true,
    });
  }

  function widenDescription(): string {
    const reach = draft.permission === "workspace" ? `${t("agentSettings.fullAccess.description")} ` : "";
    return draft.confirmingPermission === "ask"
      ? `${reach}${t("agentSettings.runtime.askNote")}`
      : `${reach}${t("agentSettings.fullAccess.noApproval")}`;
  }

  function setSaveError(message: string | null, cause?: unknown): void {
    setDraft((state) => {
      state.saveError = message;
      state.saveErrorReference = message === null || cause === undefined ? null : errorReference(cause);
    });
  }

  const agentForeignProvider = () => foreignProvider(props.agent.provider);
  const knownProvider = () => (agentForeignProvider() === undefined ? draft.runtime.provider : undefined);
  const avatarFace = createMemo(() => bloubAvatarProfile(draft.avatar.seed, null));
  const avatarStyle = createMemo(() => avatarStyleForSeed(draft.avatar.seed));
  const avatarResetSeed = createMemo(() => avatarDefaultSeed(props.agent.id, avatarStyle()));
  const avatarColorSelected = (choice: AvatarColorChoice) =>
    isAvatarColorChoice(choice, draft.avatar.hue, draft.avatar.color);
  const automaticColorSelected = () => draft.avatar.hue === null && draft.avatar.color === null;
  let avatarPickerRoot: HTMLDivElement | undefined;
  let avatarFileInput: HTMLInputElement | undefined;
  let lastSignature: string | undefined;
  let lastAgentId: string | undefined;
  let instructionsSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let activeTextSave: TextSaveRequest | null = null;
  let disposed = false;
  const pendingTextSaves = new Map<string, TextSaveRequest>();

  createEffect(
    () => {
      const agent = props.agent;
      const runtimeSettings = props.runtimeSettings;
      const browserProfile = browserProfileChoice(props.browserProfiles?.current ?? agentBrowserProfile(agent));
      return {
        agent,
        runtimeSettings,
        browserProfile,
        signature: [
          agent.id,
          agent.name,
          agent.title,
          agent.description,
          currentPermission(),
          String(agentComputerUseEnabled(agent)),
          String(agentAutomationAllowed(agent, agentDefaults())),
          String(agentNewChatAllowed(agent, agentDefaults())),
          String(agentQuickAcknowledgementEnabled(agent, agentDefaults())),
          String(agentMemoryEnabled(agent)),
          browserProfile,
          agent.busyMessageMode ?? "default",
          JSON.stringify(agent.backupModels ?? null),
          runtimeSettings.provider,
          runtimeSettings.model,
          runtimeSettings.reasoningEffort,
          agent.avatarSeed,
          String(agent.avatarHue),
          agent.avatarColor ?? "",
        ].join("\u0000"),
      };
    },
    ({ agent, runtimeSettings, browserProfile, signature }) =>
      untrack(() => {
        if (signature === lastSignature) return;
        const agentChanged = agent.id !== lastAgentId;
        if (agentChanged && lastAgentId) flushDirtyTextFields(lastAgentId);
        const keep = {
          description: !agentChanged && draft.dirty.description,
          name: !agentChanged && draft.dirty.name,
          title: !agentChanged && draft.dirty.title,
        };
        lastSignature = signature;
        lastAgentId = agent.id;
        if (agentChanged) {
          returnFocusPage = null;
          setPage(null);
        }
        setDraft((state) => {
          if (agentChanged) {
            state.dirty.description = false;
            state.dirty.name = false;
            state.dirty.title = false;
          }
          if (!keep.name) state.fields.name = agent.name;
          if (!keep.title) state.fields.title = agent.title;
          if (!keep.description) state.fields.description = agent.description;
          state.permission = currentPermission();
          state.computerUse = agentComputerUseEnabled(agent);
          state.allowAutomation = agentAutomationAllowed(agent, agentDefaults());
          state.allowNewChat = agentNewChatAllowed(agent, agentDefaults());
          state.quickAcknowledgement = agentQuickAcknowledgementEnabled(agent, agentDefaults());
          state.memory = agentMemoryEnabled(agent);
          state.browserProfile = browserProfile;
          if (agentChanged) state.browserProfileMoved = false;
          state.busyMessage = agent.busyMessageMode ?? "default";
          state.backupModels = agent.backupModels ?? null;
          if (agentChanged) state.confirmingPermission = null;
          state.runtime.provider = runtimeSettings.provider;
          state.runtime.model = runtimeSettings.model;
          state.runtime.reasoningEffort = runtimeSettings.reasoningEffort;
          state.avatar.seed = agent.avatarSeed;
          state.avatar.hue = agent.avatarHue;
          state.avatar.color = agent.avatarColor ?? null;
          if (agentChanged) state.avatar.pickerOpen = false;
        });
      }),
  );

  onSettled(() => {
    const closeAvatarPicker = (event: PointerEvent) => {
      if (!draft.avatar.pickerOpen) return;
      if (event.target instanceof Node && avatarPickerRoot?.contains(event.target)) return;
      setDraft((state) => {
        state.avatar.pickerOpen = false;
      });
    };
    window.addEventListener("pointerdown", closeAvatarPicker);
    return () => window.removeEventListener("pointerdown", closeAvatarPicker);
  });

  onCleanup(() => {
    disposed = true;
    if (lastAgentId) flushDirtyTextFields(lastAgentId);
  });

  async function saveAgentPatch(
    updates: Omit<UpdateAgentInput, "agentId">,
    agentId = props.agent.id,
  ): Promise<boolean> {
    if (!disposed && props.agent.id === agentId) setSaveError(null);
    try {
      await props.onUpdateAgent(agentId, updates);
      return true;
    } catch (error) {
      reportSaveError(agentId, error);
      return false;
    }
  }

  function reportSaveError(agentId: string, error: unknown, fallback = t("agentSettings.saveFailed")): void {
    const message = errorMessage(error, fallback);
    if (!disposed && props.agent.id === agentId) setSaveError(message, error);
    else props.onUnshownSaveError?.(message);
  }

  function textSaveRequest(
    field: keyof AgentTextFields,
    agentId: string,
    draftValue = draft.fields[field],
  ): TextSaveRequest {
    return {
      agentId,
      draftValue,
      field,
      storedValue:
        field === "name"
          ? draftValue.trim() || t("agent.setup.nameFallback")
          : field === "title"
            ? draftValue.trim()
            : draftValue,
    };
  }

  function textSaveKey(request: TextSaveRequest): string {
    return `${request.agentId}\u0000${request.field}`;
  }

  function textSavePatch(request: TextSaveRequest): Omit<UpdateAgentInput, "agentId"> {
    switch (request.field) {
      case "name":
        return { name: request.storedValue };
      case "title":
        return { title: request.storedValue };
      case "description":
        return { description: request.storedValue };
    }
  }

  function queueTextSave(request: TextSaveRequest): void {
    if (request.field === "description" && instructionsTooLong(request.storedValue)) return;
    if (
      activeTextSave?.agentId === request.agentId &&
      activeTextSave.field === request.field &&
      activeTextSave.draftValue === request.draftValue
    ) {
      return;
    }
    pendingTextSaves.set(textSaveKey(request), request);
    void drainTextSaves();
  }

  async function drainTextSaves(): Promise<void> {
    if (activeTextSave) return;
    const entry = pendingTextSaves.entries().next().value;
    if (!entry) return;
    const [key, request] = entry;
    pendingTextSaves.delete(key);
    activeTextSave = request;
    const saved = await saveAgentPatch(textSavePatch(request), request.agentId);
    if (
      !disposed &&
      saved &&
      props.agent.id === request.agentId &&
      draft.fields[request.field] === request.draftValue
    ) {
      setDraft((state) => {
        state.dirty[request.field] = false;
      });
    }
    activeTextSave = null;
    if (pendingTextSaves.size > 0) void drainTextSaves();
  }

  function cancelInstructionsSaveTimer(): void {
    if (instructionsSaveTimer === undefined) return;
    clearTimeout(instructionsSaveTimer);
    instructionsSaveTimer = undefined;
  }

  function scheduleInstructionsSave(value: string): void {
    cancelInstructionsSaveTimer();
    const request = textSaveRequest("description", props.agent.id, value);
    instructionsSaveTimer = setTimeout(() => {
      instructionsSaveTimer = undefined;
      queueTextSave(request);
    }, INSTRUCTIONS_SAVE_DELAY_MS);
  }

  function flushDirtyTextFields(agentId: string): void {
    cancelInstructionsSaveTimer();
    for (const field of ["name", "title", "description"] as const) {
      if (draft.dirty[field]) queueTextSave(textSaveRequest(field, agentId));
    }
  }

  async function saveRuntimeSettings(
    settings: AgentRuntimeSettings,
    updates: AgentRuntimeSettingsPatch,
    agentId = props.agent.id,
  ): Promise<boolean> {
    setSaveError(null);
    try {
      const saved = await props.onUpdateRuntimeSettings(agentId, settings, updates);
      if (!saved && props.agent.id === agentId) setSaveError(t("agentSettings.saveFailed"));
      return saved;
    } catch (error) {
      reportSaveError(agentId, error);
      return false;
    }
  }

  function saveName(): void {
    if (disposed) return;
    const value = draft.fields.name.trim() || t("agent.setup.nameFallback");
    setDraft((state) => {
      state.fields.name = value;
    });
    queueTextSave(textSaveRequest("name", props.agent.id));
  }

  function saveTitle(): void {
    if (disposed) return;
    const value = draft.fields.title.trim();
    setDraft((state) => {
      state.fields.title = value;
    });
    queueTextSave(textSaveRequest("title", props.agent.id));
  }

  function saveDescription(): void {
    if (disposed) return;
    cancelInstructionsSaveTimer();
    queueTextSave(textSaveRequest("description", props.agent.id));
  }

  async function setCustomAvatar(image: AvatarImageInput | null): Promise<boolean> {
    if (draft.avatar.uploadBusy) return false;
    setDraft((state) => {
      state.avatar.uploadBusy = true;
      state.saveError = null;
    });
    const agentId = props.agent.id;
    try {
      await props.onSetAgentAvatar(agentId, image);
      return true;
    } catch (error) {
      reportSaveError(agentId, error, t("agentSettings.avatar.saveFailed"));
      return false;
    } finally {
      setDraft((state) => {
        state.avatar.uploadBusy = false;
      });
    }
  }

  async function uploadAgentAvatar(file: File | undefined): Promise<void> {
    if (!file) return;
    setDraft((state) => {
      state.avatar.uploadBusy = true;
      state.saveError = null;
    });
    const agentId = props.agent.id;
    try {
      const image = await normalizeAvatarFile(file);
      await props.onSetAgentAvatar(agentId, image);
    } catch (error) {
      reportSaveError(agentId, error, t("agentSettings.avatar.processFailed"));
    } finally {
      setDraft((state) => {
        state.avatar.uploadBusy = false;
      });
      if (avatarFileInput) avatarFileInput.value = "";
    }
  }

  async function selectGeneratedAvatar(seed: string, color: string): Promise<void> {
    const seedColor = bloubAvatarProfile(seed, null).color;
    let hue: AvatarHue | null | undefined;
    if (automaticColorSelected() && seedColor !== color) hue = avatarHueForColor(color) ?? undefined;
    else if (
      seed === props.agent.id &&
      draft.avatar.color === null &&
      draft.avatar.hue === avatarHueForColor(seedColor)
    ) {
      hue = null;
    }
    if (avatarUrl() && !(await setCustomAvatar(null))) return;
    setDraft((state) => {
      state.avatar.seed = seed;
      if (hue !== undefined) state.avatar.hue = hue;
    });
    await saveAgentPatch(hue === undefined ? { avatarSeed: seed } : { avatarSeed: seed, avatarHue: hue });
  }

  async function selectAvatarFace(change: {
    shape?: SupportedAvatarSilhouetteId;
    expression?: ExpressionId;
    style?: AvatarStyle;
  }): Promise<void> {
    const current = avatarFace();
    const face = { shape: change.shape ?? current.shape, expression: change.expression ?? current.expression };
    const style = change.style ?? avatarStyle();
    const own = bloubAvatarProfile(props.agent.id, null);
    const seed =
      style === "plush" && own.shape === face.shape && own.expression === face.expression
        ? props.agent.id
        : avatarSeedForFace(props.agent.id, face, style);
    await selectGeneratedAvatar(seed, current.color);
  }

  async function selectModel(
    nextModel: AgentModelId,
    nextProvider: AgentProviderId,
    accountId: string | null | undefined,
    preferredEffort?: AgentReasoningEffort,
  ): Promise<void> {
    const option = findModelOption(props.modelOptions, props.agentStatus.providers, nextProvider, nextModel);
    if (!option) return;
    const previous: AgentRuntimeSettings = {
      model: draft.runtime.model,
      provider: draft.runtime.provider,
      reasoningEffort: draft.runtime.reasoningEffort,
    };
    const agentId = props.agent.id;
    const preferred = preferredEffort ?? previous.reasoningEffort;
    const settings: AgentRuntimeSettings = {
      model: nextModel,
      provider: nextProvider,
      reasoningEffort: option.supportedReasoningEfforts.includes(preferred) ? preferred : option.defaultReasoningEffort,
    };
    setDraft((state) => {
      state.runtime.provider = settings.provider;
      state.runtime.model = settings.model;
      state.runtime.reasoningEffort = settings.reasoningEffort;
    });
    const updates = accountId === undefined ? settings : { ...settings, providerAccountId: accountId };
    if (await saveRuntimeSettings(settings, updates, agentId)) return;
    if (props.agent.id !== agentId || !sameRuntimeSettings(draft.runtime, settings)) return;
    setDraft((state) => {
      state.runtime.provider = previous.provider;
      state.runtime.model = previous.model;
      state.runtime.reasoningEffort = previous.reasoningEffort;
    });
  }

  async function selectReasoning(nextReasoning: AgentReasoningEffort): Promise<void> {
    const agentId = props.agent.id;
    const previousReasoning = draft.runtime.reasoningEffort;
    const settings: AgentRuntimeSettings = {
      model: draft.runtime.model,
      provider: draft.runtime.provider,
      reasoningEffort: nextReasoning,
    };
    setDraft((state) => {
      state.runtime.reasoningEffort = nextReasoning;
    });
    if (await saveRuntimeSettings(settings, { reasoningEffort: nextReasoning }, agentId)) return;
    if (props.agent.id === agentId && sameRuntimeSettings(draft.runtime, settings)) {
      setDraft((state) => {
        state.runtime.reasoningEffort = previousReasoning;
      });
    }
  }

  async function savePermission(next: AgentPermissionLevel): Promise<void> {
    const agentId = props.agent.id;
    const update = props.onUpdatePermissions;
    if (!update) return;
    const previous = draft.permission;
    setSaveError(null);
    setDraft((state) => {
      state.permission = next;
    });
    try {
      await update(agentPermissionUpdate(agentId, next));
    } catch (error) {
      if (disposed || props.agent.id !== agentId) return;
      setSaveError(errorMessage(error, t("agentSettings.saveFailed")), error);
      if (draft.permission === next) {
        setDraft((state) => {
          state.permission = previous;
        });
      }
    }
  }

  const notificationLevelLabel = (options: AgentNotificationLevelOptions) =>
    options.current === null
      ? t("agentSettings.notificationLevel.server", { level: t(SERVER_NOTIFICATION_LEVEL_LABELS[options.serverLevel]) })
      : t(SERVER_NOTIFICATION_LEVEL_LABELS[options.current]);

  async function saveBusyMessage(next: BusyMessageChoice): Promise<void> {
    const agentId = props.agent.id;
    const previous = draft.busyMessage;
    setDraft((state) => {
      state.busyMessage = next;
    });
    if (await saveAgentPatch({ busyMessageMode: next === "default" ? null : next }, agentId)) return;
    if (!disposed && props.agent.id === agentId && draft.busyMessage === next) {
      setDraft((state) => {
        state.busyMessage = previous;
      });
    }
  }

  let backupModelsSave = 0;
  async function saveBackupModels(next: AgentBackupModels | null): Promise<void> {
    const agentId = props.agent.id;
    const previous = draft.backupModels;
    const save = ++backupModelsSave;
    setDraft((state) => {
      state.backupModels = next;
    });
    if (await saveAgentPatch({ backupModels: next }, agentId)) return;
    if (!disposed && props.agent.id === agentId && backupModelsSave === save) {
      setDraft((state) => {
        state.backupModels = previous;
      });
    }
  }

  const ownModel = (): AgentModelChoice =>
    props.agent.usageLimitReturn ?? {
      provider: draft.runtime.provider,
      model: draft.runtime.model,
      ...(props.agent.providerAccountId ? { providerAccountId: props.agent.providerAccountId } : {}),
    };
  const ownModelName = () => {
    const own = ownModel();
    return findModelOption(props.modelOptions, props.agentStatus.providers, own.provider, own.model)?.name ?? own.model;
  };

  const backupModelsSummary = () => {
    const mode = t(
      draft.backupModels?.automatic
        ? "agentSettings.backupModels.valueAutomatic"
        : "agentSettings.backupModels.valueAsk",
    );
    const count = draft.backupModels?.order.length ?? 0;
    return count > 0 ? t("agentSettings.backupModels.valueCount", { mode, count }) : mode;
  };

  const defaultBusyMessageMode = () => props.defaultBusyMessageMode ?? DEFAULT_BUSY_MESSAGE_MODE;
  const defaultBusyMessageLabels = () =>
    props.busyMessageDefaultIsHost ? HOST_DEFAULT_BUSY_MESSAGE_LABEL : APP_DEFAULT_BUSY_MESSAGE_LABEL;
  const busyMessageLabel = (choice: BusyMessageChoice) =>
    t(choice === "default" ? defaultBusyMessageLabels()[defaultBusyMessageMode()] : BUSY_MESSAGE_LABEL[choice]);
  const steerUnsupported = () => {
    const provider = knownProvider();
    return (
      provider !== undefined &&
      (draft.busyMessage === "default" ? defaultBusyMessageMode() : draft.busyMessage) === "steer" &&
      !agentSteersTurns({ provider, model: draft.runtime.model }, props.modelOptions)
    );
  };

  async function saveComputerUse(next: boolean): Promise<void> {
    const agentId = props.agent.id;
    setDraft((state) => {
      state.computerUse = next;
    });
    if (await saveAgentPatch({ computerUse: next }, agentId)) return;
    if (!disposed && props.agent.id === agentId && draft.computerUse === next) {
      setDraft((state) => {
        state.computerUse = !next;
      });
    }
  }

  async function saveAllowAutomation(next: boolean): Promise<void> {
    const agentId = props.agent.id;
    setDraft((state) => {
      state.allowAutomation = next;
    });
    if (await saveAgentPatch({ allowAutomation: next }, agentId)) return;
    if (!disposed && props.agent.id === agentId && draft.allowAutomation === next) {
      setDraft((state) => {
        state.allowAutomation = !next;
      });
    }
  }

  async function saveAllowNewChat(next: boolean): Promise<void> {
    const agentId = props.agent.id;
    setDraft((state) => {
      state.allowNewChat = next;
    });
    if (await saveAgentPatch({ allowNewChat: next }, agentId)) return;
    if (!disposed && props.agent.id === agentId && draft.allowNewChat === next) {
      setDraft((state) => {
        state.allowNewChat = !next;
      });
    }
  }

  async function saveQuickAcknowledgement(next: boolean): Promise<void> {
    const agentId = props.agent.id;
    setDraft((state) => {
      state.quickAcknowledgement = next;
    });
    if (await saveAgentPatch({ quickAcknowledgement: next }, agentId)) return;
    if (!disposed && props.agent.id === agentId && draft.quickAcknowledgement === next) {
      setDraft((state) => {
        state.quickAcknowledgement = !next;
      });
    }
  }

  async function saveMemory(next: boolean): Promise<void> {
    const agentId = props.agent.id;
    setDraft((state) => {
      state.memory = next;
    });
    if (await saveAgentPatch({ memory: next }, agentId)) return;
    if (!disposed && props.agent.id === agentId && draft.memory === next) {
      setDraft((state) => {
        state.memory = !next;
      });
    }
  }

  async function saveBrowserProfile(options: AgentBrowserProfileOptions, next: BrowserProfileChoice): Promise<void> {
    const agentId = props.agent.id;
    const previous = draft.browserProfile;
    setDraft((state) => {
      state.browserProfile = next;
    });
    setSaveError(null);
    try {
      await options.onChange(agentId, choiceBrowserProfile(next));
      if (!disposed && props.agent.id === agentId && next !== previous)
        setDraft((state) => {
          state.browserProfileMoved = true;
        });
    } catch (error) {
      if (disposed || props.agent.id !== agentId) return;
      setSaveError(errorMessage(error, t("agentSettings.saveFailed")), error);
      if (draft.browserProfile === next)
        setDraft((state) => {
          state.browserProfile = previous;
        });
    }
  }

  return (
    <SettingsPanel
      onResizeEnd={props.onResizeEnd}
      id="settings-side-panel"
      label={t("agentSettings.label")}
      width={props.width}
      maxWidth={props.maxWidth}
      onResize={props.onResize}
      preferredWidth={props.preferredWidth}
    >
      <Show when={!props.detailOpen}>
        <Show
          when={page()}
          fallback={
            <SettingsPanelHeader
              title={t("agentSettings.title")}
              paneRoot
              onBack={props.onClose}
              backLabel={t("agentSettings.backToDetails")}
              onClose={props.onClose}
              closeLabel={t("agentSettings.closeDetails")}
            />
          }
        >
          {(current) => (
            <SettingsPanelHeader
              title={t(AGENT_SETTINGS_PAGE_TITLE[current()])}
              onBack={closePage}
              backLabel={t("agentSettings.backToSettings")}
              onClose={props.onClose}
              closeLabel={t("agentSettings.closeDetails")}
            />
          )}
        </Show>
      </Show>
      <Show when={!props.detailOpen}>
        <SettingsPanelContent>
          <div ref={(element) => (pageRoot = element)} class="agent-settings-page">
            <Show when={page() === null}>
              <div ref={(element) => (avatarPickerRoot = element)} class="agent-settings-avatar-picker">
                <Popover.Root
                  open={draft.avatar.pickerOpen}
                  placement="bottom"
                  gutter={11}
                  onOpenChange={(open) =>
                    setDraft((state) => {
                      state.avatar.pickerOpen = open;
                    })
                  }
                >
                  <Popover.Trigger class="agent-settings-avatar" aria-label={t("agentSettings.avatar.edit")}>
                    <AgentAvatar
                      seed={draft.avatar.seed}
                      hue={draft.avatar.hue}
                      color={draft.avatar.color}
                      url={avatarUrl()}
                      motion="always"
                    />
                    <span class="agent-settings-avatar-badge" aria-hidden="true">
                      <Pencil class="agent-settings-avatar-badge-icon" />
                    </span>
                  </Popover.Trigger>
                  <Popover.Content class="avatar-editor" aria-hidden={draft.avatar.pickerOpen ? undefined : "true"}>
                    <Popover.Title class="sr-only">{t("agentSettings.avatar.editor")}</Popover.Title>
                    <Input
                      ref={(element) => (avatarFileInput = element)}
                      class="sr-only"
                      type="file"
                      aria-label={t("agentSettings.avatar.attachFiles")}
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      onChange={(event) => void uploadAgentAvatar(event.currentTarget.files?.[0])}
                    />
                    <div class="avatar-editor-heading">
                      <span>{t("agentSettings.avatar.image")}</span>
                      <div class="avatar-editor-actions">
                        <Show when={avatarUrl()}>
                          <Button
                            variant="outline"
                            type="button"
                            disabled={draft.avatar.uploadBusy}
                            onClick={() => void setCustomAvatar(null)}
                          >
                            {t("common.remove")}
                          </Button>
                        </Show>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      type="button"
                      class={["avatar-image-upload", { "avatar-image-upload-active": Boolean(avatarUrl()) }]}
                      disabled={draft.avatar.uploadBusy}
                      onClick={() => avatarFileInput?.click()}
                    >
                      <span class="avatar-image-upload-preview">
                        <Show
                          when={avatarUrl()}
                          fallback={
                            <svg aria-hidden="true" viewBox="0 0 24 24">
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                          }
                        >
                          <AgentAvatar
                            seed={draft.avatar.seed}
                            hue={draft.avatar.hue}
                            color={draft.avatar.color}
                            url={avatarUrl()}
                          />
                        </Show>
                      </span>
                      <span>
                        <strong>
                          {avatarUrl() ? t("agentSettings.avatar.replaceImage") : t("agentSettings.avatar.uploadImage")}
                        </strong>
                        <small>{t("agentSettings.avatar.imageHint")}</small>
                      </span>
                    </Button>
                    <div class="avatar-editor-divider" />
                    <div class="avatar-editor-heading">
                      <span>{t("agentSettings.avatar.shape")}</span>
                      <div class="avatar-editor-heading-end">
                        <SlidingTabs.Root
                          value={avatarStyle()}
                          onChange={(value) => {
                            const style = AVATAR_STYLES.find((option) => option === value);
                            if (style && style !== avatarStyle()) void selectAvatarFace({ style });
                          }}
                        >
                          <SlidingTabs.List class="avatar-style-tabs" aria-label={t("agentSettings.avatar.style")}>
                            <SlidingTabs.Trigger value="plush">
                              {t("agentSettings.avatar.stylePlush")}
                            </SlidingTabs.Trigger>
                            <SlidingTabs.Trigger value="flat">
                              {t("agentSettings.avatar.styleFlat")}
                            </SlidingTabs.Trigger>
                          </SlidingTabs.List>
                        </SlidingTabs.Root>
                        <div class="avatar-editor-actions">
                          <Show when={draft.avatar.seed !== avatarResetSeed()}>
                            <IconButton
                              variant="outline"
                              type="button"
                              label={t("agentSettings.avatar.resetToId")}
                              onClick={() =>
                                void selectGeneratedAvatar(
                                  avatarResetSeed(),
                                  bloubAvatarProfile(props.agent.id, null).color,
                                )
                              }
                            >
                              <RotateCcw aria-hidden="true" />
                            </IconButton>
                          </Show>
                          <IconButton
                            variant="outline"
                            type="button"
                            label={t("agentSettings.avatar.shuffle")}
                            onClick={() => void selectAvatarFace(randomAvatarFace(avatarFace()))}
                          >
                            <Shuffle aria-hidden="true" />
                          </IconButton>
                        </div>
                      </div>
                    </div>
                    <fieldset class="avatar-face-grid avatar-shape-grid" aria-label={t("agentSettings.avatar.shapes")}>
                      <For each={SUPPORTED_AVATAR_SILHOUETTES}>
                        {(shape, index) => (
                          <Button
                            variant="ghost"
                            type="button"
                            class={[
                              "avatar-face-choice",
                              { "avatar-choice-selected": !avatarUrl() && avatarFace().shape === shape },
                            ]}
                            aria-label={t("agentSettings.avatar.shapeOption", { number: index() + 1 })}
                            aria-pressed={!avatarUrl() && avatarFace().shape === shape ? "true" : "false"}
                            data-cuelume-tap="select"
                            onClick={() => void selectAvatarFace({ shape })}
                          >
                            <AgentAvatar
                              seed={draft.avatar.seed}
                              hue={draft.avatar.hue}
                              color={draft.avatar.color}
                              shape={shape}
                              transition="cut"
                            />
                          </Button>
                        )}
                      </For>
                    </fieldset>
                    <div class="avatar-editor-divider" />
                    <div class="avatar-editor-heading">
                      <span>{t("agentSettings.avatar.eyes")}</span>
                    </div>
                    <fieldset
                      class="avatar-face-grid avatar-eyes-grid"
                      aria-label={t("agentSettings.avatar.eyesLabel")}
                    >
                      <For each={AVATAR_EXPRESSIONS}>
                        {(expression, index) => (
                          <Button
                            variant="ghost"
                            type="button"
                            class={[
                              "avatar-face-choice",
                              { "avatar-choice-selected": !avatarUrl() && avatarFace().expression === expression },
                            ]}
                            aria-label={t("agentSettings.avatar.eyesOption", { number: index() + 1 })}
                            aria-pressed={!avatarUrl() && avatarFace().expression === expression ? "true" : "false"}
                            data-cuelume-tap="select"
                            onClick={() => void selectAvatarFace({ expression })}
                          >
                            <AgentAvatar
                              seed={draft.avatar.seed}
                              hue={draft.avatar.hue}
                              color={draft.avatar.color}
                              expression={expression}
                              transition="cut"
                            />
                          </Button>
                        )}
                      </For>
                    </fieldset>
                    <div class="avatar-editor-divider" />
                    <div class="avatar-editor-heading">
                      <span>{t("agentSettings.avatar.color")}</span>
                    </div>
                    <fieldset class="avatar-color-grid" aria-label={t("agentSettings.avatar.colorLabel")}>
                      <Button
                        variant="ghost"
                        type="button"
                        class={["avatar-color-choice", { "avatar-choice-selected": automaticColorSelected() }]}
                        aria-label={t("agentSettings.avatar.autoColor")}
                        aria-pressed={automaticColorSelected() ? "true" : "false"}
                        data-cuelume-tap="select"
                        onClick={() => {
                          setDraft((state) => {
                            state.avatar.hue = null;
                            state.avatar.color = null;
                          });
                          void saveAgentPatch({ avatarHue: null, avatarColor: null });
                        }}
                      >
                        <span class="avatar-color-swatch avatar-color-swatch-auto">
                          {t("agentSettings.avatar.autoInitial")}
                        </span>
                      </Button>
                      <For each={AVATAR_COLOR_CHOICES}>
                        {(option) => (
                          <Button
                            variant="ghost"
                            type="button"
                            class={["avatar-color-choice", { "avatar-choice-selected": avatarColorSelected(option) }]}
                            aria-label={t("agentSettings.avatar.hueColor", { hue: t(avatarColorChoiceLabel(option)) })}
                            aria-pressed={avatarColorSelected(option) ? "true" : "false"}
                            data-cuelume-tap="select"
                            onClick={() => {
                              setDraft((state) => {
                                state.avatar.hue = option.hue;
                                state.avatar.color = option.color;
                              });
                              void saveAgentPatch({ avatarHue: option.hue, avatarColor: option.color });
                            }}
                          >
                            <span class="avatar-color-swatch" style={{ background: option.swatch }} />
                          </Button>
                        )}
                      </For>
                    </fieldset>
                  </Popover.Content>
                </Popover.Root>
              </div>
              <SettingsField label={t("agentSettings.name")}>
                <Input
                  value={draft.fields.name}
                  aria-label={t("agentSettings.nameLabel")}
                  maxlength={INPUT_LIMITS.agentName}
                  onValueChange={(value) =>
                    setDraft((state) => {
                      state.fields.name = value;
                      state.dirty.name = true;
                    })
                  }
                  onBlur={saveName}
                />
              </SettingsField>
              <SettingsField label={t("agentSettings.agentTitle")}>
                <Input
                  value={draft.fields.title}
                  aria-label={t("agentSettings.agentTitleLabel")}
                  placeholder={t("agentSettings.agentTitlePlaceholder")}
                  maxlength={INPUT_LIMITS.agentTitle}
                  onValueChange={(value) =>
                    setDraft((state) => {
                      state.fields.title = value;
                      state.dirty.title = true;
                    })
                  }
                  onBlur={saveTitle}
                />
              </SettingsField>
              <SettingsField label={t("agentSettings.description")}>
                <ResizableTextarea
                  class="settings-instructions-input settings-description-input"
                  rows="3"
                  value={draft.fields.description}
                  aria-label={t("agentSettings.descriptionLabel")}
                  resizeLabel={t("agentSettings.descriptionResize")}
                  placeholder={t("agentSettings.descriptionPlaceholder")}
                  invalid={instructionsTooLong(draft.fields.description)}
                  onValueChange={(value) => {
                    setDraft((state) => {
                      state.fields.description = value;
                      state.dirty.description = true;
                    });
                    scheduleInstructionsSave(value);
                  }}
                  onBlur={saveDescription}
                />
                <InstructionsLimit text={draft.fields.description} tooLong="agent.description.tooLong" />
              </SettingsField>
              <SettingsLinkGroup inset class="agent-settings-runtime-rows" title={t("agentSettings.groups.brain")}>
                <ProviderModelPicker
                  variant="field"
                  icon={
                    <span class="settings-link-icon">
                      <Cpu aria-hidden="true" />
                    </span>
                  }
                  ariaLabel={t("agentSettings.runtime.model")}
                  provider={draft.runtime.provider}
                  foreignProvider={agentForeignProvider()}
                  value={draft.runtime.model}
                  agentStatus={props.agentStatus}
                  modelOptions={props.modelOptions}
                  runtimeStatuses={props.providerRuntimeStatuses}
                  customProviders={props.customProviders}
                  customAgents={props.customAgents}
                  onDownloadProvider={props.onDownloadProvider}
                  onCancelProviderDownload={props.onCancelProviderDownload}
                  onConnectProvider={props.onConnectProvider}
                  canConnectProvider={props.canConnectProvider}
                  onManageProviders={props.onManageProviders}
                  onOpen={props.onOpenModelPicker}
                  disabledReason={t("agentSettings.runtime.modelUnavailable")}
                  accountChoice
                  providerAccountId={agentNextProviderAccountId(props.agent)}
                  workspaceOnly={workspaceAccessEnforced(props.agent)}
                  onChange={(nextModel, provider, accountId, effort) =>
                    void selectModel(nextModel, provider, accountId, effort)
                  }
                  reasoningEffort={draft.runtime.reasoningEffort}
                  onReasoningEffortChange={(effort) => {
                    if (effort !== draft.runtime.reasoningEffort) void selectReasoning(effort);
                  }}
                  fastMode={props.fastMode}
                  ultrafast={props.ultrafast}
                  onFastModeChange={props.onFastModeChange}
                />
              </SettingsLinkGroup>
              <Show when={props.backupModelsEditable}>
                <SettingsLinkGroup inset>
                  <SettingsLinkRow
                    ref={pageRowRef("backup-models")}
                    icon={<ArrowLeftRight aria-hidden="true" />}
                    label={t("agentSettings.backupModels.title")}
                    value={backupModelsSummary()}
                    onClick={() => openPage("backup-models")}
                  />
                </SettingsLinkGroup>
              </Show>
              <Show when={props.agent.id} keyed>
                {(agentId) => (
                  <AgentChatColorRow
                    agentName={props.agent.name}
                    value={props.agent.chatColor ?? null}
                    onChange={(chatColor) => void saveAgentPatch({ chatColor }, agentId)}
                  />
                )}
              </Show>
              {props.links}
              <SettingsLinkGroup inset title={t("agentSettings.groups.rules")}>
                <SettingsLinkRow
                  ref={pageRowRef("permissions")}
                  icon={<ShieldCheck aria-hidden="true" />}
                  label={t("agentSettings.permissions.title")}
                  value={t(ACCESS_LABEL[draft.permission])}
                  onClick={() => openPage("permissions")}
                />
                <Show when={props.folders}>
                  <AgentFoldersRow
                    ref={pageRowRef("folders")}
                    folders={agentFolders}
                    wideAccess={wideAccess()}
                    onOpen={() => openPage("folders")}
                  />
                </Show>
                <SettingsLinkRow
                  ref={pageRowRef("advanced")}
                  icon={<SlidersHorizontal aria-hidden="true" />}
                  label={t("agentSettings.advanced.title")}
                  onClick={() => openPage("advanced")}
                />
              </SettingsLinkGroup>
              <Show when={props.notificationLevel}>
                {(options) => (
                  <>
                    <SettingsLinkGroup inset class="agent-settings-runtime-rows">
                      <SettingsLinkRow
                        icon={<Bell aria-hidden="true" />}
                        label={t("agentSettings.notificationLevel.title")}
                        value={notificationLevelLabel(options())}
                        onClick={(trigger) => options().onOpen(trigger)}
                      />
                    </SettingsLinkGroup>
                    <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
                      {t("agentSettings.notificationLevel.note")}
                    </Text>
                  </>
                )}
              </Show>
            </Show>
            <Show when={page() === "permissions"}>
              <Show when={props.onUpdatePermissions}>
                <SettingsLinkGroup inset class="agent-settings-runtime-rows">
                  <Select<AgentPermissionLevel>
                    class="agent-settings-runtime-select"
                    options={[...agentPermissionLevels(knownProvider(), currentPermission())]}
                    value={draft.permission}
                    onChange={(next) => {
                      if (!next || next === draft.permission) return;
                      if (widensAgentPermission(draft.permission, next)) {
                        setDraft((state) => {
                          state.confirmingPermission = next;
                        });
                      } else void savePermission(next);
                    }}
                    itemComponent={(item) => (
                      <SelectItem item={item.item}>{t(ACCESS_LABEL[item.item.rawValue])}</SelectItem>
                    )}
                  >
                    <SelectTrigger
                      class="agent-settings-runtime-row"
                      aria-label={t("agentSettings.runtime.accessLabel")}
                    >
                      <span class="agent-settings-runtime-label">{t("agentSettings.runtime.access")}</span>
                      <SelectValue<AgentPermissionLevel>>
                        {(state) => t(ACCESS_LABEL[state.selectedOption() ?? draft.permission])}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </SettingsLinkGroup>
              </Show>
              <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
                <Show
                  when={draft.permission === "workspace"}
                  fallback={
                    <>
                      {t("agentSettings.runtime.fullAccessNote")}{" "}
                      {draft.permission === "ask"
                        ? t("agentSettings.runtime.askNote")
                        : t("agentSettings.runtime.fullNote")}
                    </>
                  }
                >
                  {t("agentSettings.runtime.workspaceNote")}{" "}
                  {agentForeignProvider() === undefined ? workspaceEnforcementNote(draft.runtime.provider) : null}{" "}
                  {t("agentSettings.runtime.workspaceUnlimited")}
                </Show>
              </Text>
              <Show when={props.computerUseEditable}>
                <div class="agent-settings-notifications">
                  <div>
                    <strong>{t("agentSettings.computerUse.title")}</strong>
                    <span>{t("agentSettings.computerUse.description")}</span>
                  </div>
                  <Switch
                    size="sm"
                    aria-label={t("agentSettings.computerUse.title")}
                    checked={draft.computerUse}
                    onChange={(next) => void saveComputerUse(next)}
                  />
                </div>
              </Show>
              <Show when={props.automationEditable}>
                <div class="agent-settings-notifications">
                  <div>
                    <strong>{t("agentSettings.automation.title")}</strong>
                    <span>{t("agentSettings.automation.description")}</span>
                  </div>
                  <Switch
                    size="sm"
                    aria-label={t("agentSettings.automation.title")}
                    checked={draft.allowAutomation}
                    onChange={(next) => void saveAllowAutomation(next)}
                  />
                </div>
              </Show>
            </Show>
            <Show when={page() === "folders"}>
              <AgentFoldersPage
                folders={agentFolders}
                agentName={props.agent.name}
                wideAccess={wideAccess()}
                workspaceAccess={t(ACCESS_LABEL.workspace)}
                showExclusions={draft.permission === "workspace" || wideAccess() !== null}
                onChangeAccess={() => openPage("permissions")}
              />
            </Show>
            <Show when={page() === "backup-models"}>
              <BackupModelsPage
                agentName={props.agent.name}
                own={ownModel()}
                ownModel={ownModelName()}
                value={draft.backupModels}
                source={{
                  modelOptions: props.modelOptions,
                  providers: props.agentStatus.providers,
                  limited: props.usageLimited,
                  failed: props.providerFailed,
                }}
                onChange={(next) => void saveBackupModels(next)}
              />
            </Show>
            <Show when={page() === "advanced"}>
              <SettingsLinkGroup inset class="agent-settings-runtime-rows">
                <Show when={props.busyMessageModeEditable}>
                  <Select<BusyMessageChoice>
                    class="agent-settings-runtime-select"
                    options={[...BUSY_MESSAGE_CHOICES]}
                    value={draft.busyMessage}
                    onChange={(next) => {
                      if (!next || next === draft.busyMessage) return;
                      void saveBusyMessage(next);
                    }}
                    itemComponent={(item) => (
                      <SelectItem item={item.item}>{busyMessageLabel(item.item.rawValue)}</SelectItem>
                    )}
                  >
                    <SelectTrigger
                      class="agent-settings-runtime-row"
                      aria-label={t("agentSettings.runtime.busyMessageLabel")}
                    >
                      <span class="agent-settings-runtime-label">{t("agentSettings.runtime.busyMessage")}</span>
                      <SelectValue<BusyMessageChoice>>
                        {(state) => busyMessageLabel(state.selectedOption() ?? "default")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </Show>
                <Show when={props.browserProfiles}>
                  {(options) => (
                    <BrowserProfileSelect
                      value={draft.browserProfile}
                      profiles={options().profiles}
                      onChange={(next) => void saveBrowserProfile(options(), next)}
                      onCreate={options().onCreate}
                    />
                  )}
                </Show>
                <div class="agent-settings-runtime-path">
                  <span class="agent-settings-runtime-label">{t("agentSettings.runtime.workingDirectory")}</span>
                  <span>
                    {props.agent.workspacePath
                      ? breakablePath(props.agent.workspacePath)
                      : t("agentSettings.runtime.notAvailable")}
                  </span>
                </div>
              </SettingsLinkGroup>
              <Show when={props.browserProfiles && draft.browserProfileMoved}>
                <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="warning" role="status">
                  {t("agentSettings.browserProfile.movedNote")}
                </Text>
              </Show>
              <Show when={props.busyMessageModeEditable && steerUnsupported()}>
                <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
                  {t("agentSettings.busyMessage.steerUnsupported", {
                    provider: agentProviderName(draft.runtime.provider),
                  })}
                </Text>
              </Show>
              <Show when={props.onStartNewChat}>
                <div class="agent-settings-notifications">
                  <div>
                    <strong>{t("agentSettings.newChat.title")}</strong>
                    <span>{t("agentSettings.newChat.description")}</span>
                  </div>
                  <Button
                    variant="outline"
                    type="button"
                    aria-label={t("agentSettings.newChat.confirm")}
                    aria-haspopup="dialog"
                    onClick={() => {
                      if (props.working) {
                        toast.info(t("agentSettings.newChat.busy"), { id: "agent-new-chat-busy" });
                        return;
                      }
                      setNewChatOpen(true);
                    }}
                  >
                    {t("agentSettings.newChat.button")}
                  </Button>
                </div>
              </Show>
              <Show when={props.onDeleteHistory}>
                <div class="agent-settings-notifications">
                  <div>
                    <strong>{t("agentSettings.deleteHistory.title")}</strong>
                    <span>{t("agentSettings.deleteHistory.description")}</span>
                  </div>
                  <Button
                    variant="destructive"
                    type="button"
                    aria-label={t("agentSettings.deleteHistory.confirm")}
                    aria-haspopup="dialog"
                    disabled={props.working}
                    onClick={() => setDeleteHistoryOpen(true)}
                  >
                    {t("agentSettings.deleteHistory.button")}
                  </Button>
                </div>
              </Show>
              <Show when={props.newChatEditable}>
                <div class="agent-settings-notifications">
                  <div>
                    <strong>{t("agentSettings.agentNewChat.title")}</strong>
                    <span>{t("agentSettings.agentNewChat.description")}</span>
                  </div>
                  <Switch
                    size="sm"
                    aria-label={t("agentSettings.agentNewChat.title")}
                    checked={draft.allowNewChat}
                    onChange={(next) => void saveAllowNewChat(next)}
                  />
                </div>
              </Show>
              <Show when={props.quickAcknowledgementEditable}>
                <div class="agent-settings-notifications">
                  <div>
                    <strong>{t("agentSettings.quickAcknowledgement.title")}</strong>
                    <span>{t("agentSettings.quickAcknowledgement.description")}</span>
                  </div>
                  <Switch
                    size="sm"
                    aria-label={t("agentSettings.quickAcknowledgement.title")}
                    checked={draft.quickAcknowledgement}
                    onChange={(next) => void saveQuickAcknowledgement(next)}
                  />
                </div>
              </Show>
              <Show when={props.builtinMemoryEditable}>
                <div class="agent-settings-notifications">
                  <div>
                    <strong>{t("agentSettings.builtinMemory.title")}</strong>
                    <span>{t("agentSettings.builtinMemory.description")}</span>
                  </div>
                  <Switch
                    size="sm"
                    aria-label={t("agentSettings.builtinMemory.title")}
                    checked={draft.memory}
                    onChange={(next) => void saveMemory(next)}
                  />
                </div>
              </Show>
              <Show when={props.browserProfiles}>
                {(options) => (
                  <div class="agent-settings-notifications">
                    <div>
                      <strong>{t("agentSettings.browserProfile.manageTitle")}</strong>
                      <span>{t("agentSettings.browserProfile.manageDescription")}</span>
                    </div>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={(event) => options().onManage(event.currentTarget)}
                    >
                      {t("agentSettings.browserProfile.manage")}
                    </Button>
                  </div>
                )}
              </Show>
              <Show when={props.onDeleteAgent}>
                <div class="agent-settings-notifications">
                  <div>
                    <strong>{t("agentSettings.deleteAgent.title")}</strong>
                    <span>{t("agentSettings.deleteAgent.description")}</span>
                  </div>
                  <Button
                    variant="destructive"
                    type="button"
                    aria-label={t("agentSettings.deleteAgent.title")}
                    aria-haspopup="dialog"
                    onClick={() => setAgentToDelete({ ...props.agent })}
                  >
                    {t("agentSettings.deleteAgent.button")}
                  </Button>
                </div>
              </Show>
            </Show>
            <Show when={draft.saveError}>
              {(message) => (
                <p class="agent-settings-save-error" role="alert">
                  {message()}
                  <ErrorReference reference={draft.saveErrorReference} />
                </p>
              )}
            </Show>
          </div>
        </SettingsPanelContent>
        <Show when={props.onStartNewChat}>
          {(start) => (
            <AgentNewChatDialog
              agent={props.agent}
              open={newChatOpen()}
              onClose={() => setNewChatOpen(false)}
              start={() => start()()}
            />
          )}
        </Show>
        <Show when={props.onDeleteHistory}>
          {(remove) => (
            <AgentDeleteHistoryDialog
              agent={props.agent}
              open={deleteHistoryOpen()}
              onClose={() => setDeleteHistoryOpen(false)}
              remove={() => remove()()}
            />
          )}
        </Show>
        <Show when={props.onDeleteAgent && agentToDelete()}>
          {(agent) => (
            <AgentDeleteDialog
              agent={agent()}
              onClose={() => setAgentToDelete(null)}
              remove={() => props.onDeleteAgent?.(agent().id) ?? Promise.resolve()}
            />
          )}
        </Show>
        <ConfirmDialog
          open={draft.confirmingPermission !== null}
          tone="default"
          initialFocus="cancel"
          title={t(
            draft.confirmingPermission === "ask"
              ? "agentSettings.fullAccess.askTitle"
              : "agentSettings.fullAccess.title",
          )}
          description={widenDescription()}
          cancelLabel={t("common.cancel")}
          confirmLabel={t(
            draft.confirmingPermission === "ask"
              ? "agentSettings.fullAccess.askConfirm"
              : "agentSettings.fullAccess.confirm",
          )}
          onCancel={() =>
            setDraft((state) => {
              state.confirmingPermission = null;
            })
          }
          onConfirm={() => {
            const next = draft.confirmingPermission;
            setDraft((state) => {
              state.confirmingPermission = null;
            });
            if (next) void savePermission(next);
          }}
        />
      </Show>
      {props.children}
    </SettingsPanel>
  );
}

export function breakablePath(path: string) {
  return path.split("/").map((part, index) =>
    index === 0 ? (
      part
    ) : (
      <>
        /<wbr />
        {part}
      </>
    ),
  );
}

function sameRuntimeSettings(current: AgentRuntimeSettings, settings: AgentRuntimeSettings): boolean {
  return (
    current.provider === settings.provider &&
    current.model === settings.model &&
    current.reasoningEffort === settings.reasoningEffort
  );
}

const BUSY_MESSAGE_CHOICES = ["default", "queue", "steer"] as const;
type BusyMessageChoice = (typeof BUSY_MESSAGE_CHOICES)[number];

const BUSY_MESSAGE_LABEL = {
  queue: "agentSettings.busyMessage.queue",
  steer: "agentSettings.busyMessage.steer",
} as const satisfies Record<BusyMessageMode, AppTextKey>;

const APP_DEFAULT_BUSY_MESSAGE_LABEL = {
  queue: "agentSettings.busyMessage.appDefaultQueue",
  steer: "agentSettings.busyMessage.appDefaultSteer",
} as const satisfies Record<BusyMessageMode, AppTextKey>;

const HOST_DEFAULT_BUSY_MESSAGE_LABEL = {
  queue: "agentSettings.busyMessage.hostDefaultQueue",
  steer: "agentSettings.busyMessage.hostDefaultSteer",
} as const satisfies Record<BusyMessageMode, AppTextKey>;

const ACCESS_LABEL = {
  workspace: "agentSettings.access.workspace",
  ask: "agentSettings.access.ask",
  full: "agentSettings.access.full",
} as const satisfies Record<AgentPermissionLevel, AppTextKey>;

function randomAvatarFace(current: { shape: SupportedAvatarSilhouetteId; expression: ExpressionId }): {
  shape: SupportedAvatarSilhouetteId;
  expression: ExpressionId;
} {
  return {
    shape: randomOther(SUPPORTED_AVATAR_SILHOUETTES, current.shape),
    expression: randomOther(AVATAR_EXPRESSIONS, current.expression),
  };
}

function randomOther<T>(items: readonly T[], current: T): T {
  const others = items.filter((item) => item !== current);
  return others[Math.floor(Math.random() * others.length)] ?? current;
}
