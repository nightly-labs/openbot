import { agentProviderDescriptor, agentProviderName, foreignProvider } from "@openbot/contracts/agent-providers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_TASK_LIMIT_DEFAULT,
  AGENT_TASK_LIMIT_MAX,
  type AgentBackupModels,
  type AgentBrowserProfile,
  type AgentDefaults,
  type AgentModelChoice,
  type AgentModelId,
  type AgentPermissionLevel,
  type AgentProviderId,
  type AgentReasoningEffort,
  type AgentStatus,
  type AvatarHue,
  type AvatarImageInput,
  agentAutomationAllowed,
  agentBrowserProfile,
  agentComputerUseEnabled,
  agentNewChatAllowed,
  agentNextProviderAccountId,
  agentPermissionLevel,
  agentPermissionLevels,
  agentPermissionUpdate,
  agentQuickAcknowledgementEnabled,
  type BrowserProfileSummary,
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
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  ArrowLeftRight,
  Bell,
  Brain,
  Button,
  ConfirmDialog,
  Cpu,
  ErrorReference,
  IconButton,
  Input,
  Pencil,
  Popover,
  RefreshCw,
  RotateCcw,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ShieldCheck,
  SlidersHorizontal,
  Switch,
  Text,
} from "@openbot/ui";
import { normalizeAvatarFile } from "@openbot/ui/avatar-image";
import { AVATAR_HUE_OPTIONS, avatarCandidateSeeds, avatarHueSwatch } from "@openbot/ui/bloub-avatar";
import { ProviderModelPicker, reasoningLabel } from "@openbot/ui/components/ProviderModelPicker";
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
import { type BrowserProfileChoice, BrowserProfileSelect } from "@openbot/ui/features/browser/BrowserProfileSelect";
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
import { AVATAR_HUE_LABEL } from "../agents/avatar-hue-label";
import { SERVER_NOTIFICATION_LEVEL_LABELS } from "../servers/ServerActionItems";
import { type AgentFolderCalls, AgentFoldersPage, AgentFoldersRow, createAgentFolders } from "./AgentFolders";
import { AgentNewChatDialog } from "./AgentNewChatDialog";
import { BackupModelsPage } from "./BackupModels";

export interface AgentRuntimeSettings {
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
}

/** A model choice can also move the agent to another account of its provider. */
export type AgentRuntimeSettingsPatch =
  | (AgentRuntimeSettings & Pick<UpdateAgentInput, "providerAccountId">)
  | Pick<AgentRuntimeSettings, "reasoningEffort">;

export interface AgentSettingsPanelProps {
  agent: AgentProfile;
  runtimeSettings: AgentRuntimeSettings;
  agentStatus: AgentStatus;
  modelOptions: ClientAgentModelOption[];
  working: boolean;
  /** Unknown while a remote host has not sent it; the level then shows as if it were on. */
  autoApprove?: boolean | undefined;
  /** Writes the Permissions level. Without it, the level is read-only. */
  onUpdatePermissions?: ((input: UpdateAgentAdminSettingsInput) => Promise<void>) | undefined;
  /** Computer Use is local-only too, and no remote host administers it yet. */
  computerUseEditable?: boolean;
  /** Local scripts can be changed locally or through the host's administrator route. */
  automationEditable?: boolean;
  /** Whether the agent can start a new chat. Local-only: the Team API does not carry it. */
  newChatEditable?: boolean;
  /** Whether the agent shows its plan before a long task. Local-only: the Team API does not carry it. */
  quickAcknowledgementEditable?: boolean;
  /** The browser profile of the agent's tabs. Left out when the host cannot change it. */
  browserProfiles?: AgentBrowserProfileOptions | undefined;
  /** The user's own notification level for the agent. Left out when the server cannot keep it. */
  notificationLevel?: AgentNotificationLevelOptions | undefined;
  /** The busy-message setting can be changed locally or through the host's administrator route. */
  busyMessageModeEditable?: boolean;
  /** Whether the busy-message default belongs to a joined server's host, not to this app. */
  busyMessageDefaultIsHost?: boolean;
  /** Tasks run only on this computer: the Team API has no task route. */
  taskLimitEditable?: boolean;
  /** Backup models are local-only too: the Team API does not carry them. */
  backupModelsEditable?: boolean;
  /** The folders the agent can change besides its workspace. Local-only: the Team API does not carry them. */
  folders?: AgentFolderCalls | undefined;
  /** Whether a usage limit holds this model and account now, for the backup models page. */
  usageLimited?: ((choice: AgentModelChoice) => boolean) | undefined;
  /** The app or host default an agent without its own busy-message setting follows. */
  defaultBusyMessageMode?: BusyMessageMode | undefined;
  /** The account defaults an agent without its own value follows. Absent for a remote agent. */
  agentDefaults?: AgentDefaults | undefined;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  /** The caller supplies providers available on the selected host. */
  customProviders?: readonly CustomProviderSummary[] | undefined;
  /** The user's own ACP agents on this computer, for the model picker's Custom tab. */
  customAgents?: readonly CustomAgentSummary[] | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onConnectProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  canConnectProvider?: ((provider: AgentProviderId) => boolean) | undefined;
  /** Opens the provider settings from the model picker. */
  onManageProviders?: ((trigger: HTMLElement) => void) | undefined;
  maxWidth: () => number;
  onClose: () => void;
  width: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  /** Application-owned navigation and detail surfaces, in the existing panel layout. */
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
  /**
   * Starts a new chat with the agent after the user confirms. The agent forgets the messages before
   * it and keeps its setup. Left out when the host cannot do it.
   */
  onStartNewChat?: (() => Promise<void>) | undefined;
}

export interface AgentBrowserProfileOptions {
  /** The named profiles of the computer that runs the agent. Undefined while they load. */
  profiles: readonly Pick<BrowserProfileSummary, "id" | "name" | "hue">[] | undefined;
  /**
   * The agent's choice, as its host gives it. The summary of an agent on a joined server does not
   * carry it; absent, the panel reads it from the agent.
   */
  current?: AgentBrowserProfile | undefined;
  /** Saves the choice. The host closes the agent's open tabs. */
  onChange: (agentId: string, profile: AgentBrowserProfile) => Promise<void>;
  /** Makes a named profile and returns its id. */
  onCreate: (name: string) => Promise<string>;
  /** Opens the profiles in the settings of the computer that runs the agent. */
  onManage: (trigger: HTMLElement) => void;
}

export interface AgentNotificationLevelOptions {
  /** The level that the user chose for the agent. Null follows the server level. */
  current: ServerNotificationLevel | null;
  /** The level of the server. It applies while `current` is null. */
  serverLevel: ServerNotificationLevel;
  /** Opens the notification settings, the one place where the user changes the level. */
  onOpen: (trigger: HTMLElement) => void;
}

function browserProfileChoice(profile: AgentBrowserProfile): BrowserProfileChoice {
  return profile.kind === "profile" ? profile.profileId : profile.kind;
}

function choiceBrowserProfile(choice: BrowserProfileChoice): AgentBrowserProfile {
  return choice === "shared" || choice === "agent" ? { kind: choice } : { kind: "profile", profileId: choice };
}

const INSTRUCTIONS_SAVE_DELAY_MS = 400;

/**
 * The pages behind the root list. The root edits the agent's face, name, title and instructions
 * in place, as the mobile app does, and shows one row for each page.
 */
type AgentSettingsPage = "permissions" | "folders" | "backup-models" | "advanced";

const PAGE_TITLE: Record<AgentSettingsPage, AppTextKey> = {
  permissions: "agentSettings.permissions.title",
  folders: "agentSettings.folders.title",
  "backup-models": "agentSettings.backupModels.title",
  advanced: "agentSettings.advanced.title",
};

/** The three free-text fields of the panel, each with a flag for edits made since the last save. */
interface AgentTextFields {
  description: string;
  name: string;
  title: string;
}

interface AvatarEditor {
  batch: number;
  candidateSeed: string;
  hue: AvatarHue | null;
  pickerOpen: boolean;
  seed: string;
  uploadBusy: boolean;
}

/**
 * Everything the panel is editing for the agent it currently shows. `fields` and `dirty` stay
 * parallel records so the props sync can write every field the user has not touched; `runtime` is
 * one record because the three settings are sent, and rolled back, together.
 */
interface AgentSettingsDraft {
  avatar: AvatarEditor;
  dirty: Record<keyof AgentTextFields, boolean>;
  fields: AgentTextFields;
  permission: AgentPermissionLevel;
  computerUse: boolean;
  allowAutomation: boolean;
  allowNewChat: boolean;
  quickAcknowledgement: boolean;
  browserProfile: BrowserProfileChoice;
  /** `default` follows the app setting. */
  busyMessage: BusyMessageChoice;
  /** `default` is `AGENT_TASK_LIMIT_DEFAULT`. */
  taskLimit: TaskLimitChoice;
  /** Null asks first, with no saved order. */
  backupModels: AgentBackupModels | null;
  /** A level that gives the agent more freedom waits here for the confirmation. */
  confirmingPermission: AgentPermissionLevel | null;
  runtime: AgentRuntimeSettings;
  saveError: string | null;
  /** The code of the failure behind `saveError`. */
  saveErrorReference: string | null;
}

interface TextSaveRequest {
  agentId: string;
  draftValue: string;
  field: keyof AgentTextFields;
  storedValue: string;
}

export default function AgentSettingsPanel(props: AgentSettingsPanelProps) {
  const { t, errorMessage, format } = useText();
  const agentDefaults = () => props.agentDefaults ?? DEFAULT_AGENT_DEFAULTS;
  const [newChatOpen, setNewChatOpen] = createSignal(false);
  const [draft, setDraft] = createStore<AgentSettingsDraft>({
    avatar: {
      batch: 0,
      candidateSeed: "agent",
      hue: null,
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
    browserProfile: "shared",
    busyMessage: "default",
    taskLimit: "default",
    backupModels: null,
    confirmingPermission: null,
    runtime: untrack(() => ({ ...props.runtimeSettings })),
    saveError: null,
    saveErrorReference: null,
  });
  const avatarUrl = () => props.agent.avatarUrl ?? null;
  const [page, setPage] = createSignal<AgentSettingsPage | null>(null);
  // The root row that opened the closed page takes the focus back when the root shows again.
  let returnFocusPage: AgentSettingsPage | null = null;

  function pageRowRef(target: AgentSettingsPage) {
    return (element: HTMLButtonElement) => {
      if (returnFocusPage !== target) return;
      returnFocusPage = null;
      queueMicrotask(() => element.focus());
    };
  }

  let pageRoot: HTMLDivElement | undefined;

  /**
   * The row that opened the page is gone, so the focus moves to the first control of the page.
   * A page with no control, such as read-only permissions, gives the focus to the back button.
   */
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

  function closePage(): void {
    returnFocusPage = page();
    setPage(null);
  }

  function folderSource() {
    const calls = props.folders;
    return calls ? { agentId: props.agent.id, agentName: props.agent.name, calls } : undefined;
  }
  const agentFolders = createAgentFolders(folderSource);
  // Each activity of the agent gives a new agent object, so the list loads again only when the
  // agent, its saved or excluded folders or the page change. The page opening reads which folders
  // are gone.
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

  /**
   * The access label when the agent can change all files: the folders then do not apply. They still
   * apply to a provider whose own file tools reach only its folders.
   */
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

  /** Leaving the workspace warns about reach; reaching Full access warns that the agent stops asking. */
  function widenDescription(): string {
    const reach = draft.permission === "workspace" ? `${t("agentSettings.fullAccess.description")} ` : "";
    return draft.confirmingPermission === "ask"
      ? `${reach}${t("agentSettings.runtime.askNote")}`
      : `${reach}${t("agentSettings.fullAccess.noApproval")}`;
  }

  /** The message under the form: every save path clears it first and reports its failure through it. */
  function setSaveError(message: string | null, cause?: unknown): void {
    setDraft((state) => {
      state.saveError = message;
      state.saveErrorReference = message === null || cause === undefined ? null : errorReference(cause);
    });
  }

  const selectedModel = createMemo(() =>
    props.modelOptions.find(
      (option) => option.provider === draft.runtime.provider && option.id === draft.runtime.model,
    ),
  );
  const reasoningOptions = createMemo(() => selectedModel()?.supportedReasoningEfforts ?? ["medium" as const]);
  // The provider has no reasoning setting for this model, and the `medium` it lists is never sent.
  const reasoningSetByProvider = () => selectedModel()?.reasoningEffortConfigurable === false;
  /** The agent's provider when this build does not know it: its runtime rows cannot change. */
  const agentForeignProvider = () => foreignProvider(props.agent.provider);
  /** The provider whose capabilities apply. A foreign agent leaves `draft.runtime.provider` stale. */
  const knownProvider = () => (agentForeignProvider() === undefined ? draft.runtime.provider : undefined);
  const avatarCandidates = createMemo(() =>
    avatarCandidateSeeds(props.agent.id, draft.avatar.candidateSeed, draft.avatar.batch),
  );
  let avatarPickerRoot: HTMLDivElement | undefined;
  let avatarFileInput: HTMLInputElement | undefined;
  let lastSignature: string | undefined;
  let lastAgentId: string | undefined;
  // Instructions save while the field remains focused. One queue also keeps blur, panel-close and
  // agent-change saves ordered, so an older completion cannot declare a newer draft clean.
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
          browserProfile,
          agent.busyMessageMode ?? "default",
          String(agent.taskLimit ?? "default"),
          JSON.stringify(agent.backupModels ?? null),
          runtimeSettings.provider,
          runtimeSettings.model,
          runtimeSettings.reasoningEffort,
          agent.avatarSeed,
          String(agent.avatarHue),
        ].join("\u0000"),
      };
    },
    ({ agent, runtimeSettings, browserProfile, signature }) =>
      untrack(() => {
        if (signature === lastSignature) return;
        const agentChanged = agent.id !== lastAgentId;
        if (agentChanged && lastAgentId) flushDirtyTextFields(lastAgentId);
        // A field the user has edited keeps its draft, unless this is a different agent, whose values
        // replace the panel wholesale. Read before the write, so a fresh agent clears the flags here.
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
          state.browserProfile = browserProfile;
          state.busyMessage = agent.busyMessageMode ?? "default";
          state.taskLimit = taskLimitChoice(agent.taskLimit);
          state.backupModels = agent.backupModels ?? null;
          if (agentChanged) state.confirmingPermission = null;
          state.runtime.provider = runtimeSettings.provider;
          state.runtime.model = runtimeSettings.model;
          state.runtime.reasoningEffort = runtimeSettings.reasoningEffort;
          state.avatar.seed = agent.avatarSeed;
          state.avatar.hue = agent.avatarHue;
          if (agentChanged) {
            state.avatar.candidateSeed = agent.avatarSeed;
            state.avatar.batch = 0;
            state.avatar.pickerOpen = false;
          }
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
    if (lastAgentId) flushDirtyTextFields(lastAgentId);
    disposed = true;
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
      if (!disposed && props.agent.id === agentId) {
        setSaveError(errorMessage(error, t("agentSettings.saveFailed")), error);
      }
      return false;
    }
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
    // Instructions over the limit stay in the field, unsaved, until the user shortens them.
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
      if (props.agent.id === agentId) {
        setSaveError(errorMessage(error, t("agentSettings.saveFailed")), error);
      }
      return false;
    }
  }

  function saveName(): void {
    const value = draft.fields.name.trim() || t("agent.setup.nameFallback");
    setDraft((state) => {
      state.fields.name = value;
    });
    queueTextSave(textSaveRequest("name", props.agent.id));
  }

  function saveTitle(): void {
    const value = draft.fields.title.trim();
    setDraft((state) => {
      state.fields.title = value;
    });
    queueTextSave(textSaveRequest("title", props.agent.id));
  }

  function saveDescription(): void {
    cancelInstructionsSaveTimer();
    queueTextSave(textSaveRequest("description", props.agent.id));
  }

  async function setCustomAvatar(image: AvatarImageInput | null): Promise<boolean> {
    if (draft.avatar.uploadBusy) return false;
    setDraft((state) => {
      state.avatar.uploadBusy = true;
      state.saveError = null;
    });
    try {
      await props.onSetAgentAvatar(props.agent.id, image);
      return true;
    } catch (error) {
      setSaveError(errorMessage(error, t("agentSettings.avatar.saveFailed")), error);
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
    try {
      const image = await normalizeAvatarFile(file);
      await props.onSetAgentAvatar(props.agent.id, image);
    } catch (error) {
      setSaveError(errorMessage(error, t("agentSettings.avatar.processFailed")), error);
    } finally {
      setDraft((state) => {
        state.avatar.uploadBusy = false;
      });
      if (avatarFileInput) avatarFileInput.value = "";
    }
  }

  async function selectGeneratedAvatar(seed: string): Promise<void> {
    if (avatarUrl() && !(await setCustomAvatar(null))) return;
    setDraft((state) => {
      state.avatar.seed = seed;
    });
    await saveAgentPatch({ avatarSeed: seed });
  }

  async function selectModel(
    nextModel: AgentModelId,
    nextProvider: AgentProviderId,
    accountId: string | null | undefined,
  ): Promise<void> {
    const option = props.modelOptions.find(
      (candidate) => candidate.provider === nextProvider && candidate.id === nextModel,
    );
    if (!option) return;
    // A plain copy, not `snapshot`: a snapshot of an unmodified subtree is the store's own object,
    // which the write below would mutate, leaving nothing to roll back to.
    const previous: AgentRuntimeSettings = {
      model: draft.runtime.model,
      provider: draft.runtime.provider,
      reasoningEffort: draft.runtime.reasoningEffort,
    };
    const agentId = props.agent.id;
    const settings: AgentRuntimeSettings = {
      model: nextModel,
      provider: nextProvider,
      reasoningEffort: option.supportedReasoningEfforts.includes(previous.reasoningEffort)
        ? previous.reasoningEffort
        : option.defaultReasoningEffort,
    };
    setDraft((state) => {
      state.runtime.provider = settings.provider;
      state.runtime.model = settings.model;
      state.runtime.reasoningEffort = settings.reasoningEffort;
    });
    const updates = accountId === undefined ? settings : { ...settings, providerAccountId: accountId };
    if (await saveRuntimeSettings(settings, updates, agentId)) return;
    // Roll back only what this call wrote: another agent, or a later pick, owns the panel now.
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

  /** "Server default (All activity)" while the agent follows the server, else the level of the agent. */
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

  async function saveTaskLimit(next: TaskLimitChoice): Promise<void> {
    const agentId = props.agent.id;
    const previous = draft.taskLimit;
    setDraft((state) => {
      state.taskLimit = next;
    });
    if (await saveAgentPatch({ taskLimit: next === "default" ? null : Number(next) }, agentId)) return;
    if (!disposed && props.agent.id === agentId && draft.taskLimit === next) {
      setDraft((state) => {
        state.taskLimit = previous;
      });
    }
  }

  /** The store wraps the saved value in a proxy, so a newer save is told apart by its number. */
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

  /** The agent's own model: the one it went back to, while a usage limit holds it on a backup. */
  const ownModel = (): AgentModelChoice =>
    props.agent.usageLimitReturn ?? {
      provider: draft.runtime.provider,
      model: draft.runtime.model,
      ...(props.agent.providerAccountId ? { providerAccountId: props.agent.providerAccountId } : {}),
    };
  const ownModelName = () => {
    const own = ownModel();
    return (
      props.modelOptions.find((option) => option.provider === own.provider && option.id === own.model)?.name ??
      own.model
    );
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
      agentProviderDescriptor(provider).steer !== "native"
    );
  };

  const oneTurnAtATime = () => {
    const provider = knownProvider();
    return provider !== undefined && !agentProviderDescriptor(provider).concurrentTurns;
  };
  const taskLimitLabel = (choice: TaskLimitChoice) =>
    choice === "default"
      ? t("agentSettings.taskLimit.default", { count: AGENT_TASK_LIMIT_DEFAULT })
      : format.number(Number(choice));

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

  async function saveBrowserProfile(options: AgentBrowserProfileOptions, next: BrowserProfileChoice): Promise<void> {
    const agentId = props.agent.id;
    const previous = draft.browserProfile;
    setDraft((state) => {
      state.browserProfile = next;
    });
    setSaveError(null);
    try {
      await options.onChange(agentId, choiceBrowserProfile(next));
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
              title={t(PAGE_TITLE[current()])}
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
                      if (open) {
                        state.avatar.candidateSeed = state.avatar.seed;
                        state.avatar.batch = 0;
                      }
                      state.avatar.pickerOpen = open;
                    })
                  }
                >
                  <Popover.Trigger class="agent-settings-avatar" aria-label={t("agentSettings.avatar.edit")}>
                    <AgentAvatar seed={draft.avatar.seed} hue={draft.avatar.hue} url={avatarUrl()} motion="always" />
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
                          <AgentAvatar seed={draft.avatar.seed} hue={draft.avatar.hue} url={avatarUrl()} />
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
                      <span>{t("agentSettings.avatar.generatedFace")}</span>
                      <div class="avatar-editor-actions">
                        <Show when={draft.avatar.seed !== props.agent.id}>
                          <IconButton
                            variant="outline"
                            type="button"
                            label={t("agentSettings.avatar.resetToId")}
                            onClick={() => {
                              setDraft((state) => {
                                state.avatar.candidateSeed = props.agent.id;
                                state.avatar.batch = 0;
                              });
                              void selectGeneratedAvatar(props.agent.id);
                            }}
                          >
                            <RotateCcw aria-hidden="true" />
                          </IconButton>
                        </Show>
                        <IconButton
                          variant="outline"
                          type="button"
                          label={t("agentSettings.avatar.newSet")}
                          onClick={() =>
                            setDraft((state) => {
                              state.avatar.candidateSeed = state.avatar.seed;
                              state.avatar.batch += 1;
                            })
                          }
                        >
                          <RefreshCw aria-hidden="true" />
                        </IconButton>
                      </div>
                    </div>
                    <fieldset class="avatar-face-grid" aria-label={t("agentSettings.avatar.faces")}>
                      <For each={avatarCandidates()}>
                        {(seed, index) => (
                          <Button
                            variant="ghost"
                            type="button"
                            class={[
                              "avatar-face-choice",
                              { "avatar-choice-selected": !avatarUrl() && draft.avatar.seed === seed },
                            ]}
                            aria-label={
                              !avatarUrl() && draft.avatar.seed === seed
                                ? t("agentSettings.avatar.selected")
                                : t("agentSettings.avatar.option", { number: index() + 1 })
                            }
                            aria-pressed={!avatarUrl() && draft.avatar.seed === seed ? "true" : "false"}
                            data-cuelume-tap="select"
                            onClick={() => void selectGeneratedAvatar(seed)}
                          >
                            <AgentAvatar seed={seed} hue={draft.avatar.hue} />
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
                        class={["avatar-color-choice", { "avatar-choice-selected": draft.avatar.hue === null }]}
                        aria-label={t("agentSettings.avatar.autoColor")}
                        aria-pressed={draft.avatar.hue === null ? "true" : "false"}
                        data-cuelume-tap="select"
                        onClick={() => {
                          setDraft((state) => {
                            state.avatar.hue = null;
                          });
                          void saveAgentPatch({ avatarHue: null });
                        }}
                      >
                        <span class="avatar-color-swatch avatar-color-swatch-auto">
                          {t("agentSettings.avatar.autoInitial")}
                        </span>
                      </Button>
                      <For each={AVATAR_HUE_OPTIONS}>
                        {(option) => (
                          <Button
                            variant="ghost"
                            type="button"
                            class={[
                              "avatar-color-choice",
                              { "avatar-choice-selected": draft.avatar.hue === option.hue },
                            ]}
                            aria-label={t("agentSettings.avatar.hueColor", { hue: t(AVATAR_HUE_LABEL[option.hue]) })}
                            aria-pressed={draft.avatar.hue === option.hue ? "true" : "false"}
                            data-cuelume-tap="select"
                            onClick={() => {
                              setDraft((state) => {
                                state.avatar.hue = option.hue;
                              });
                              void saveAgentPatch({ avatarHue: option.hue });
                            }}
                          >
                            <span class="avatar-color-swatch" style={{ background: avatarHueSwatch(option.hue) }} />
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
              <SettingsField label={t("agentSettings.instructions")}>
                <ResizableTextarea
                  class="settings-instructions-input"
                  rows="5"
                  value={draft.fields.description}
                  aria-label={t("agentSettings.instructionsLabel")}
                  resizeLabel={t("agentSettings.instructionsResize")}
                  placeholder={t("agentSettings.instructionsPlaceholder")}
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
                <InstructionsLimit text={draft.fields.description} />
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
                  disabledReason={t("agentSettings.runtime.modelUnavailable")}
                  accountChoice
                  providerAccountId={agentNextProviderAccountId(props.agent)}
                  onChange={(nextModel, provider, accountId) => void selectModel(nextModel, provider, accountId)}
                />
                <Select<AgentReasoningEffort>
                  class="agent-settings-runtime-select"
                  options={reasoningOptions()}
                  value={draft.runtime.reasoningEffort}
                  disabled={reasoningSetByProvider() || agentForeignProvider() !== undefined}
                  onChange={(nextReasoning) => {
                    if (!nextReasoning || nextReasoning === draft.runtime.reasoningEffort) return;
                    void selectReasoning(nextReasoning);
                  }}
                  itemComponent={(item) => (
                    <SelectItem item={item.item}>{reasoningLabel(item.item.rawValue)}</SelectItem>
                  )}
                >
                  <SelectTrigger
                    class="agent-settings-runtime-row"
                    aria-label={t("agentSettings.runtime.reasoningLabel")}
                  >
                    <span class="settings-link-icon">
                      <Brain aria-hidden="true" />
                    </span>
                    <span class="agent-settings-runtime-label">{t("agentSettings.runtime.reasoning")}</span>
                    <SelectValue<AgentReasoningEffort>>
                      {(state) => {
                        if (reasoningSetByProvider()) {
                          return t("agentSettings.runtime.reasoningSetByProvider", {
                            provider: agentProviderName(draft.runtime.provider),
                          });
                        }
                        const effort = state.selectedOption();
                        return effort ? reasoningLabel(effort) : t("agentSettings.runtime.selectReasoning");
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent />
                </Select>
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
                      // More freedom is the move that needs the warning. Less freedom is never
                      // something a user needs protecting from, so it is written straight away.
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
                <Show when={props.taskLimitEditable}>
                  <Select<TaskLimitChoice>
                    class="agent-settings-runtime-select"
                    options={[...TASK_LIMIT_CHOICES]}
                    value={oneTurnAtATime() ? "1" : draft.taskLimit}
                    disabled={oneTurnAtATime()}
                    onChange={(next) => {
                      if (!next || next === draft.taskLimit) return;
                      void saveTaskLimit(next);
                    }}
                    itemComponent={(item) => (
                      <SelectItem item={item.item}>{taskLimitLabel(item.item.rawValue)}</SelectItem>
                    )}
                  >
                    <SelectTrigger
                      class="agent-settings-runtime-row"
                      aria-label={t("agentSettings.runtime.taskLimitLabel")}
                    >
                      <span class="agent-settings-runtime-label">{t("agentSettings.runtime.taskLimit")}</span>
                      <SelectValue<TaskLimitChoice>>
                        {(state) => taskLimitLabel(state.selectedOption() ?? "default")}
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
              <Show when={props.busyMessageModeEditable && steerUnsupported()}>
                <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
                  {t("agentSettings.busyMessage.steerUnsupported", {
                    provider: agentProviderName(draft.runtime.provider),
                  })}
                </Text>
              </Show>
              <Show when={props.taskLimitEditable && oneTurnAtATime()}>
                <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
                  {t("agentSettings.taskLimit.oneTurn", { provider: agentProviderName(draft.runtime.provider) })}
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
                    disabled={props.working}
                    onClick={() => setNewChatOpen(true)}
                  >
                    {t("agentSettings.newChat.button")}
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

/** Lets a long path wrap after a slash instead of inside a folder name. */
function breakablePath(path: string) {
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

/** True when the panel still shows exactly the settings a save was issued for. */
function sameRuntimeSettings(current: AgentRuntimeSettings, settings: AgentRuntimeSettings): boolean {
  return (
    current.provider === settings.provider &&
    current.model === settings.model &&
    current.reasoningEffort === settings.reasoningEffort
  );
}

/** `default`, then each limit as text, because a select keys its options by value. */
type TaskLimitChoice = "default" | `${number}`;
const TASK_LIMIT_CHOICES: readonly TaskLimitChoice[] = [
  "default",
  ...Array.from({ length: AGENT_TASK_LIMIT_MAX }, (_, index): TaskLimitChoice => `${index + 1}`),
];

function taskLimitChoice(limit: number | undefined): TaskLimitChoice {
  return limit === undefined ? "default" : `${limit}`;
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
