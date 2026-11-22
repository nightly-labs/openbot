import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT,
  type AgentAccessLevel,
  type AgentAccessRole,
  type AgentEvent,
  type AgentSummary,
  AnalyticsInputError,
  agentAccessRank,
  type ChatColors,
  canAdministerServer,
  type DirectConversationPage,
  type DirectConversationPageAnchor,
  type DirectConversationSnapshot,
  type DirectMessage,
  type DirectMessageRealtimeEvent,
  type DirectThreadSummary,
  type DirectTypingRealtimeEvent,
  type DuplicateAgentResult,
  isAgentEvent,
  isTeamRealtimeEvent,
  type SidebarLayoutSnapshot,
  type TeamMemberSummary,
  type TeamPresenceSnapshot,
  type TeamRealtimeEvent,
  type VoiceLiveEvent,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { ACP_REGISTRY_CAPABILITY } from "@openbot/contracts/team-protocol/acp-registry-v1";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { AGENT_ACTIVE_QUEUES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-active-queues-v1";
import { AGENT_ARCHIVED_THREADS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-archived-threads-v1";
import { AGENT_BACKGROUND_WORK_CAPABILITY } from "@openbot/contracts/team-protocol/agent-background-work-v1";
import { AGENT_BACKUP_MODELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import { AGENT_BUILTIN_MEMORY_CAPABILITY } from "@openbot/contracts/team-protocol/agent-builtin-memory-v1";
import { AGENT_COLORS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-colors-v1";
import { AGENT_CREATE_OPERATION_CAPABILITY } from "@openbot/contracts/team-protocol/agent-create-operation-v1";
import { AGENT_DEFAULTS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-defaults-v1";
import { AGENT_FAST_MODE_CAPABILITY } from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import { AGENT_FOLDERS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-folders-v1";
import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { AGENT_INSTRUCTIONS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-instructions-v1";
import { AGENT_NEW_CHAT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-new-chat-v1";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { AGENT_PENDING_RUNTIME_CAPABILITY } from "@openbot/contracts/team-protocol/agent-pending-runtime-v1";
import { AGENT_PLAN_CARD_CAPABILITY } from "@openbot/contracts/team-protocol/agent-plan-card-v1";
import { AGENT_QUEUE_TASK_CAPABILITY } from "@openbot/contracts/team-protocol/agent-queue-task-v1";
import { AGENT_SESSION_SETTINGS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-session-settings-v1";
import { AGENT_SPEED_CAPABILITY } from "@openbot/contracts/team-protocol/agent-speed-v1";
import { AGENT_TASK_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import { AGENT_TASK_UI_BLOCKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-task-ui-blocks-v1";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { AGENT_THREAD_BRANCHES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-branches-v1";
import { AGENT_THREAD_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import { AGENT_THREAD_PAGES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-pages-v1";
import { AGENT_THREAD_QUEUE_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-queue-v1";
import { AGENT_THREAD_READS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { AGENT_THREAD_REPLIES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-replies-v1";
import { AGENT_THREAD_REQUESTS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-requests-v1";
import { AGENT_THREADS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { BACKGROUND_PROCESSES_CAPABILITY } from "@openbot/contracts/team-protocol/background-processes-v1";
import { BROWSER_EGRESS_CAPABILITY } from "@openbot/contracts/team-protocol/browser-egress-v1";
import { BROWSER_PAGE_STATE_CAPABILITY } from "@openbot/contracts/team-protocol/browser-page-state-v1";
import { BROWSER_PROFILES_EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-events-v1";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { BROWSER_PROXIES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-proxies-v1";
import { BROWSER_USER_CONTROL_CAPABILITY } from "@openbot/contracts/team-protocol/browser-user-control-v1";
import { CACHE_EXPIRY_COMPACTION_CAPABILITY } from "@openbot/contracts/team-protocol/cache-expiry-compaction-v1";
import { CHANNEL_FOLDERS_CAPABILITY } from "@openbot/contracts/team-protocol/channel-folders-v1";
import { CHAT_COLORS_CAPABILITY } from "@openbot/contracts/team-protocol/chat-colors-v1";
import { CLAUDE_API_KEY_CAPABILITY } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { CLAUDE_COMPACT_WINDOW_CAPABILITY } from "@openbot/contracts/team-protocol/claude-compact-window-v1";
import { CLAUDE_USER_SETUP_CAPABILITY } from "@openbot/contracts/team-protocol/claude-user-setup-v1";
import { CODEX_API_KEY_CAPABILITY } from "@openbot/contracts/team-protocol/codex-api-key-v1";
import { CRM_CAPABILITY } from "@openbot/contracts/team-protocol/crm-v1";
import {
  AGENT_ADMIN_CAPABILITY,
  AGENT_HIDDEN_WORK_CAPABILITY,
  AGENT_HOST_SETTINGS_CAPABILITY,
  AGENT_IMPORT_CAPABILITY,
  AGENT_IMPORT_V2_CAPABILITY,
  AGENT_INSTALL_CAPABILITY,
  AGENT_MEMORY_LIMIT_CAPABILITY,
  AGENT_PUBLISH_CAPABILITY,
  AGENT_UPDATE_CAPABILITY,
  ANDROID_PUSH_NOTIFICATIONS_CAPABILITY,
  ATTACHMENT_PREVIEW_CAPABILITY,
  BITWARDEN_CONNECTOR_CAPABILITY,
  BROWSER_SECRET_VAULT_CAPABILITY,
  BROWSER_SIGN_IN_CAPABILITY,
  BROWSER_VAULT_SKIP_CAPABILITY,
  BROWSING_MEMORY_CAPABILITY,
  CHANNEL_BROWSER_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  CHANNEL_ISOLATION_CAPABILITY,
  CHANNEL_PICTURE_CAPABILITY,
  CHANNEL_SEEN_SUBTASKS_CAPABILITY,
  CHANNEL_TASK_CANCEL_CAPABILITY,
  CHANNEL_TASK_WAITS_CAPABILITY,
  COMPUTER_ACTIVITY_CAPABILITY,
  CONNECTORS_CAPABILITY,
  DISCORD_ACCESS_CAPABILITY,
  EVENTS_CAPABILITY,
  encodeTeamCapabilitiesV10,
  FOCUS_USE_CAPABILITY,
  HOST_ADMIN_CAPABILITY,
  HOST_KEY_ROTATION_CAPABILITY,
  HOST_MEMBER_UPDATE_CAPABILITY,
  HOST_RELEASE_CAPABILITY,
  HOST_RESTART_CAPABILITY,
  HOST_TIMEZONE_CAPABILITY,
  HOST_TURN_LIMITS_CAPABILITY,
  HOST_UPDATE_CAPABILITY,
  HOSTED_SITES_CAPABILITY,
  INSTANCE_TRANSFER_CAPABILITY,
  INSTANCE_TRANSFER_CHUNKS_CAPABILITY,
  INSTANCE_TRANSFER_FULL_COPY_CAPABILITY,
  isTeamCurrentCapability,
  LIVE_ACTIVITY_PUSH_CAPABILITY,
  LOCAL_SERVERS_CAPABILITY,
  legacyTeamCapabilities,
  MCP_ACCOUNTS_CAPABILITY,
  MCP_MEMBER_ACCESS_CAPABILITY,
  MCP_SERVERS_CAPABILITY,
  MCP_SIGN_IN_APP_CAPABILITY,
  MCP_SIGN_IN_CAPABILITY,
  MEMORY_REVIEW_CAPABILITY,
  MODEL_VISIBILITY_CAPABILITY,
  ONEPASSWORD_CONNECTOR_CAPABILITY,
  PASSWORD_MANAGERS_CAPABILITY,
  PROMPT_CACHE_TTL_CAPABILITY,
  PROMPT_CACHE_TTL_PI_CAPABILITY,
  PROVIDER_ACCOUNT_RELAY_CAPABILITY,
  PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY,
  PROVIDER_ACCOUNTS_CAPABILITY,
  PROVIDER_DEFAULT_CAPABILITY,
  PROVIDER_HOST_SIGN_IN_CAPABILITY,
  PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY,
  PROVIDER_SIGN_OUT_CAPABILITY,
  PROVIDER_USAGE_RESET_CAPABILITY,
  PROVIDERS_ADMIN_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_V4_CAPABILITY,
  PROVIDERS_V5_CAPABILITY,
  PUSH_NOTIFICATION_THREADS_CAPABILITY,
  PUSH_NOTIFICATIONS_CAPABILITY,
  QUIET_TURN_CAPABILITY,
  ROUTINE_FLOW_STOP_CAPABILITY,
  ROUTINE_FLOWS_CAPABILITY,
  ROUTINE_PAUSE_REASONS_CAPABILITY,
  ROUTINE_RECOVERY_CAPABILITY,
  ROUTINE_RESULTS_CAPABILITY,
  ROUTINE_RUN_PLACE_CAPABILITY,
  SHARED_TABLES_CAPABILITY,
  SIGN_IN_RELAY_CAPABILITY,
  SIGN_IN_RELAY_DEEP_LINK_CAPABILITY,
  SKILL_LEARNING_CAPABILITY,
  SKILLS_ADMIN_CAPABILITY,
  SKILLS_EVENTS_CAPABILITY,
  STORAGE_CAPABILITY,
  supportsTeamSemanticTags,
  TEAM_AGENT_ACTIVITY_CAPABILITY,
  TEAM_CHANNEL_ATTENTION_CAPABILITY,
  TEAM_CONTEXT_USAGE_CAPABILITY,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_HISTORY_EXTENT_CAPABILITY,
  TEAM_MEMORY_CHANGES_CAPABILITY,
  TEAM_PROMPT_MULTI_SELECT_CAPABILITY,
  TEAM_SUBAGENTS_CAPABILITY,
  TEAM_UI_BLOCKS_CAPABILITY,
  TEAM_USAGE_GROUPS_CAPABILITY,
  TEAM_USAGE_READ_FAILED_CAPABILITY,
  TEAM_USAGE_TERTIARY_CAPABILITY,
  TEAM_VIDEO_GENERATION_CAPABILITY,
  type TeamCurrentCapability,
  teamCapabilitiesVisibleToProtocol,
  VAULT_CAPABILITY,
  VAULT_IMPORT_CAPABILITY,
  VAULT_MEMBER_SAVE_CAPABILITY,
  VAULT_V2_CAPABILITY,
  VAULT_V3_CAPABILITY,
  VAULT_V4_CAPABILITY,
  WEBHOOK_AGENT_SECRET_CAPABILITY,
  WEBHOOK_SENDER_SECRET_CAPABILITY,
  WEBHOOK_TESTS_CAPABILITY,
  WHATSAPP_CONNECTOR_CAPABILITY,
  WHATSAPP_STATUS_REACTIONS_CAPABILITY,
  WHATSAPP_WORKING_MESSAGE_CAPABILITY,
  WORKFLOW_FOLDERS_CAPABILITY,
  WORKFLOWS_AGENT_FILES_CAPABILITY,
  WORKFLOWS_ANSWERS_CAPABILITY,
  WORKFLOWS_CAPABILITY,
  WORKFLOWS_CHANNELS_CAPABILITY,
  WORKFLOWS_CHATS_CAPABILITY,
  WORKFLOWS_GITHUB_CAPABILITY,
  WORKFLOWS_HIGGSFIELD_CAPABILITY,
  WORKFLOWS_MEDIA_CAPABILITY,
  WORKFLOWS_MEDIA_CATALOG_CAPABILITY,
  WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY,
  WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY,
  WORKFLOWS_PAUSE_CAPABILITY,
  WORKFLOWS_STEP_SETTINGS_CAPABILITY,
  WORKFLOWS_SUNRA_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { CUSTOM_AGENTS_CAPABILITY } from "@openbot/contracts/team-protocol/custom-agents-v1";
import { CUSTOM_PROVIDER_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/custom-provider-edit-v1";
import { CUSTOM_PROVIDER_HARNESS_CHOICE_CAPABILITY } from "@openbot/contracts/team-protocol/custom-provider-harness-choice-v1";
import { CUSTOM_PROVIDER_HARNESS_CAPABILITY } from "@openbot/contracts/team-protocol/custom-provider-harness-v1";
import { FOCUS_USE_INTERVAL_MS } from "@openbot/contracts/team-protocol/focus-use-v1";
import { GITHUB_SKILLS_CAPABILITY } from "@openbot/contracts/team-protocol/github-skills-v1";
import { HERMES_IMPORT_CAPABILITY } from "@openbot/contracts/team-protocol/hermes-import-v1";
import {
  HOST_APPEARANCE_CAPABILITY,
  HOST_APPEARANCE_EVENT,
  type HostAppearanceEvent,
} from "@openbot/contracts/team-protocol/host-appearance-v1";
import { HOST_PERSONALITY_CAPABILITY } from "@openbot/contracts/team-protocol/host-personality-v1";
import {
  HOST_RESTART_EVENT,
  type HostRestartEvent,
  type HostRestartState,
} from "@openbot/contracts/team-protocol/host-update-v1";
import { HOST_VOICE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/host-voice-model-v1";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import { LIBRARY_FOLDERS_EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/library-folders-events-v1";
import { LIBRARY_FOLDERS_CAPABILITY } from "@openbot/contracts/team-protocol/library-folders-v1";
import { LIVE_VOICE_ACCOUNT_CAPABILITY } from "@openbot/contracts/team-protocol/live-voice-account-v1";
import { LIVE_VOICE_CAPABILITY } from "@openbot/contracts/team-protocol/live-voice-v1";
import { MAC_APPS_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/mac-apps-limit-v1";
import {
  MACHINE_RESOURCES_CAPABILITY,
  type MachineAlertEvent,
} from "@openbot/contracts/team-protocol/machine-resources-v1";
import { MCP_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/mcp-access-v1";
import { MCP_MANY_SERVERS_CAPABILITY } from "@openbot/contracts/team-protocol/mcp-many-servers-v1";
import { MESSAGE_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/message-pins-v1";
import { MISTRAL_CODE_SIGN_IN_CAPABILITY } from "@openbot/contracts/team-protocol/mistral-code-sign-in-v1";
import { MODEL_STEERING_CAPABILITY } from "@openbot/contracts/team-protocol/model-steering-v1";
import { type OptionalTeamEvent, optionalTeamEvent } from "@openbot/contracts/team-protocol/optional-events";
import { OWNER_TRANSFER_CAPABILITY } from "@openbot/contracts/team-protocol/owner-transfer-v1";
import { PROVIDER_ACCOUNT_CODE_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-code-v1";
import { PROVIDER_ACCOUNT_KEYS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-keys-v1";
import { PROVIDER_ACCOUNT_MODELS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-models-v1";
import { PROVIDER_ACCOUNT_POOL_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-pool-v1";
import { PROVIDER_DETECTION_CAPABILITY } from "@openbot/contracts/team-protocol/provider-detection-v1";
import { PROVIDER_ENVIRONMENT_CAPABILITY } from "@openbot/contracts/team-protocol/provider-environment-v1";
import { PROVIDER_MANY_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-many-accounts-v1";
import { PROVIDER_USE_CAPABILITY } from "@openbot/contracts/team-protocol/provider-use-v1";
import { PROVIDERS_V8_CAPABILITY } from "@openbot/contracts/team-protocol/providers-v8";
import { QUEUE_HOLD_CAPABILITY, QUEUE_HOLD_SIGN_IN_CAPABILITY } from "@openbot/contracts/team-protocol/queue-hold-v1";
import {
  TEAM_REASONING_EFFORTS_CAPABILITY,
  withLegacyReasoningEfforts,
} from "@openbot/contracts/team-protocol/reasoning-efforts-v1";
import { ROUTINE_QUIET_ANSWERS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-quiet-answers-v1";
import { ROUTINE_RESULTS_WHATSAPP_CAPABILITY } from "@openbot/contracts/team-protocol/routine-results-whatsapp-v1";
import { ROUTINE_RUN_COMMAND_CAPABILITY } from "@openbot/contracts/team-protocol/routine-run-command-v1";
import { ROUTINES_ONCE_CAPABILITY } from "@openbot/contracts/team-protocol/routines-once-v1";
import { SERVER_AUDIT_CAPABILITY } from "@openbot/contracts/team-protocol/server-audit-v1";
import { SERVER_SAFE_MODE_CAPABILITY } from "@openbot/contracts/team-protocol/server-safe-mode-v1";
import { SETTING_LINK_MARKERS_CAPABILITY } from "@openbot/contracts/team-protocol/setting-link-markers-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { SIDEBAR_FOLDERS_CAPABILITY, sidebarFoldersEvent } from "@openbot/contracts/team-protocol/sidebar-folders-v1";
import { SIDEBAR_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import { withSkillSuggestionNames } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { STORAGE_CHANNEL_CAPABILITY } from "@openbot/contracts/team-protocol/storage-channel-v1";
import { STORAGE_DISK_CAPABILITY } from "@openbot/contracts/team-protocol/storage-disk-v1";
import { STORAGE_USER_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/storage-user-files-v1";
import { STORAGE_WORKFLOW_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/storage-workflow-files-v1";
import {
  TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY,
  withUiBlockAutoAnswers,
} from "@openbot/contracts/team-protocol/ui-block-auto-answer-v1";
import {
  TEAM_UI_BLOCK_VAULT_CAPABILITY,
  withUiBlockVaultRequests,
} from "@openbot/contracts/team-protocol/ui-block-vault-v1";
import { USAGE_CREDITS_CAPABILITY } from "@openbot/contracts/team-protocol/usage-credits-v1";
import { usageEventWithoutReadFailed } from "@openbot/contracts/team-protocol/usage-read-failed-v1";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_PROTOCOL_V1,
  TEAM_PROTOCOL_V1_CAPABILITIES,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
  type TeamProtocolSupportV1,
} from "@openbot/contracts/team-protocol/v1";
import {
  decodeTeamProtocolV1CurrentClientEvent,
  encodeTeamProtocolV1CurrentEvent,
} from "@openbot/contracts/team-protocol/v1-adapter";
import { encodeTeamProtocolV4BaseCurrentEvent } from "@openbot/contracts/team-protocol/v4-base-adapter";
import { TEAM_LOCAL_PROVIDERS_CAPABILITY } from "@openbot/contracts/team-protocol/v5";
import { encodeTeamProtocolV5BaseCurrentEvent } from "@openbot/contracts/team-protocol/v5-base-adapter";
import { TEAM_CURSOR_CLINE_CAPABILITY } from "@openbot/contracts/team-protocol/v6";
import { encodeTeamProtocolV6BaseCurrentEvent } from "@openbot/contracts/team-protocol/v6-base-adapter";
import { TEAM_PI_MUSE_CAPABILITY } from "@openbot/contracts/team-protocol/v7";
import { encodeTeamProtocolV7BaseCurrentEvent } from "@openbot/contracts/team-protocol/v7-base-adapter";
import { TEAM_OPEN_PROVIDERS_CAPABILITY } from "@openbot/contracts/team-protocol/v8";
import { encodeTeamProtocolV8BaseCurrentEvent } from "@openbot/contracts/team-protocol/v8-base-adapter";
import { TEAM_PROTOCOL_V10, type TeamProtocolSupportV10 } from "@openbot/contracts/team-protocol/v10";
import { WORKSPACE_ONLY_PROCESS_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/workspace-only-process-limit-v1";
import { isFixedSourceText, sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Exit, Scope } from "effect";
import type * as Ws from "ws";
import { devinSignInPageRelayed } from "../backend/acp-sign-in";
import { AgentSettingsRefused } from "../backend/agent/agent-settings-refused";
import { AgentDuplicationFailed, duplicateAgentIntoLayout } from "../backend/agent/duplication-gate";
import { AgentMemorySelectionError } from "../backend/agent-memory-store";
import { AgentThreadLimitError } from "../backend/agent-tasks/agent-tasks";
import { runCauseEffect } from "../backend/effect-boundary";
import { McpServerError } from "../backend/mcp-server-store";
import { perfCount } from "../backend/perf-probe-hooks";
import { canConfineProcesses } from "../backend/process-confinement";
import { StoredStateFailure } from "../backend/stored-state-effects";
import type { TeamChatStore } from "../backend/team-chat-store";
import { agentAccessLevel } from "./agent-access-store";
import { LifecycleGate } from "./lifecycle-gate";
import { listenLoopback } from "./listen-loopback";
import { mcpAccessLevel } from "./mcp-access-store";
import { RemoteScreenError } from "./remote-screen-gateway";
import { RemoteWorkflowError, remoteCall, toRemoteWorkflowError } from "./remote-service-effects";
import { isClientUse } from "./team-api/client-use";
import type { TeamApiMcpServerOwners, TeamApiOptions, TeamApiSidebarLayout } from "./team-api/dependencies";
import { HttpError } from "./team-api/http-error";
import {
  hiddenAgentView,
  hiddenProviderAgentIds,
  isPeerHiddenProvider,
  legacyProviderView,
} from "./team-api/provider-visibility";
import type { RouteOutcome, TeamApiRequestContext } from "./team-api/request-context";
import {
  bearerToken,
  conversationSnapshotForCapabilities,
  firstHeaderValue,
  JSON_LIMIT,
  markerSupported,
  pathIdentifier,
  readJson,
  requestCapabilities,
  requestCapabilityListsV10,
  requestProtocol,
  stringField,
} from "./team-api/request-helpers";
import { routeAcpRegistry } from "./team-api/route-acp-registry";
import { routeAgentAccess } from "./team-api/route-agent-access";
import { routeAgentActiveQueues } from "./team-api/route-agent-active-queues";
import {
  routeAgentAdmin,
  routeAgentBackupModels,
  routeAgentBuiltinMemory,
  routeAgentDefaults,
  routeAgentFastMode,
  routeAgentHostSettings,
  routeAgentNewChat,
  routeAgentPlanCard,
  routeAgentSpeed,
  routeAgentTaskLimit,
  routeModelSteering,
} from "./team-api/route-agent-admin";
import { agentColorsOf, routeAgentColors, visibleAgentColors } from "./team-api/route-agent-colors";
import { routeAgentFolders } from "./team-api/route-agent-folders";
import { routeAgentHidden, visibleSnapshot } from "./team-api/route-agent-hidden";
import { routeAgentImport } from "./team-api/route-agent-import";
import { routeAgentInstall } from "./team-api/route-agent-install";
import { routeAgentInstructions } from "./team-api/route-agent-instructions";
import { routeAgentMemoryPage } from "./team-api/route-agent-memories";
import { routeAgentMemoryLimit } from "./team-api/route-agent-memory-limit";
import { routeAgentNotificationLevels } from "./team-api/route-agent-notification-levels";
import { routeAgentPendingRuntime } from "./team-api/route-agent-pending-runtime";
import { routeAgentPublish } from "./team-api/route-agent-publish";
import { routeAgentQueueTask } from "./team-api/route-agent-queue-task";
import { routeAgentSessionSettings } from "./team-api/route-agent-session-settings";
import { agentTasksWireSnapshot, routeAgentTasks } from "./team-api/route-agent-tasks";
import { routeAgentThreadQueue } from "./team-api/route-agent-thread-queue";
import { routeAgentThreadRequests } from "./team-api/route-agent-thread-requests";
import {
  routeAgentArchivedThreads,
  routeAgentThreadBranches,
  routeAgentThreadFiles,
  routeAgentThreadPages,
  routeAgentThreadReads,
  routeAgentThreadReplies,
  routeAgentThreads,
} from "./team-api/route-agent-threads";
import { routeAgentUsageLimit } from "./team-api/route-agent-usage-limit";
import { routeAgentWaits } from "./team-api/route-agent-waits";
import { routeAgents } from "./team-api/route-agents";
import { routeBackgroundProcesses } from "./team-api/route-background-processes";
import { routeBitwardenConnector } from "./team-api/route-bitwarden-connector";
import { hiddenTabTest, routeBrowser, visibleControlState } from "./team-api/route-browser";
import { routeBrowserProfiles } from "./team-api/route-browser-profiles";
import { routeBrowserProxies } from "./team-api/route-browser-proxies";
import { routeBrowsingMemory } from "./team-api/route-browsing-memory";
import { routeCacheExpiryCompaction } from "./team-api/route-cache-expiry-compaction";
import { routeChannelFolders } from "./team-api/route-channel-folders";
import { routeChannels } from "./team-api/route-channels";
import { chatColorsOf, routeChatColors, visibleChatColors } from "./team-api/route-chat-colors";
import { routeChatHistory } from "./team-api/route-chat-history";
import { routeClaudeCompactWindow } from "./team-api/route-claude-compact-window";
import { routeClaudeUserSetup } from "./team-api/route-claude-user-setup";
import { routeComputerActivity } from "./team-api/route-computer-activity";
import { routeConnectors } from "./team-api/route-connectors";
import { routeContextCompact } from "./team-api/route-context-compact";
import { routeContextReset } from "./team-api/route-context-reset";
import { routeConversationFiles } from "./team-api/route-conversation-files";
import { routeConversationUnreadFrom } from "./team-api/route-conversation-unread-from";
import { routeCrm } from "./team-api/route-crm";
import { routeCustomAgents } from "./team-api/route-custom-agents";
import { routeDirect } from "./team-api/route-direct";
import { routeDiscordAccess } from "./team-api/route-discord-access";
import { routeEvents } from "./team-api/route-events";
import { routeFeedbackWithdraw } from "./team-api/route-feedback-withdraw";
import { routeFiles } from "./team-api/route-files";
import { routeFocusUse } from "./team-api/route-focus-use";
import { routeGithubSkills } from "./team-api/route-github-skills";
import { routeHermesImport } from "./team-api/route-hermes-import";
import { routeHostAdmin } from "./team-api/route-host-admin";
import { routeHostAppearance } from "./team-api/route-host-appearance";
import { routeHostKeyRotation } from "./team-api/route-host-key-rotation";
import { routeHostPersonality } from "./team-api/route-host-personality";
import { routeHostRestart } from "./team-api/route-host-restart";
import { routeHostTimezone } from "./team-api/route-host-timezone";
import { routeHostTurnLimits } from "./team-api/route-host-turn-limits";
import { routeHostUpdate } from "./team-api/route-host-update";
import { routeHostVoiceModel } from "./team-api/route-host-voice-model";
import { routeHostedSites } from "./team-api/route-hosted-sites";
import { routeInstanceTransfer } from "./team-api/route-instance-transfer";
import { routeInstanceTransferChunks } from "./team-api/route-instance-transfer-chunks";
import { routeLibraryFolders } from "./team-api/route-library-folders";
import { routeLiveActivityPush } from "./team-api/route-live-activity-push";
import { liveVoiceWireEvent, routeLiveVoice, TeamLiveVoiceSessions } from "./team-api/route-live-voice";
import { routeLocalServers } from "./team-api/route-local-servers";
import { routeMachineResources } from "./team-api/route-machine-resources";
import { routeMcpServers } from "./team-api/route-mcp";
import { routeMcpAccess } from "./team-api/route-mcp-access";
import { routeMcpSignIn } from "./team-api/route-mcp-sign-in";
import { routeMcpSignInApp } from "./team-api/route-mcp-sign-in-app";
import { routeMemoryReview } from "./team-api/route-memory-review";
import { routeMessageDelete } from "./team-api/route-message-delete";
import { routeMessagePins } from "./team-api/route-message-pins";
import { routeModelVisibility } from "./team-api/route-model-visibility";
import { routeOnePasswordConnector } from "./team-api/route-onepassword-connector";
import { routePasswordManagers } from "./team-api/route-password-managers";
import { routePendingApproval } from "./team-api/route-pending-approval";
import { routePendingPrompts } from "./team-api/route-pending-prompts";
import { routePhoneFeedback } from "./team-api/route-phone-feedback";
import { routePromptCacheTtl } from "./team-api/route-prompt-cache-ttl";
import {
  routeLiveVoiceAccount,
  routeProviderAccountCode,
  routeProviderAccountKeys,
  routeProviderAccountModels,
  routeProviderAccountPool,
  routeProviderAccounts,
} from "./team-api/route-provider-accounts";
import { routeProviderDefault } from "./team-api/route-provider-default";
import { routeProviderDetection } from "./team-api/route-provider-detection";
import { routeProviderEnvironment } from "./team-api/route-provider-environment";
import { routeProviderHostSignIn } from "./team-api/route-provider-host-sign-in";
import { routeProviderSignOut } from "./team-api/route-provider-sign-out";
import { routeProviderUsageReset } from "./team-api/route-provider-usage-reset";
import { routeProviderUse } from "./team-api/route-provider-use";
import { routeProviders } from "./team-api/route-providers";
import { routePushNotifications } from "./team-api/route-push-notifications";
import { routeRemoteScreen } from "./team-api/route-remote-screen";
import { routeRoutineFlows } from "./team-api/route-routine-flows";
import { routeRoutinePauseReasons } from "./team-api/route-routine-pause-reasons";
import { routeRoutineResults } from "./team-api/route-routine-results";
import { routeRoutineRunCommand } from "./team-api/route-routine-run-command";
import { routeRoutineRunPlace } from "./team-api/route-routine-run-place";
import { routeRoutinesOnce } from "./team-api/route-routines-once";
import { routeServerAudit } from "./team-api/route-server-audit";
import { routeSharedTables } from "./team-api/route-shared-tables";
import { routeSideQuestion } from "./team-api/route-side-question";
import { routeSidebarFolders } from "./team-api/route-sidebar-folders";
import { routeSidebarPins } from "./team-api/route-sidebar-pins";
import { routeSignInRelay } from "./team-api/route-sign-in-relay";
import { routeSkillLearning } from "./team-api/route-skill-learning";
import { routeSkillSuggestionSave } from "./team-api/route-skill-suggestion-save";
import { routeSkillsAdmin } from "./team-api/route-skills-admin";
import { routeStorage } from "./team-api/route-storage";
import { routeTeam } from "./team-api/route-team";
import { routeThreadMessageSearch } from "./team-api/route-thread-message-search";
import { routeUsageCredits } from "./team-api/route-usage-credits";
import { routeVault } from "./team-api/route-vault";
import { routeVaultImport } from "./team-api/route-vault-import";
import { routeWhatsAppConnector } from "./team-api/route-whatsapp-connector";
import { routeWhatsAppStatusReactions } from "./team-api/route-whatsapp-status-reactions";
import { routeWhatsAppWorkingMessage } from "./team-api/route-whatsapp-working-message";
import { routeWorkflowFolders } from "./team-api/route-workflow-folders";
import { routeWorkflows } from "./team-api/route-workflows";
import { routeWorkspaceDirectory } from "./team-api/route-workspace-directory";
import { visibleWorkflowIds } from "./team-api/workflow-visibility";
import { TeamStoreError } from "./team-store";

const EVENT_PAYLOAD_LIMIT = 256 * 1_024;
const TYPING_TIMEOUT_MS = 5_000;
const SESSION_USE_LIMIT = 200;
const SESSION_USE_MAX_AGE_MS = 60 * 60 * 1000;
const FOCUS_USE_LIMIT_MS = 30 * 60_000;
const FOCUS_GAP_MS = 2 * FOCUS_USE_INTERVAL_MS;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const RATE_LIMIT_SWEEP_MS = 60_000;
const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_CAPACITY = 10_000;
const RUNTIME_SNAPSHOT_REQUEST_INTERVAL_MS = 1_000;
const TEST_LEGACY_EVENT_PROTOCOL = "openbot-events";
const TEST_LEGACY_SNAPSHOT_PROTOCOL = "openbot-events-v2";
const requireModule = createRequire(import.meta.url);
const webSockets: typeof Ws = requireModule(join(dirname(requireModule.resolve("ws/package.json")), "index.js"));

const logger = createOpenBotLogger("team-api-server");

type AccessMember = Pick<TeamMemberSummary, "id" | "role">;

interface EventAccess {
  member: AccessMember;
  blocked: ReadonlySet<string>;
}

interface EventClientState {
  token: string;
  memberId: string;
  sessionId: string | null;
  capabilities: Set<string>;
  includeConversationEvents: boolean;
  typingAgentId: string | null;
  typingTimer: ReturnType<typeof setTimeout> | null;
  directTypingRecipientId: string | null;
  directTypingTimer: ReturnType<typeof setTimeout> | null;
  snapshotResponsePending: boolean;
  snapshotRequestQueued: boolean;
  nextSnapshotRequestAt: number;
  chatColorsSent: string | null;
}

type ConversationEventAudience = "all" | "modern" | "legacy";

interface PendingLegacyConversationRead {
  event: Extract<AgentEvent, { type: "conversation" }>;
  retries: number;
}

interface RateEntry {
  attempts: number;
  resetAt: number;
}

interface TeamProtocolIssue {
  status: 400 | 426;
  body: {
    error: string;
    code: "client_update_required" | "host_update_required" | "protocol_error";
    host: TeamProtocolSupportV1;
    client?: { appVersion: string; protocol: number };
  };
}

export class TeamApiServer {
  readonly #options: Omit<TeamApiOptions, "sidebarLayout"> & { sidebarLayout: TeamApiSidebarLayout };
  readonly #rateLimits = new Map<string, RateEntry>();
  readonly #eventClients = new Map<Ws.WebSocket, EventClientState>();
  readonly #pendingLegacyConversationReads = new Map<string, PendingLegacyConversationRead>();
  #legacyConversationScope = Scope.makeUnsafe();
  #hostRestart: HostRestartEvent = { type: HOST_RESTART_EVENT, state: "none", version: null };
  readonly #responseRoutes = new WeakMap<
    ServerResponse,
    { method: string; path: string; protocol: number; capabilities: Set<string>; hiddenAgentIds?: ReadonlySet<string> }
  >();
  readonly #duplicateRequests = new Map<
    string,
    { sourceAgentId: string; result: Deferred.Deferred<DuplicateAgentResult, AgentDuplicationFailed> }
  >();
  readonly #webSockets = new webSockets.WebSocketServer({
    noServer: true,
    maxPayload: EVENT_PAYLOAD_LIMIT,
    handleProtocols: (protocols) =>
      protocols.has(TEAM_PROTOCOL_V1_WEBSOCKET)
        ? TEAM_PROTOCOL_V1_WEBSOCKET
        : protocols.has(TEST_LEGACY_SNAPSHOT_PROTOCOL)
          ? TEST_LEGACY_SNAPSHOT_PROTOCOL
          : protocols.has(TEST_LEGACY_EVENT_PROTOCOL)
            ? TEST_LEGACY_EVENT_PROTOCOL
            : false,
  });
  readonly #rateLimitCapacity: number;
  readonly #now: () => number;
  #server: Server | null = null;
  readonly #lifecycle = new LifecycleGate<number, RemoteWorkflowError>();
  #port: number | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #lastClientUseAt: number | null = null;
  readonly #sessionUse = new Map<string, { memberId: string; at: number }>();
  readonly #sessionFocus = new Map<string, { since: number; at: number }>();
  #agentListener: ((event: AgentEvent, memberId?: string) => void) | null = null;
  #sidebarLayoutListener: ((layout: SidebarLayoutSnapshot) => void) | null = null;
  #stopAgentAccessListener: (() => void) | null = null;
  #stopMachineAlertListener: (() => void) | null = null;
  #stopLiveVoiceListener: (() => void) | null = null;
  readonly #liveVoiceSessions = new TeamLiveVoiceSessions();
  #stopNotificationLevelsListener: (() => void) | null = null;
  #stopSidebarPinsListener: (() => void) | null = null;
  #localTypingAgentId: string | null = null;
  readonly #reportedUnrepresentableAgents = new Set<string>();
  readonly #representableAgents = new Map<string, Map<string, { json: string; representable: boolean }>>();
  #nextRateLimitSweepAt = 0;

  constructor(options: TeamApiOptions) {
    this.#options = { ...options, sidebarLayout: options.sidebarLayout ?? unavailableSidebarLayout() };
    this.#rateLimitCapacity = options.rateLimitCapacity ?? RATE_LIMIT_CAPACITY;
    this.#now = options.now ?? Date.now;
  }

  get port(): number | null {
    return this.#port;
  }

  start(): Effect.Effect<number, RemoteWorkflowError> {
    return this.#lifecycle.start(() =>
      this.#start().pipe(Effect.catchDefect((cause) => Effect.fail(new RemoteWorkflowError({ cause })))),
    );
  }

  stop(): Effect.Effect<void, RemoteWorkflowError> {
    return this.#lifecycle.stop(() => this.#stop());
  }

  readonly #start = Effect.fn("TeamApiServer.start")(function* (this: TeamApiServer) {
    if (this.#server && this.#port) return this.#port;
    if (this.#legacyConversationScope.state._tag === "Closed") this.#legacyConversationScope = Scope.makeUnsafe();
    const server = createServer((request, response) => void this.#handle(request, response));
    this.#server = server;
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (this.#options.remoteScreen?.handlesUpgrade(url)) {
        this.#options.remoteScreen.handleUpgrade(request, socket, head, url);
        return;
      }
      if (this.#options.browserView?.handlesUpgrade(url)) {
        this.#options.browserView.handleUpgrade(request, socket, head, url);
        return;
      }
      const protocols = (request.headers["sec-websocket-protocol"] ?? "").split(",").map((value) => value.trim());
      if (
        this.#options.appVersion &&
        url.pathname === TEAM_API_ROUTES.events &&
        !protocols.includes(TEAM_PROTOCOL_V1_WEBSOCKET)
      ) {
        socket.write("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const encodedToken = protocols.find((value) => value.startsWith("openbot-token."));
      const token = encodedToken?.slice("openbot-token.".length) ?? "";
      const member = token.length <= 512 ? this.#options.store.authenticate(token) : null;
      if (!member) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (
        url.pathname === TEAM_API_ROUTES.events &&
        (protocols.includes(TEAM_PROTOCOL_V1_WEBSOCKET) ||
          (!this.#options.appVersion &&
            (protocols.includes(TEST_LEGACY_SNAPSHOT_PROTOCOL) || protocols.includes(TEST_LEGACY_EVENT_PROTOCOL))))
      ) {
        this.#webSockets.handleUpgrade(request, socket, head, (client) => {
          this.#connectEvents(
            client,
            token,
            member.id,
            client.protocol === TEAM_PROTOCOL_V1_WEBSOCKET || client.protocol === TEST_LEGACY_SNAPSHOT_PROTOCOL,
            client.protocol === TEAM_PROTOCOL_V1_WEBSOCKET,
          );
        });
        return;
      }
      if (url.pathname === TEAM_API_ROUTES.remoteDesktopUpgrade) {
        socket.write("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
    });
    const port = yield* remoteCall(() => listenLoopback(server, () => new Error(sourceText("error.team.bindFailed"))));
    this.#port = port;
    this.#agentListener = (event, memberId) => this.#broadcastAgentEvent(event, memberId);
    this.#options.agents.on("event", this.#agentListener);
    this.#sidebarLayoutListener = (layout) => this.#broadcastAgentEvent({ type: "sidebar-layout-changed", layout });
    this.#options.sidebarLayout.on("changed", this.#sidebarLayoutListener);
    this.#stopAgentAccessListener = this.#options.agentAccess?.subscribe(() => this.agentAccessChanged()) ?? null;
    this.#stopMachineAlertListener =
      this.#options.machine?.subscribe((memberId, event) => {
        if (memberId) this.#sendMachineAlert(memberId, event);
      }) ?? null;
    this.#stopLiveVoiceListener =
      this.#options.liveVoice?.subscribe((event, memberId) => {
        if (event.type === "ended") this.#liveVoiceSessions.remove(event.sessionId);
        if (memberId) this.#sendLiveVoice(memberId, event);
      }) ?? null;
    this.#stopNotificationLevelsListener =
      this.#options.agentNotificationLevels?.subscribe((memberId) => this.#sendNotificationLevels(memberId)) ?? null;
    this.#stopSidebarPinsListener =
      this.#options.sidebarPins?.subscribe((memberId) => this.#sendSidebarPins(memberId)) ?? null;
    this.#heartbeat = setInterval(() => {
      for (const [client, connection] of this.#eventClients) {
        if (!this.#options.store.authenticate(connection.token)) {
          client.close(1008, "Team access was revoked");
        } else if (client.readyState === webSockets.WebSocket.OPEN) client.ping();
      }
    }, 15_000);
    this.#heartbeat.unref?.();
    this.#publishPresence();
    return port;
  }).bind(this);

  readonly #stop = Effect.fn("TeamApiServer.stop")(function* (this: TeamApiServer) {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
    if (this.#agentListener) this.#options.agents.off("event", this.#agentListener);
    this.#agentListener = null;
    if (this.#sidebarLayoutListener) this.#options.sidebarLayout.off("changed", this.#sidebarLayoutListener);
    this.#sidebarLayoutListener = null;
    this.#stopAgentAccessListener?.();
    this.#stopAgentAccessListener = null;
    this.#stopMachineAlertListener?.();
    this.#stopMachineAlertListener = null;
    this.#stopLiveVoiceListener?.();
    this.#stopLiveVoiceListener = null;
    this.#stopNotificationLevelsListener?.();
    this.#stopNotificationLevelsListener = null;
    this.#stopSidebarPinsListener?.();
    this.#stopSidebarPinsListener = null;
    yield* Scope.close(this.#legacyConversationScope, Exit.void);
    this.#legacyConversationScope = Scope.makeUnsafe();
    for (const [client, connection] of this.#eventClients) {
      if (connection.typingTimer) clearTimeout(connection.typingTimer);
      if (connection.directTypingTimer) clearTimeout(connection.directTypingTimer);
      client.close(1001, "Server stopped");
    }
    this.#eventClients.clear();
    this.#pendingLegacyConversationReads.clear();
    this.#localTypingAgentId = null;
    const { remoteScreen, browserView } = this.#options;
    yield* Effect.gen(function* () {
      if (remoteScreen) yield* remoteScreen.stop();
      if (browserView) yield* browserView.stop();
    }).pipe(
      toRemoteWorkflowError,
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          const server = this.#server;
          this.#server = null;
          this.#port = null;
          if (server) {
            yield* Effect.callback<void>((resume) => {
              server.close(() => resume(Effect.void));
            });
          }
          this.#publishPresence();
        }),
      ),
    );
  }).bind(this);

  getPresence(): TeamPresenceSnapshot {
    const identity = this.#options.store.getIdentity();
    if (!identity) {
      return { serverId: null, members: [], updatedAt: new Date().toISOString() };
    }
    const connections = [...this.#eventClients.values()];
    const owner = this.#options.store.listMembers().find((member) => member.role === "owner");
    return {
      serverId: identity.serverId,
      members: this.#options.store.listMembers().map((member) => {
        const memberConnections = connections.filter((connection) => connection.memberId === member.id);
        return {
          ...member,
          online: memberConnections.length > 0 || (member.id === owner?.id && this.#server !== null),
          typingAgentId:
            (member.id === owner?.id ? this.#localTypingAgentId : null) ??
            memberConnections.find((connection) => connection.typingAgentId)?.typingAgentId ??
            null,
        };
      }),
      updatedAt: new Date().toISOString(),
    };
  }

  connectedClientCount(): number {
    return this.#eventClients.size;
  }

  lastClientUseAt(): number | null {
    return this.#lastClientUseAt;
  }

  lastMemberUseElsewhere(memberId: string, sessionId: string): number | null {
    let last: number | null = null;
    for (const [other, use] of this.#sessionUse) {
      if (other !== sessionId && use.memberId === memberId && (last === null || use.at > last)) last = use.at;
    }
    return last;
  }

  #recordClientUse(sessionId: string | null, memberId: string): void {
    const now = Date.now();
    this.#lastClientUseAt = now;
    if (!sessionId) return;
    this.#sessionUse.set(sessionId, { memberId, at: now });
    pruneSessions(this.#sessionUse, now);
  }

  #recordFocusUse(sessionId: string): void {
    const now = Date.now();
    const previous = this.#sessionFocus.get(sessionId);
    const start = previous && now - previous.at <= FOCUS_GAP_MS ? previous.since : now;
    const since = Math.max(start, this.#sessionUse.get(sessionId)?.at ?? 0);
    this.#sessionFocus.set(sessionId, { since, at: now });
    pruneSessions(this.#sessionFocus, now);
    if (now - since < FOCUS_USE_LIMIT_MS) this.#lastClientUseAt = now;
  }

  setLocalTyping(agentId: string | null, typing: boolean): void {
    const next = typing && this.#server ? agentId : null;
    if (next === this.#localTypingAgentId) return;
    this.#localTypingAgentId = next;
    this.#publishPresence();
  }

  refreshPresence(): void {
    for (const [client, connection] of this.#eventClients) {
      if (!this.#options.store.authenticate(connection.token)) {
        client.close(1008, "Team access was revoked");
      }
    }
    this.#publishPresence();
  }

  refreshIdentity(): void {
    const identity = this.#options.store.getIdentity();
    if (!identity) return;
    const event: TeamRealtimeEvent = {
      type: "team-identity",
      serverId: identity.serverId,
      serverName: identity.serverName,
      logoVersion: identity.logoVersion,
    };
    for (const [client, connection] of this.#eventClients) {
      const payload = this.#encodeProviderEvent(event, connection.capabilities);
      if (payload && client.readyState === webSockets.WebSocket.OPEN) client.send(payload);
    }
  }

  announceHostRestart(state: HostRestartState, version: string | null): void {
    this.#hostRestart = { type: HOST_RESTART_EVENT, state, version };
    for (const [client, connection] of this.#eventClients) this.#sendHostRestart(client, connection);
  }

  refreshAppearance(): void {
    for (const [client, connection] of this.#eventClients) this.#sendHostAppearance(client, connection);
  }

  #sendHostAppearance(client: Ws.WebSocket, connection: EventClientState): void {
    if (!connection.capabilities.has(HOST_APPEARANCE_CAPABILITY)) return;
    const identity = this.#options.store.getIdentity();
    if (!identity || client.readyState !== webSockets.WebSocket.OPEN) return;
    const event: HostAppearanceEvent = {
      type: HOST_APPEARANCE_EVENT,
      serverId: identity.serverId,
      appearance: identity.appearance,
    };
    client.send(JSON.stringify(event));
  }

  #sendHostRestart(client: Ws.WebSocket, connection: EventClientState): void {
    if (
      !connection.capabilities.has(HOST_UPDATE_CAPABILITY) &&
      !connection.capabilities.has(HOST_MEMBER_UPDATE_CAPABILITY)
    )
      return;
    if (client.readyState === webSockets.WebSocket.OPEN) client.send(JSON.stringify(this.#hostRestart));
  }

  #sendMachineAlert(memberId: string, event: MachineAlertEvent): void {
    for (const [client, connection] of this.#eventClients) {
      if (
        connection.memberId === memberId &&
        connection.capabilities.has(MACHINE_RESOURCES_CAPABILITY) &&
        client.readyState === webSockets.WebSocket.OPEN
      )
        client.send(JSON.stringify(event));
    }
  }

  #sendLiveVoice(memberId: string, event: VoiceLiveEvent): void {
    const payload = JSON.stringify(liveVoiceWireEvent(event));
    for (const [client, connection] of this.#eventClients) {
      if (
        connection.memberId === memberId &&
        connection.capabilities.has(LIVE_VOICE_CAPABILITY) &&
        client.readyState === webSockets.WebSocket.OPEN
      )
        client.send(payload);
    }
  }

  #sendNotificationLevels(memberId: string): void {
    const levels = this.#options.agentNotificationLevels;
    if (!levels) return;
    for (const [client, connection] of this.#eventClients) {
      if (
        connection.memberId !== memberId ||
        !connection.capabilities.has(AGENT_NOTIFICATION_LEVELS_CAPABILITY) ||
        client.readyState !== webSockets.WebSocket.OPEN
      )
        continue;
      const member = this.#connectionMember(connection);
      const hidden = this.hiddenAgentIds(eventProtocol(connection.capabilities), connection.capabilities, member);
      client.send(JSON.stringify({ type: "agent-notification-levels-changed", ...levels.snapshot(memberId, hidden) }));
    }
  }

  #sendSidebarPins(memberId: string): void {
    const pins = this.#options.sidebarPins;
    if (!pins) return;
    for (const [client, connection] of this.#eventClients) {
      if (
        connection.memberId !== memberId ||
        !connection.capabilities.has(SIDEBAR_PINS_CAPABILITY) ||
        client.readyState !== webSockets.WebSocket.OPEN
      )
        continue;
      const member = this.#connectionMember(connection);
      const hidden = this.hiddenAgentIds(eventProtocol(connection.capabilities), connection.capabilities, member);
      client.send(JSON.stringify({ type: "sidebar-pins-changed", ...pins.snapshot(memberId, hidden) }));
    }
  }

  #sendPendingMachineAlerts(client: Ws.WebSocket, connection: EventClientState): void {
    const machine = this.#options.machine;
    if (!machine || !connection.capabilities.has(MACHINE_RESOURCES_CAPABILITY)) return;
    if (client.readyState !== webSockets.WebSocket.OPEN) return;
    for (const event of machine.pending(connection.memberId)) client.send(JSON.stringify(event));
  }

  #sendBrowserUserControl(client: Ws.WebSocket, connection: EventClientState): void {
    const tabIds = this.#options.browser
      .listTabs()
      .filter((tab) => tab.userControl)
      .map((tab) => tab.id);
    if (client.readyState !== webSockets.WebSocket.OPEN) return;
    client.send(JSON.stringify(this.#eventFor(connection, { type: "browser-user-control-changed", tabIds })));
  }

  listDirectThreads(memberId: string): DirectThreadSummary[] {
    return this.#requireChat().listThreads(memberId);
  }

  readDirectConversation(memberId: string, otherMemberId: string): DirectConversationSnapshot {
    this.#requireDirectRecipient(memberId, otherMemberId);
    return this.#requireChat().readConversation(memberId, otherMemberId);
  }

  readDirectConversationPage(
    memberId: string,
    otherMemberId: string,
    anchor: DirectConversationPageAnchor,
    limit: number,
  ): DirectConversationPage {
    this.#requireDirectRecipient(memberId, otherMemberId);
    return this.#requireChat().readConversationPage(memberId, otherMemberId, anchor, limit);
  }

  sendDirectMessage(
    senderMemberId: string,
    input: { memberId: string; text: string; clientMessageId: string },
  ): DirectMessage {
    this.#requireDirectRecipient(senderMemberId, input.memberId);
    const message = this.#requireChat().sendMessage({
      clientMessageId: input.clientMessageId,
      senderMemberId,
      recipientMemberId: input.memberId,
      text: input.text,
    });
    this.#publishDirectMessage(message);
    return message;
  }

  markDirectRead(memberId: string, otherMemberId: string, throughSequence: number) {
    this.#requireDirectRecipient(memberId, otherMemberId);
    return this.#requireChat().markRead(memberId, otherMemberId, throughSequence);
  }

  setLocalDirectTyping(senderMemberId: string, recipientMemberId: string, typing: boolean): void {
    this.#requireDirectRecipient(senderMemberId, recipientMemberId);
    this.#publishDirectTyping(senderMemberId, recipientMemberId, typing);
  }

  async #handle(request: IncomingMessage, response: ServerResponse) {
    const method = request.method ?? "GET";
    this.#responseRoutes.set(response, {
      method,
      path: "/",
      protocol: requestProtocol(request),
      capabilities: requestCapabilities(request),
    });
    try {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      this.#responseRoutes.set(response, {
        method,
        path: url.pathname,
        protocol: requestProtocol(request),
        capabilities: requestCapabilities(request),
      });

      if (method === "GET" && url.pathname === TEAM_API_ROUTES.compatibility) {
        return this.#json(response, 200, this.#protocolSupport(requestProtocol(request)));
      }

      if (this.#options.remoteScreen?.handlesHttp(url)) {
        await runCauseEffect(this.#options.remoteScreen.handleHttp(request, response, url));
        return;
      }

      const protocolIssue = this.#protocolIssue(request);
      if (protocolIssue) return this.#json(response, protocolIssue.status, protocolIssue.body);

      if (method === "GET" && url.pathname === TEAM_API_ROUTES.identity) {
        const challenge = url.searchParams.get("challenge");
        return this.#json(
          response,
          200,
          challenge ? this.#options.store.getIdentityProof(challenge) : this.#options.store.getIdentity(),
        );
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.join.invitationPreview) {
        const body = await readJson(request);
        return this.#json(
          response,
          200,
          this.#options.store.previewInvite(stringField(body, "inviteToken", false, INPUT_LIMITS.identifier)),
        );
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.join.server) {
        const body = await readJson(request);
        this.#checkRate(request, stringField(body, "username", false, 64));
        const result = await runCauseEffect(
          this.#options.store.acceptInvite(
            stringField(body, "inviteToken", false, INPUT_LIMITS.identifier),
            stringField(body, "username", false, 64),
            stringField(body, "password", false, 256),
          ),
        );
        return this.#json(response, 201, result);
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.join.account) {
        const body = await readJson(request);
        const identity = this.#options.store.getIdentity();
        const user = identity
          ? await (this.#options.redeemCentralTicket
              ? runCauseEffect(
                  this.#options.redeemCentralTicket(
                    stringField(body, "accountTicket", false, INPUT_LIMITS.identifier),
                    identity.serverId,
                  ),
                )
              : undefined)
          : null;
        if (!user) return this.#json(response, 401, { error: sourceText("error.team.signInRequired") });
        this.#checkRate(request, user.email);
        const result = await runCauseEffect(
          this.#options.store.acceptInviteWithAccount(
            stringField(body, "inviteToken", false, INPUT_LIMITS.identifier),
            user,
          ),
        );
        return this.#json(response, 201, result);
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.auth.login) {
        const body = await readJson(request);
        this.#checkRate(request, stringField(body, "username", false, 64));
        const result = await runCauseEffect(
          this.#options.store.login(
            stringField(body, "username", false, 64),
            stringField(body, "password", false, 256),
          ),
        );
        return this.#json(response, 200, result);
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.auth.account) {
        const body = await readJson(request);
        const identity = this.#options.store.getIdentity();
        const user = identity
          ? await (this.#options.redeemCentralTicket
              ? runCauseEffect(
                  this.#options.redeemCentralTicket(
                    stringField(body, "accountTicket", false, INPUT_LIMITS.identifier),
                    identity.serverId,
                  ),
                )
              : undefined)
          : null;
        if (!user) return this.#json(response, 401, { error: sourceText("error.team.signInRequired") });
        this.#checkRate(request, user.email);
        return this.#json(response, 200, await runCauseEffect(this.#options.store.loginWithAccount(user)));
      }

      const token = bearerToken(request.headers.authorization);
      const authenticated = token ? this.#options.store.authenticateSession(token) : null;
      if (!authenticated || !token) {
        return this.#json(response, 401, { error: sourceText("error.team.authenticationRequired") });
      }
      if (isClientUse(method, url.pathname)) this.#recordClientUse(authenticated.sessionId, authenticated.member.id);
      const context = this.#requestContext(request, response, url, token, authenticated);
      if (method === "GET" && url.pathname === TEAM_API_ROUTES.agents.all && this.#options.agentsReady) {
        await runCauseEffect(this.#options.agentsReady());
      }
      const hidden = this.hiddenAgentIds(context.protocol, context.capabilities, context.member);
      const responseRoute = this.#responseRoutes.get(response);
      if (responseRoute) responseRoute.hiddenAgentIds = hidden;
      const agentId = url.pathname.match(/^\/v1\/agents\/([^/]+)/u)?.[1];
      if (
        (agentId && hidden.has(pathIdentifier(agentId, "agentId"))) ||
        [url.searchParams.get("agentId"), url.searchParams.get("botId")].some((id) => id !== null && hidden.has(id))
      ) {
        throw new HttpError(404, sourceText("error.team.agentNotFound"));
      }
      const newAgentHidden = () => {
        const provider = this.#options.agents.newAgentProvider();
        return provider !== null && isPeerHiddenProvider(provider, context.protocol);
      };

      if ((await this.#routeTeam(context)) === "handled") return;
      if ((await this.#routeRemoteScreen(context)) === "handled") return;
      if ((await this.#routeDirect(context)) === "handled") return;
      if ((await this.#routeBrowser(context)) === "handled") return;
      if ((await this.#routeFiles(context)) === "handled") return;
      if ((await routeChannels(context, this.#options.channels, this.#options.agents, hidden)) === "handled") return;
      const { mcpServers } = this.#options;
      const mcpServerOwners = this.#mcpServerOwners();
      if (
        (await routeMcpAccess(context, mcpServers, this.#options.mcpAccess, mcpServerOwners, () => this.#roles())) ===
        "handled"
      )
        return;
      if (
        (await routeMcpServers(context, mcpServers, this.#options.mcpToolRuntimePreparation, mcpServerOwners)) ===
        "handled"
      )
        return;
      if (
        (await routeMcpSignIn(context, mcpServers && this.#options.mcpSignIns, mcpServers, mcpServerOwners)) ===
        "handled"
      )
        return;
      if (
        (await routeMcpSignInApp(context, mcpServers && this.#options.mcpSignIns, mcpServers, mcpServerOwners)) ===
        "handled"
      )
        return;
      if (
        (await routeSignInRelay(
          context,
          mcpServers && this.#options.signInRelay,
          mcpServers,
          mcpServerOwners,
          this.#options.providerAccounts,
        )) === "handled"
      )
        return;
      if ((await routeConnectors(context, this.#options.connectors)) === "handled") return;
      if ((await routeDiscordAccess(context, this.#options.connectors)) === "handled") return;
      if ((await routeWhatsAppConnector(context, this.#options.connectors)) === "handled") return;
      if ((await routeWhatsAppWorkingMessage(context, this.#options.connectors)) === "handled") return;
      if ((await routeWhatsAppStatusReactions(context, this.#options.connectors)) === "handled") return;
      if ((await routeOnePasswordConnector(context, this.#options.onePasswordConnector)) === "handled") return;
      if ((await routeBitwardenConnector(context, this.#options.bitwardenConnector)) === "handled") return;
      if ((await routePasswordManagers(context, this.#options.passwordManagers)) === "handled") return;
      if ((await routeVault(context, this.#options.vault)) === "handled") return;
      if ((await routeVaultImport(context, this.#options.vault)) === "handled") return;
      if ((await routeProviderHostSignIn(context, this.#options.providerHostSignIns)) === "handled") return;
      if ((await routeProviderAccounts(context, this.#options.providerAccounts)) === "handled") return;
      if ((await routeProviderAccountModels(context, this.#options.providerAccounts)) === "handled") return;
      if ((await routeProviderAccountPool(context, this.#options.providerAccounts)) === "handled") return;
      if ((await routeLiveVoiceAccount(context, this.#options.providerAccounts)) === "handled") return;
      if ((await routeProviderAccountKeys(context, this.#options.providerAccounts)) === "handled") return;
      if ((await routeProviderAccountCode(context, this.#options.providerAccounts)) === "handled") return;
      if ((await routeProviderUsageReset(context, this.#options.providerUsageResets)) === "handled") return;
      if ((await routeUsageCredits(context, this.#options.agents, this.#options.providerAccounts)) === "handled")
        return;
      if ((await routeProviderSignOut(context, this.#options.providerSignOut)) === "handled") return;
      if (
        (await routeStorage(
          context,
          this.#options.storage,
          this.#options.channels,
          hidden,
          () => new Set(this.#options.agents.listAgents().map((agent) => agent.id)),
          () => visibleWorkflowIds(context, this.#options.workflows, this.#options.agents, hidden),
          this.#options.libraryFolders,
        )) === "handled"
      )
        return;
      if ((await routeMachineResources(context, this.#options.machine)) === "handled") return;
      if ((await routeBackgroundProcesses(context, this.#options.backgroundProcesses, hidden)) === "handled") return;
      if ((await routeHostedSites(context, this.#options.hostedSites)) === "handled") return;
      if ((await routeAgentAdmin(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentHostSettings(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentBackupModels(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentTaskLimit(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentNewChat(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentPlanCard(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentBuiltinMemory(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentDefaults(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentFastMode(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentSpeed(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeModelSteering(context, this.#options.admin)) === "handled") return;
      if (
        (await routeBrowserProfiles(context, this.#options.browserProfiles, this.#options.browser, hidden)) ===
        "handled"
      )
        return;
      if ((await routeBrowserProxies(context, this.#options.browserProfiles)) === "handled") return;
      if ((await routeRoutineResults(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeRoutineRunCommand(context, this.#options.admin, hidden)) === "handled") return;
      if (
        (await routeRoutineRunPlace(context, this.#options.agents, this.#options.routineRunPlaces, hidden)) ===
        "handled"
      )
        return;
      if (
        (await routeRoutinePauseReasons(context, this.#options.agents, this.#options.routineRunPlaces, hidden)) ===
        "handled"
      )
        return;
      if ((await routeRoutinesOnce(context, this.#options.agents, this.#options.channels, hidden)) === "handled")
        return;
      if ((await routeAgentSessionSettings(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentFolders(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeChannelFolders(context, this.#options.admin)) === "handled") return;
      if ((await routeAgentInstructions(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentHidden(context, this.#options.hiddenAgents, hidden)) === "handled") return;
      if ((await routeAgentColors(context, this.#options.agents, hidden)) === "handled") return;
      if (
        (await routeChatColors(context, this.#options.agents, () => this.#options.store.listMembers(), hidden)) ===
        "handled"
      )
        return;
      if ((await routeSidebarFolders(context, this.#options.sidebarLayout, this.#options.agents, hidden)) === "handled")
        return;
      if (
        (await routeLibraryFolders(
          context,
          this.#options.libraryFolders,
          hidden,
          () => new Set(this.#options.agents.listAgents().map((agent) => agent.id)),
          () => visibleWorkflowIds(context, this.#options.workflows, this.#options.agents, hidden),
        )) === "handled"
      )
        return;
      if (
        (await routeAgentNotificationLevels(
          context,
          this.#options.agentNotificationLevels,
          this.#options.agents,
          hidden,
        )) === "handled"
      )
        return;
      if ((await routeSidebarPins(context, this.#options.sidebarPins, hidden)) === "handled") return;
      if ((await routeAgentTasks(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeAgentQueueTask(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeAgentActiveQueues(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeAgentThreadQueue(context, this.#options.agentTasks, this.#options.agents, hidden)) === "handled")
        return;
      if ((await routeAgentThreadRequests(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeAgentUsageLimit(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeAgentPendingRuntime(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeAgentThreads(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeAgentThreadReads(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeAgentThreadFiles(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeAgentThreadReplies(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeAgentThreadBranches(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeAgentThreadPages(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeAgentArchivedThreads(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeSkillsAdmin(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeGithubSkills(context, this.#options.admin)) === "handled") return;
      if ((await routeSharedTables(context, this.#options.admin)) === "handled") return;
      if ((await routeAgentInstall(context, this.#options.admin, hidden, newAgentHidden)) === "handled") return;
      if ((await routeAgentPublish(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAcpRegistry(context, this.#options.admin)) === "handled") return;
      if ((await routeCustomAgents(context, this.#options.admin)) === "handled") return;
      if ((await routeProviders(context, this.#options.admin, this.#options.providerAccounts)) === "handled") return;
      if ((await routeProviderUse(context, this.#options.admin)) === "handled") return;
      if ((await routeHostAdmin(context, this.#options.admin)) === "handled") return;
      if ((await routeHostAppearance(context, this.#options.admin)) === "handled") return;
      if ((await routeHostUpdate(context, this.#options.admin)) === "handled") return;
      if ((await routeHostTimezone(context, this.#options.admin)) === "handled") return;
      if ((await routeHostVoiceModel(context, this.#options.admin)) === "handled") return;
      if ((await routeHostTurnLimits(context, this.#options.admin)) === "handled") return;
      if ((await routeHostRestart(context, this.#options.admin)) === "handled") return;
      if ((await routeHostPersonality(context, this.#options.admin)) === "handled") return;
      if ((await routeHostKeyRotation(context, this.#options.admin)) === "handled") return;
      if ((await routeLocalServers(context, this.#options.admin)) === "handled") return;
      if ((await routeAgentMemoryLimit(context, this.#options.admin)) === "handled") return;
      if ((await routeMemoryReview(context, this.#options.admin)) === "handled") return;
      if ((await routeSkillLearning(context, this.#options.admin)) === "handled") return;
      if ((await routeBrowsingMemory(context, this.#options.admin)) === "handled") return;
      if ((await routePromptCacheTtl(context, this.#options.admin)) === "handled") return;
      if ((await routeClaudeUserSetup(context, this.#options.admin)) === "handled") return;
      if ((await routeClaudeCompactWindow(context, this.#options.admin)) === "handled") return;
      if ((await routeCacheExpiryCompaction(context, this.#options.admin)) === "handled") return;
      if ((await routeProviderEnvironment(context, this.#options.admin)) === "handled") return;
      if ((await routeProviderDetection(context, this.#options.admin)) === "handled") return;
      if ((await routeModelVisibility(context, this.#options.admin)) === "handled") return;
      if ((await routeProviderDefault(context, this.#options.admin)) === "handled") return;
      if (
        (await routeAgentAccess(
          context,
          this.#options.agentAccess,
          this.#options.agents,
          this.#options.store.getIdentity()?.serverId,
          hidden,
        )) === "handled"
      )
        return;
      if (
        (await routeServerAudit(context, this.#options.serverAudit, this.#options.store.getIdentity()?.serverId)) ===
        "handled"
      )
        return;
      if ((await routeContextReset(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeContextCompact(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeAgentWaits(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routePendingApproval(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routePendingPrompts(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routePhoneFeedback(context, this.#options.agents)) === "handled") return;
      if ((await routeMessagePins(context, this.#options.agents, this.#options.agentTasks, hidden)) === "handled")
        return;
      if ((await routeMessageDelete(context, this.#options.agents, this.#options.channels, hidden)) === "handled")
        return;
      if ((await routeChatHistory(context, this.#options.agents, this.#options.channels, hidden)) === "handled") return;
      if ((await routeConversationUnreadFrom(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeAgentMemoryPage(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeWorkspaceDirectory(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeConversationFiles(context, this.#options.agents)) === "handled") return;
      if ((await routeThreadMessageSearch(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeSideQuestion(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeSkillSuggestionSave(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeFeedbackWithdraw(context, this.#options.agents, hidden)) === "handled") return;
      if (
        (await routeLiveVoice(context, {
          liveVoice: this.#options.liveVoice,
          agents: this.#options.agents,
          hiddenAgentIds: hidden,
          sessions: this.#liveVoiceSessions,
          hasEventConnection: (teamSessionId, memberId) =>
            [...this.#eventClients].some(
              ([client, connection]) =>
                connection.sessionId === teamSessionId &&
                connection.memberId === memberId &&
                connection.capabilities.has(LIVE_VOICE_CAPABILITY) &&
                client.readyState === webSockets.WebSocket.OPEN,
            ),
        })) === "handled"
      )
        return;
      if ((await routeRoutineFlows(context, this.#options.routineFlows, this.#options.agents, hidden)) === "handled")
        return;
      if ((await routeWorkflows(context, this.#options.workflows, this.#options.agents, hidden)) === "handled") return;
      if (
        (await routeWorkflowFolders(
          context,
          this.#options.workflows,
          this.#options.workflowFolders,
          this.#options.agents,
          hidden,
        )) === "handled"
      )
        return;
      if ((await routeCrm(context, this.#options.crm)) === "handled") return;
      if ((await this.#routeEvents(context)) === "handled") return;
      if ((await routeAgentImport(context, this.#options.agentImport, newAgentHidden)) === "handled") return;
      if ((await routeHermesImport(context, this.#options.hermesImport, newAgentHidden)) === "handled") return;
      if ((await routeInstanceTransfer(context, this.#options.instanceTransfer, newAgentHidden)) === "handled") return;
      if ((await routeInstanceTransferChunks(context, this.#options.instanceTransfer)) === "handled") return;
      if (
        (await routeLiveActivityPush(context, this.#options.liveActivityPush, () =>
          this.hiddenAgentIds(context.protocol, context.capabilities, context.member.id),
        )) === "handled"
      )
        return;
      if ((await routePushNotifications(context, this.#options.pushNotifications)) === "handled") return;
      if ((await routeComputerActivity(context, this.#options.pushNotifications)) === "handled") return;
      if (
        (await routeFocusUse(context, this.#options.focusUse ? (id) => this.#recordFocusUse(id) : undefined)) ===
        "handled"
      )
        return;
      if ((await this.#routeAgents(context)) === "handled") return;

      return this.#json(response, 404, { error: sourceText("error.team.routeNotFound") });
    } catch (error) {
      const expected =
        error instanceof HttpError ||
        error instanceof RemoteScreenError ||
        error instanceof TeamStoreError ||
        error instanceof McpServerError ||
        error instanceof AnalyticsInputError ||
        error instanceof AgentMemorySelectionError ||
        error instanceof AgentThreadLimitError ||
        error instanceof AgentSettingsRefused;
      const status =
        error instanceof HttpError || error instanceof RemoteScreenError
          ? error.status
          : error instanceof AgentThreadLimitError || error instanceof AgentSettingsRefused
            ? 409
            : expected
              ? 400
              : 500;
      const message =
        expected || (error instanceof Error && isFixedSourceText(error.message))
          ? error.message
          : sourceText("error.team.requestFailed");
      const code = error instanceof RemoteScreenError ? error.code : undefined;
      if (!expected) (this.#options.logger ?? logger).error("Team API request failed:", toLogValue(error));
      if (response.headersSent) {
        response.destroy();
        return;
      }
      return this.#json(response, status, { error: message, ...(code ? { code } : {}) });
    }
  }

  #routeTeam(context: TeamApiRequestContext): Promise<RouteOutcome> {
    const { remoteScreen, browserView, createInvite, updateMember, removeMember, onSessionRevoked } = this.#options;
    return routeTeam(context, {
      store: this.#options.store,
      browser: this.#options.browser,
      ...(remoteScreen === undefined ? {} : { remoteScreen }),
      ...(browserView === undefined ? {} : { browserView }),
      ...(createInvite === undefined ? {} : { createInvite }),
      ...(updateMember === undefined ? {} : { updateMember }),
      ...(removeMember === undefined ? {} : { removeMember }),
      ...(onSessionRevoked === undefined ? {} : { onSessionRevoked }),
      getPresence: () => this.getPresence(),
      refreshPresence: () => this.refreshPresence(),
    });
  }

  #routeRemoteScreen(context: TeamApiRequestContext): Promise<RouteOutcome> {
    const { remoteScreen, remoteControlAccess } = this.#options;
    return routeRemoteScreen(context, {
      store: this.#options.store,
      ...(remoteScreen === undefined ? {} : { remoteScreen }),
      ...(remoteControlAccess === undefined ? {} : { remoteControlAccess }),
    });
  }

  #routeDirect(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeDirect(context, {
      listDirectThreads: (memberId) => this.listDirectThreads(memberId),
      readDirectConversation: (memberId, otherMemberId) => this.readDirectConversation(memberId, otherMemberId),
      readDirectConversationPage: (memberId, otherMemberId, anchor, limit) =>
        this.readDirectConversationPage(memberId, otherMemberId, anchor, limit),
      sendDirectMessage: (senderMemberId, input) => this.sendDirectMessage(senderMemberId, input),
      markDirectRead: (memberId, otherMemberId, throughSequence) =>
        this.markDirectRead(memberId, otherMemberId, throughSequence),
    });
  }

  #routeBrowser(context: TeamApiRequestContext): Promise<RouteOutcome> {
    const browserView = this.#options.browserView;
    return routeBrowser(context, {
      browser: this.#options.browser,
      ...(browserView === undefined ? {} : { browserView }),
      blockedAgentIds: () => this.#blockedAgentIds(context.member),
    });
  }

  #routeFiles(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeFiles(context, {
      agents: this.#options.agents,
      mailbox: this.#options.mailbox,
      attachmentPreviews: this.#options.attachmentPreviews,
    });
  }

  #routeAgents(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeAgents(context, {
      agents: this.#options.agents,
      skills: this.#options.skills,
      sidebarLayout: this.#options.sidebarLayout,
      libraryFolders: this.#options.libraryFolders,
      duplicateAgent: (agentId, operationId) => this.#duplicateAgent(agentId, operationId),
      ...(this.#options.admin?.modelVisibility ? { visibleModels: this.#options.admin.modelVisibility } : {}),
    });
  }

  #routeEvents(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeEvents(context, { events: this.#options.events });
  }

  #checkRate(request: IncomingMessage, username: string): void {
    const key = `${this.#rateLimitSource(request)}:${username.trim().toLowerCase()}`;
    const now = this.#now();
    this.#pruneRateLimits(now, this.#rateLimits.size >= this.#rateLimitCapacity);
    const current = this.#rateLimits.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.#rateLimits.size >= this.#rateLimitCapacity) {
        throw new HttpError(429, sourceText("error.team.tooManySignInAttempts"));
      }
      this.#rateLimits.set(key, { attempts: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return;
    }
    current.attempts += 1;
    if (current.attempts > RATE_LIMIT_ATTEMPTS) {
      throw new HttpError(429, sourceText("error.team.tooManySignInAttempts"));
    }
  }

  #rateLimitSource(request: IncomingMessage): string {
    const address = request.socket.remoteAddress ?? "local";
    const webRtcSession = request.headers["x-openbot-webrtc-session"];
    const token = bearerToken(request.headers.authorization);
    if (!isString(webRtcSession) || !token) return address;
    const authenticated = this.#options.store.authenticateSession(token);
    return authenticated?.sessionId === webRtcSession ? `webrtc:${webRtcSession}` : address;
  }

  #pruneRateLimits(now: number, force: boolean): void {
    if (!force && now < this.#nextRateLimitSweepAt) return;
    for (const [key, entry] of this.#rateLimits) {
      if (entry.resetAt <= now) this.#rateLimits.delete(key);
    }
    this.#nextRateLimitSweepAt = now + RATE_LIMIT_SWEEP_MS;
  }

  #peerView(
    value: unknown,
    capabilities: ReadonlySet<string>,
    blocked: ReadonlySet<string>,
    providerHidden?: ReadonlySet<string>,
  ): unknown {
    const protocol = eventProtocol(capabilities);
    const hidden = new Set(providerHidden ?? hiddenProviderAgentIds(this.#options.agents.listAgents(), protocol));
    for (const id of blocked) hidden.add(id);
    const visible = protocol === 1 ? legacyProviderView(value, hidden) : hiddenAgentView(value, hidden, protocol);
    return capabilities.has(TEAM_REASONING_EFFORTS_CAPABILITY) ? visible : withLegacyReasoningEfforts(visible);
  }

  #encodeProviderEvent(
    event: AgentEvent | TeamRealtimeEvent,
    capabilities: ReadonlySet<string>,
    options: { preserveSemanticTags?: boolean } = {},
    blocked: ReadonlySet<string> = new Set(),
    providerHidden?: ReadonlySet<string>,
  ): string | null {
    const protocol = eventProtocol(capabilities);
    const view = this.#peerView(event, capabilities, blocked, providerHidden);
    if (!isAgentEvent(view) && !isTeamRealtimeEvent(view)) return null;
    const visible = usageEventForPeer(view, capabilities);
    if (visible === null) return null;
    if (protocol !== 1) {
      const encoded = (
        protocol === 8
          ? encodeTeamProtocolV8BaseCurrentEvent
          : protocol === 7
            ? encodeTeamProtocolV7BaseCurrentEvent
            : protocol === 6
              ? encodeTeamProtocolV6BaseCurrentEvent
              : protocol === 5
                ? encodeTeamProtocolV5BaseCurrentEvent
                : encodeTeamProtocolV4BaseCurrentEvent
      )(visible, {
        ...options,
        preserveBrowserSecrets: capabilities.has("browser-secret-handoff"),
        browserSignIn: capabilities.has(BROWSER_SIGN_IN_CAPABILITY),
        browserVaultSkip: capabilities.has(BROWSER_VAULT_SKIP_CAPABILITY),
        contextUsage: capabilities.has(TEAM_CONTEXT_USAGE_CAPABILITY),
        backgroundWork: capabilities.has(AGENT_BACKGROUND_WORK_CAPABILITY),
        usageTertiary: capabilities.has(TEAM_USAGE_TERTIARY_CAPABILITY),
        usageGroups: capabilities.has(TEAM_USAGE_GROUPS_CAPABILITY),
        usageReadFailed: capabilities.has(TEAM_USAGE_READ_FAILED_CAPABILITY),
        agentPendingRuntime: capabilities.has(AGENT_PENDING_RUNTIME_CAPABILITY),
        queueHold: capabilities.has(QUEUE_HOLD_CAPABILITY),
        queueHoldSignIn: capabilities.has(QUEUE_HOLD_SIGN_IN_CAPABILITY),
        uiBlocks: capabilities.has(TEAM_UI_BLOCKS_CAPABILITY),
        subagents: capabilities.has(TEAM_SUBAGENTS_CAPABILITY),
        promptMultiSelect: capabilities.has(TEAM_PROMPT_MULTI_SELECT_CAPABILITY),
        videoGeneration: capabilities.has(TEAM_VIDEO_GENERATION_CAPABILITY),
        memoryChanges: capabilities.has(TEAM_MEMORY_CHANGES_CAPABILITY),
      });
      if (encoded === null) return null;
      const answered = capabilities.has(TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY)
        ? withUiBlockAutoAnswers(encoded, visible)
        : encoded;
      const withVault = capabilities.has(TEAM_UI_BLOCK_VAULT_CAPABILITY)
        ? withUiBlockVaultRequests(answered, visible)
        : answered;
      return capabilities.has(SKILL_LEARNING_CAPABILITY) ? withSkillSuggestionNames(withVault, visible) : withVault;
    }
    return encodeTeamProtocolV1CurrentEvent(visible, options);
  }

  #broadcastAgentEvent(event: AgentEvent, memberId?: string): void {
    if (event.type !== "conversation") {
      this.#broadcastAgentEventToClients(event, "all", memberId);
      if (event.type === "agents-changed") {
        this.#broadcastAgentColors();
        this.#broadcastChatColors();
      }
      return;
    }

    const agents = this.#options.agents.listAgents();
    const primaryAgent = agents.find((agent) => agent.id === event.snapshot.agentId);
    if (!primaryAgent || primaryAgent.threadId !== event.snapshot.threadId) {
      this.#broadcastAgentEventToClients(event, "modern", undefined, agents);
      return;
    }
    const hasLegacyClient = this.#hasLegacyConversationClient();
    this.#broadcastAgentEventToClients(event, hasLegacyClient ? "modern" : "all", undefined, agents);
    if (hasLegacyClient) this.#queueLegacyConversationEvent(event);
  }

  #hasLegacyConversationClient(): boolean {
    for (const connection of this.#eventClients.values()) if (isLegacyConversationClient(connection)) return true;
    return false;
  }

  #queueLegacyConversationEvent(event: Extract<AgentEvent, { type: "conversation" }>, retries = 0): void {
    const agentId = event.snapshot.agentId;
    const pending = this.#pendingLegacyConversationReads.get(agentId);
    if (pending) {
      pending.event = event;
      return;
    }

    const next: PendingLegacyConversationRead = { event, retries };
    this.#pendingLegacyConversationReads.set(agentId, next);
    const materialize = Effect.gen({ self: this }, function* () {
      if (!this.#options.agents.listAgents().some((agent) => agent.id === agentId)) {
        this.#pendingLegacyConversationReads.delete(agentId);
        return;
      }
      if (!this.#hasLegacyConversationClient()) {
        this.#pendingLegacyConversationReads.delete(agentId);
        return;
      }
      const snapshot = yield* this.#options.agents.readConversation(agentId);
      if (this.#pendingLegacyConversationReads.get(agentId) !== next) return;
      if (!this.#options.agents.listAgents().some((agent) => agent.id === agentId)) {
        this.#pendingLegacyConversationReads.delete(agentId);
        return;
      }
      if (!this.#hasLegacyConversationClient()) {
        this.#pendingLegacyConversationReads.delete(agentId);
        return;
      }
      const latest = next.event;
      if (snapshot.revision < latest.snapshot.revision && next.retries === 0) {
        this.#pendingLegacyConversationReads.delete(agentId);
        this.#queueLegacyConversationEvent(latest, 1);
        return;
      }
      if (snapshot.revision < latest.snapshot.revision) {
        this.#pendingLegacyConversationReads.delete(agentId);
        (this.#options.logger ?? logger).warn("Legacy conversation event read is behind its revision.");
        return;
      }
      this.#pendingLegacyConversationReads.delete(agentId);
      this.#broadcastAgentEventToClients({ type: "conversation", snapshot }, "legacy");
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (this.#pendingLegacyConversationReads.get(agentId) === next) {
            this.#pendingLegacyConversationReads.delete(agentId);
          }
          (this.#options.logger ?? logger).warn(
            "Legacy conversation event could not be materialized:",
            toLogValue(error.cause),
          );
        }),
      ),
      Effect.forkIn(this.#legacyConversationScope, { startImmediately: true }),
    );
    Effect.runFork(materialize);
  }

  #broadcastAgentEventToClients(
    broadcast: AgentEvent,
    audience: ConversationEventAudience = "all",
    memberId?: string,
    agentList?: readonly AgentSummary[],
  ): void {
    const filteredConversationPayloads = new Map<string, string>();
    let agents = () => {
      const list = agentList ?? this.#options.agents.listAgents();
      agents = () => list;
      return list;
    };
    const providerHidden = new Map<number, Set<string>>();
    const providerHiddenFor = (protocol: number) => {
      let hidden = providerHidden.get(protocol);
      if (!hidden) {
        hidden = hiddenProviderAgentIds(agents(), protocol);
        providerHidden.set(protocol, hidden);
      }
      return hidden;
    };
    const taskHidden = new Map<string, Set<string>>();
    const taskHiddenFor = (capabilities: ReadonlySet<string>) => {
      const protocol = eventProtocol(capabilities);
      const key = `${protocol}:${capabilities.has(TEAM_REASONING_EFFORTS_CAPABILITY)}:${supportsTeamSemanticTags(capabilities)}`;
      let hidden = taskHidden.get(key);
      if (!hidden) {
        hidden = this.#hiddenAgentIdsOf(agents(), protocol, capabilities);
        taskHidden.set(key, hidden);
      }
      return hidden;
    };
    const encodedPayloads = new Map<string, string | null>();
    const access = new Map<string, { member: AccessMember; blocked: Set<string>; key: string }>();
    const accessFor = (connection: EventClientState) => {
      const known = access.get(connection.memberId);
      if (known) return known;
      const member = this.#connectionMember(connection);
      const blocked = this.#blockedAgentIds(member, agents());
      const resolved = { member, blocked, key: [...blocked].sort().join(",") };
      access.set(connection.memberId, resolved);
      return resolved;
    };

    let runtimeSnapshot = () => {
      const snapshot = this.#options.agents.getRuntimeSnapshot();
      runtimeSnapshot = () => snapshot;
      return snapshot;
    };
    for (const [client, connection] of this.#eventClients) {
      if (memberId !== undefined && connection.memberId !== memberId) continue;
      const event = this.#eventFor(connection, broadcast, () => accessFor(connection));
      if (event !== broadcast && event.type === "usage-changed" && event.usage.limits.length === 0) continue;
      if (event.type === "conversation") {
        const legacy = isLegacyConversationClient(connection);
        if ((audience === "legacy" && !legacy) || (audience === "modern" && legacy)) continue;
      }
      const encodingOptions = { preserveSemanticTags: supportsTeamSemanticTags(connection.capabilities) };
      const supportsRuntimeSnapshots = connection.capabilities.has("agent-runtime-snapshots");
      const requiredCapability = eventCapability(event);
      if (requiredCapability && !connection.capabilities.has(requiredCapability)) continue;
      if (
        (event.type === "conversation" ||
          event.type === "agent-task-conversation" ||
          event.type === "agent-task-conversation-delta") &&
        !connection.includeConversationEvents
      ) {
        continue;
      }
      if (event.type === "queue-changed" && supportsRuntimeSnapshots && !connection.includeConversationEvents) {
        continue;
      }
      const { member, blocked, key: blockedKey } = accessFor(connection);
      if (event.type === "crm-changed" && !canAdministerServer(member.role)) continue;
      const protocol = eventProtocol(connection.capabilities);
      const encodeEvent = (event: AgentEvent, options: { preserveSemanticTags?: boolean } = {}, sharedAs?: string) => {
        const key =
          sharedAs === undefined
            ? undefined
            : `${sharedAs}|${eventEncodingKey(connection.capabilities, options)}|${blockedKey}`;
        if (key !== undefined && encodedPayloads.has(key)) return encodedPayloads.get(key) ?? null;
        let encoded: string | null;
        perfCount("teamapi.encode");
        try {
          encoded = this.#encodeProviderEvent(
            event,
            connection.capabilities,
            options,
            blocked,
            providerHiddenFor(protocol),
          );
        } catch (error) {
          (this.#options.logger ?? logger).warn("Team API event could not be encoded:", toLogValue(error));
          encoded = null;
        }
        if (key !== undefined) encodedPayloads.set(key, encoded);
        return encoded;
      };
      let outgoing: string;
      let optional: OptionalTeamEvent | null;
      try {
        optional =
          event.type === "turn-completed" && event.quiet && connection.capabilities.has(QUIET_TURN_CAPABILITY)
            ? {
                type: "quiet-turn-completed" as const,
                agentId: event.agentId,
                threadId: event.threadId,
                turnId: event.turnId,
                status: event.status,
                ...(event.origin === undefined ? {} : { origin: event.origin }),
              }
            : event.type === "sidebar-layout-changed" && connection.capabilities.has(SIDEBAR_FOLDERS_CAPABILITY)
              ? // The layout with the parents. `sidebar-layout-changed` goes through the frozen adapter, which drops them.
                sidebarFoldersEvent({
                  type: "sidebar-folders-changed",
                  layout: this.#peerView(event.layout, connection.capabilities, blocked, providerHiddenFor(protocol)),
                })
              : optionalTeamEvent(
                  event.type === "agent-task-conversation"
                    ? {
                        ...event,
                        snapshot: conversationSnapshotForCapabilities(event.snapshot, connection.capabilities),
                      }
                    : event.type === "agent-tasks-changed"
                      ? { ...event, snapshot: agentTasksWireSnapshot(event.snapshot, connection.capabilities) }
                      : event,
                  { agentTaskUiBlocks: connection.capabilities.has(AGENT_TASK_UI_BLOCKS_CAPABILITY) },
                );
      } catch (error) {
        (this.#options.logger ?? logger).warn("Team API event could not be encoded:", toLogValue(error));
        continue;
      }
      if (optional) {
        const agentId = optionalEventAgentId(optional);
        if (
          agentId !== null &&
          (blocked.has(agentId) ||
            (requiredCapability === AGENT_TASKS_CAPABILITY
              ? taskHiddenFor(connection.capabilities)
              : providerHiddenFor(protocol)
            ).has(agentId))
        )
          continue;
        outgoing = JSON.stringify(
          optional.type === "hidden-agents-changed"
            ? {
                type: optional.type,
                ...visibleSnapshot(
                  optional,
                  this.#hiddenAgentIdsOf(agents(), protocol, connection.capabilities, member),
                ),
              }
            : optional.type === "agent-colors-changed"
              ? {
                  type: optional.type,
                  ...visibleAgentColors(
                    optional,
                    this.#hiddenAgentIdsOf(agents(), protocol, connection.capabilities, member),
                  ),
                }
              : optional.type === "chat-colors-changed"
                ? {
                    type: optional.type,
                    ...visibleChatColors(
                      optional,
                      this.#hiddenAgentIdsOf(agents(), protocol, connection.capabilities, member),
                    ),
                  }
                : optional,
        );
      } else if (event.type === "conversation" && supportsRuntimeSnapshots) {
        const conversationInvalidation = encodeEvent(
          {
            type: "conversation-invalidated",
            agentId: event.snapshot.agentId,
            revision: event.snapshot.revision,
          },
          {},
          "conversation-invalidated",
        );
        if (!conversationInvalidation) continue;
        outgoing = conversationInvalidation;
      } else if (event.type === "queue-changed" && supportsRuntimeSnapshots) {
        const queueInvalidation = encodeEvent(
          { type: "queue-invalidated", agentId: event.snapshot.agentId },
          {},
          "queue-invalidated",
        );
        if (!queueInvalidation) continue;
        outgoing = queueInvalidation;
      } else if (
        event.type === "conversation" &&
        (!connection.capabilities.has("routine-event-markers") ||
          !connection.capabilities.has("routine-run-event-markers") ||
          !connection.capabilities.has("hosted-site-event-markers") ||
          event.snapshot.messages.some((message) => !markerSupported(message.itemType, connection.capabilities)))
      ) {
        const key = `${blockedKey}:${protocol}:${connection.capabilities.has("opencode")}:${connection.capabilities.has("routine-event-markers")}:${connection.capabilities.has("routine-run-event-markers")}:${connection.capabilities.has("hosted-site-event-markers")}:${connection.capabilities.has(SETTING_LINK_MARKERS_CAPABILITY)}:${connection.capabilities.has(ROUTINE_QUIET_ANSWERS_CAPABILITY)}:${connection.capabilities.has(TEAM_PROMPT_MULTI_SELECT_CAPABILITY)}:${connection.capabilities.has(TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY)}:${connection.capabilities.has(TEAM_UI_BLOCK_VAULT_CAPABILITY)}:${connection.capabilities.has(SKILL_LEARNING_CAPABILITY)}:${encodingOptions.preserveSemanticTags}`;
        let filtered = filteredConversationPayloads.get(key);
        if (!filtered) {
          filtered =
            encodeEvent(
              {
                ...event,
                snapshot: conversationSnapshotForCapabilities(event.snapshot, connection.capabilities),
              },
              encodingOptions,
            ) ?? undefined;
          if (filtered) filteredConversationPayloads.set(key, filtered);
        }
        if (!filtered) continue;
        outgoing = filtered;
      } else {
        const payload = encodeEvent(event, encodingOptions, event === broadcast ? "event" : undefined);
        if (!payload) continue;
        outgoing = payload;
      }
      const limit = event.type === "runtime-snapshot" ? AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT : JSON_LIMIT;
      if (Buffer.byteLength(outgoing) > limit) continue;
      if (client.readyState !== webSockets.WebSocket.OPEN) continue;
      client.send(outgoing);
      perfCount(`teamapi.send ${event.type}`);
      perfCount("teamapi.sendBytes", outgoing.length);
      if (event.type !== "turn-completed" || !supportsRuntimeSnapshots || connection.includeConversationEvents) {
        continue;
      }
      const completionSnapshot = encodeEvent(
        {
          type: "runtime-snapshot",
          snapshot: runtimeSnapshot(),
        },
        encodingOptions,
        "runtime-snapshot",
      );
      if (!completionSnapshot) continue;
      if (Buffer.byteLength(completionSnapshot) > AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT) continue;
      client.send(completionSnapshot);
      perfCount("teamapi.completionSnapshot");
    }
  }

  #sendAgentColors(client: Ws.WebSocket, connection: EventClientState): void {
    const member = this.#connectionMember(connection);
    const hidden = this.hiddenAgentIds(eventProtocol(connection.capabilities), connection.capabilities, member);
    if (client.readyState !== webSockets.WebSocket.OPEN) return;
    const colors = visibleAgentColors(agentColorsOf(this.#options.agents.listAgents()), hidden);
    client.send(JSON.stringify({ type: "agent-colors-changed", ...colors }));
  }

  #broadcastAgentColors(): void {
    this.#broadcastAgentEventToClients({
      type: "agent-colors-changed",
      ...agentColorsOf(this.#options.agents.listAgents()),
    });
  }

  #chatColors(): ChatColors {
    const { store } = this.#options;
    return chatColorsOf(this.#options.agents.listAgents(), store.getIdentity() ? store.listMembers() : []);
  }

  #sendChatColors(client: Ws.WebSocket, connection: EventClientState, colors: ChatColors, force: boolean): void {
    if (!connection.capabilities.has(CHAT_COLORS_CAPABILITY) || client.readyState !== webSockets.WebSocket.OPEN) return;
    const member = this.#connectionMember(connection);
    const hidden = this.hiddenAgentIds(eventProtocol(connection.capabilities), connection.capabilities, member);
    const payload = JSON.stringify({ type: "chat-colors-changed", ...visibleChatColors(colors, hidden) });
    if (!force && payload === connection.chatColorsSent) return;
    connection.chatColorsSent = payload;
    client.send(payload);
  }

  #broadcastChatColors(): void {
    if (this.#eventClients.size === 0) return;
    const colors = this.#chatColors();
    for (const [client, connection] of this.#eventClients) this.#sendChatColors(client, connection, colors, false);
  }

  #sendBrowserPageState(client: Ws.WebSocket, connection: EventClientState): void {
    const tabs = this.#options.browser.listTabs().map((tab) => ({
      tabId: tab.id,
      canGoBack: tab.canGoBack === true,
      canGoForward: tab.canGoForward === true,
    }));
    if (client.readyState !== webSockets.WebSocket.OPEN) return;
    client.send(JSON.stringify(this.#eventFor(connection, { type: "browser-page-state-changed", tabs })));
  }

  #eventFor(connection: EventClientState, event: AgentEvent, access?: () => EventAccess): AgentEvent {
    if (event.type === "usage-changed" && event.usage.limits.some((limit) => limit.accountId !== undefined))
      return {
        ...event,
        usage: { ...event.usage, limits: event.usage.limits.filter((limit) => limit.accountId === undefined) },
      };
    if (event.type === "browser-user-control-changed") {
      const hidden = this.#hiddenTab(connection, event.tabIds, access);
      if (!hidden) return event;
      return { ...event, tabIds: event.tabIds.filter((tabId) => !hidden(tabId)) };
    }
    if (event.type === "browser-page-state-changed") {
      const hidden = this.#hiddenTab(
        connection,
        event.tabs.map((tab) => tab.tabId),
        access,
      );
      if (!hidden) return event;
      return { ...event, tabs: event.tabs.filter((tab) => !hidden(tab.tabId)) };
    }
    if (event.type === "browser-control-changed") {
      const tabIds = event.state.sessions.flatMap((session) => (session.tabId === null ? [] : [session.tabId]));
      const hidden = this.#hiddenTab(connection, tabIds, access);
      if (!hidden) return event;
      return { ...event, state: visibleControlState(event.state, hidden) };
    }
    if (event.type !== "browser-changed") return event;
    const hidden = this.#hiddenTab(
      connection,
      event.tabs.map((tab) => tab.id),
      access,
      new Map(event.tabs.map((tab) => [tab.id, tab.ownerAgentId])),
    );
    if (!hidden) return event;
    const tabs = event.tabs.filter((tab) => !hidden(tab.id));
    return { ...event, tabs, activeTabId: tabs.some((tab) => tab.id === event.activeTabId) ? event.activeTabId : null };
  }

  #hiddenTab(
    connection: EventClientState,
    tabIds: readonly string[],
    access?: () => EventAccess,
    owners?: ReadonlyMap<string, string | null>,
  ): ((tabId: string) => boolean) | undefined {
    if (tabIds.length === 0) return undefined;
    const resolved =
      access?.() ??
      (() => {
        const member = this.#connectionMember(connection);
        return { member, blocked: this.#blockedAgentIds(member) };
      })();
    const hidden = hiddenTabTest(this.#options.browser, resolved.member.role, () => resolved.blocked, owners);
    return tabIds.some(hidden) ? hidden : undefined;
  }

  #connectEvents(
    client: Ws.WebSocket,
    token: string,
    memberId: string,
    supportsSnapshotTransport: boolean,
    acceptsCapabilityDeclaration: boolean,
  ): void {
    const sessionId = this.#options.store.authenticateSession(token)?.sessionId ?? null;
    const connection: EventClientState = {
      token,
      memberId,
      sessionId,
      capabilities: new Set(
        acceptsCapabilityDeclaration
          ? []
          : TEAM_PROTOCOL_V1_CAPABILITIES.filter(
              (capability) =>
                capability !== "routine-event-markers" &&
                capability !== "routine-run-event-markers" &&
                capability !== "hosted-site-event-markers" &&
                (supportsSnapshotTransport || capability !== "agent-runtime-snapshots"),
            ),
      ),
      includeConversationEvents: !supportsSnapshotTransport,
      typingAgentId: null,
      typingTimer: null,
      directTypingRecipientId: null,
      directTypingTimer: null,
      snapshotResponsePending: false,
      snapshotRequestQueued: false,
      nextSnapshotRequestAt: 0,
      chatColorsSent: null,
    };
    this.#eventClients.set(client, connection);
    client.on("error", () => {});
    if (connection.capabilities.has("agent-runtime-snapshots")) {
      this.#sendRuntimeSnapshot(client, connection, false);
    }
    client.on("message", (data, isBinary) => {
      if (isBinary) {
        client.close(1003, "Text events are required");
        return;
      }
      try {
        const text = Buffer.isBuffer(data)
          ? data.toString("utf8")
          : Array.isArray(data)
            ? Buffer.concat(data).toString("utf8")
            : Buffer.from(data).toString("utf8");
        if (text.length > EVENT_PAYLOAD_LIMIT) throw new Error("Event payload is too large.");
        const event = decodeTeamProtocolV1CurrentClientEvent(JSON.parse(text));
        if (event.type === "runtime-snapshot-request" && connection.capabilities.has("agent-runtime-snapshots")) {
          this.#sendRuntimeSnapshot(client, connection, true);
          return;
        }
        if (event.type === "agent-event-scope" && supportsSnapshotTransport) {
          if (acceptsCapabilityDeclaration) {
            if (!event.capabilities) throw new Error("Invalid client capabilities.");
            const snapshotsWereEnabled = connection.capabilities.has("agent-runtime-snapshots");
            const restartWasSent =
              connection.capabilities.has(HOST_UPDATE_CAPABILITY) ||
              connection.capabilities.has(HOST_MEMBER_UPDATE_CAPABILITY);
            const userControlWasSent = connection.capabilities.has(BROWSER_USER_CONTROL_CAPABILITY);
            const pageStateWasSent = connection.capabilities.has(BROWSER_PAGE_STATE_CAPABILITY);
            const machineAlertsWereSent = connection.capabilities.has(MACHINE_RESOURCES_CAPABILITY);
            const colorsWereSent = connection.capabilities.has(AGENT_COLORS_CAPABILITY);
            const chatColorsWereSent = connection.capabilities.has(CHAT_COLORS_CAPABILITY);
            const appearanceWasSent = connection.capabilities.has(HOST_APPEARANCE_CAPABILITY);
            connection.capabilities = new Set(event.capabilities.filter(isTeamCurrentCapability));
            if (connection.capabilities.has("agent-runtime-snapshots") && !snapshotsWereEnabled) {
              this.#sendRuntimeSnapshot(client, connection, false);
            }
            if (!restartWasSent && this.#hostRestart.state !== "none") this.#sendHostRestart(client, connection);
            if (!userControlWasSent && connection.capabilities.has(BROWSER_USER_CONTROL_CAPABILITY))
              this.#sendBrowserUserControl(client, connection);
            if (!pageStateWasSent && connection.capabilities.has(BROWSER_PAGE_STATE_CAPABILITY))
              this.#sendBrowserPageState(client, connection);
            if (!colorsWereSent && connection.capabilities.has(AGENT_COLORS_CAPABILITY))
              this.#sendAgentColors(client, connection);
            if (!chatColorsWereSent && connection.capabilities.has(CHAT_COLORS_CAPABILITY))
              this.#sendChatColors(client, connection, this.#chatColors(), true);
            if (!machineAlertsWereSent) this.#sendPendingMachineAlerts(client, connection);
            if (!appearanceWasSent) this.#sendHostAppearance(client, connection);
          }
          connection.includeConversationEvents = event.includeConversations;
          return;
        }
        if (event.type === "team-direct-typing") {
          if (!connection.capabilities.has("direct-messages")) {
            throw new Error("Direct messages are not enabled for this client.");
          }
          const typing = event.typing;
          const recipientMemberId = event.recipientMemberId;
          if (recipientMemberId.length > INPUT_LIMITS.identifier) {
            throw new Error("Invalid direct typing recipient.");
          }
          this.#requireDirectRecipient(memberId, recipientMemberId);
          this.#setClientDirectTyping(connection, typing ? recipientMemberId : null);
          return;
        }
        if (event.type !== "team-typing") throw new Error("Unsupported team event.");
        const typing = event.typing;
        const agentId = event.agentId;
        if (typing && (!agentId || agentId.length > INPUT_LIMITS.identifier)) {
          throw new Error("A valid agent is required for typing state.");
        }
        const open = !!agentId && this.agentLevel(this.#connectionMember(connection), agentId) !== "none";
        this.#setClientTyping(connection, typing && open ? agentId : null);
      } catch {
        client.close(1003, "Invalid team event payload");
      }
    });
    client.once("close", () => {
      if (connection.typingTimer) clearTimeout(connection.typingTimer);
      if (connection.directTypingTimer) clearTimeout(connection.directTypingTimer);
      const directTypingRecipientId = connection.directTypingRecipientId;
      connection.directTypingRecipientId = null;
      this.#eventClients.delete(client);
      if (sessionId && ![...this.#eventClients.values()].some((other) => other.sessionId === sessionId)) {
        this.#options.liveActivityPush?.disconnected(sessionId);
        this.#options.pushNotifications?.disconnected(sessionId);
        this.#options.browser.releaseUserControlHeldBy({ kind: "session", sessionId });
        const liveVoice = this.#options.liveVoice;
        if (liveVoice)
          for (const voice of this.#liveVoiceSessions.ofTeamSession(sessionId)) {
            this.#liveVoiceSessions.remove(voice.sessionId);
            void runCauseEffect(liveVoice.stopLiveVoice(voice.sessionId, voice.memberId)).catch(() => undefined);
          }
      }
      if (directTypingRecipientId && !this.#hasDirectTyping(connection.memberId, directTypingRecipientId)) {
        this.#publishDirectTyping(connection.memberId, directTypingRecipientId, false);
      }
      this.#publishPresence();
    });
    this.#publishPresence();
  }

  #sendRuntimeSnapshot(client: Ws.WebSocket, connection: EventClientState, rateLimited: boolean): void {
    const now = this.#now();
    if (connection.snapshotResponsePending) {
      if (rateLimited) connection.snapshotRequestQueued = true;
      return;
    }
    if (
      client.readyState !== webSockets.WebSocket.OPEN ||
      client.bufferedAmount > EVENT_PAYLOAD_LIMIT ||
      (rateLimited && now < connection.nextSnapshotRequestAt)
    ) {
      return;
    }
    connection.snapshotResponsePending = true;
    if (rateLimited) connection.nextSnapshotRequestAt = now + RUNTIME_SNAPSHOT_REQUEST_INTERVAL_MS;
    try {
      const payload = this.#encodeProviderEvent(
        {
          type: "runtime-snapshot",
          snapshot: this.#options.agents.getRuntimeSnapshot(),
        },
        connection.capabilities,
        {},
        this.#blockedAgentIds(this.#connectionMember(connection)),
      );
      if (!payload) throw new Error("Runtime snapshot is not supported by Team protocol v1.");
      if (Buffer.byteLength(payload) > AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT) {
        throw new Error("Runtime snapshot exceeds its transport budget.");
      }
      client.send(payload, (error) => {
        connection.snapshotResponsePending = false;
        if (error && client.readyState === webSockets.WebSocket.OPEN) {
          client.close(1011, "Runtime snapshot could not be sent");
          return;
        }
        if (connection.snapshotRequestQueued) {
          connection.snapshotRequestQueued = false;
          this.#sendRuntimeSnapshot(client, connection, true);
        }
      });
    } catch {
      connection.snapshotResponsePending = false;
      client.close(1011, "Runtime snapshot could not be created");
    }
  }

  #setClientTyping(connection: EventClientState, agentId: string | null): void {
    this.#recordClientUse(connection.sessionId, connection.memberId);
    const changed = connection.typingAgentId !== agentId;
    connection.typingAgentId = agentId;
    if (connection.typingTimer) clearTimeout(connection.typingTimer);
    connection.typingTimer = agentId
      ? setTimeout(() => {
          connection.typingTimer = null;
          if (!connection.typingAgentId) return;
          connection.typingAgentId = null;
          this.#publishPresence();
        }, TYPING_TIMEOUT_MS)
      : null;
    connection.typingTimer?.unref?.();
    if (changed) this.#publishPresence();
  }

  #setClientDirectTyping(connection: EventClientState, recipientMemberId: string | null): void {
    this.#recordClientUse(connection.sessionId, connection.memberId);
    const previousRecipientId = connection.directTypingRecipientId;
    const changed = previousRecipientId !== recipientMemberId;
    const recipientAlreadyActive = recipientMemberId
      ? this.#hasDirectTyping(connection.memberId, recipientMemberId)
      : false;
    connection.directTypingRecipientId = recipientMemberId;
    if (changed && previousRecipientId && !this.#hasDirectTyping(connection.memberId, previousRecipientId)) {
      this.#publishDirectTyping(connection.memberId, previousRecipientId, false);
    }
    if (connection.directTypingTimer) clearTimeout(connection.directTypingTimer);
    connection.directTypingTimer = recipientMemberId
      ? setTimeout(() => {
          connection.directTypingTimer = null;
          const expiredRecipientId = connection.directTypingRecipientId;
          if (!expiredRecipientId) return;
          connection.directTypingRecipientId = null;
          if (!this.#hasDirectTyping(connection.memberId, expiredRecipientId)) {
            this.#publishDirectTyping(connection.memberId, expiredRecipientId, false);
          }
        }, TYPING_TIMEOUT_MS)
      : null;
    connection.directTypingTimer?.unref?.();
    if (changed && recipientMemberId && !recipientAlreadyActive) {
      this.#publishDirectTyping(connection.memberId, recipientMemberId, true);
    }
  }

  #hasDirectTyping(senderMemberId: string, recipientMemberId: string): boolean {
    return [...this.#eventClients.values()].some(
      (connection) =>
        connection.memberId === senderMemberId && connection.directTypingRecipientId === recipientMemberId,
    );
  }

  #publishPresence(): void {
    this.#broadcastChatColors();
    const snapshot = this.getPresence();
    this.#options.onPresence?.(snapshot);
    const event: TeamRealtimeEvent = { type: "team-presence", snapshot };
    for (const [client, connection] of this.#eventClients) {
      const payload = this.#encodeProviderEvent(
        event,
        connection.capabilities,
        {},
        this.#blockedAgentIds(this.#connectionMember(connection)),
      );
      if (payload && client.readyState === webSockets.WebSocket.OPEN) client.send(payload);
    }
  }

  #publishDirectMessage(message: DirectMessage): void {
    const memberIds: [string, string] = [message.senderMemberId, message.recipientMemberId];
    const event: DirectMessageRealtimeEvent = {
      type: "team-direct-message",
      message,
      memberIds,
    };
    this.#sendToMembers(memberIds, event);
    const owner = this.#options.store.listMembers().find((member) => member.role === "owner");
    if (owner && memberIds.includes(owner.id)) this.#options.onDirectMessage?.(event);
  }

  #publishDirectTyping(senderMemberId: string, recipientMemberId: string, typing: boolean): void {
    const event: DirectTypingRealtimeEvent = {
      type: "team-direct-typing",
      senderMemberId,
      recipientMemberId,
      typing,
    };
    this.#sendToMembers([senderMemberId, recipientMemberId], event);
    const owner = this.#options.store.listMembers().find((member) => member.role === "owner");
    if (owner && (owner.id === senderMemberId || owner.id === recipientMemberId)) {
      this.#options.onDirectTyping?.(event);
    }
  }

  #sendToMembers(memberIds: string[], event: TeamRealtimeEvent): void {
    const payload = encodeTeamProtocolV1CurrentEvent(event);
    if (!payload) return;
    for (const [client, connection] of this.#eventClients) {
      if (
        connection.capabilities.has("direct-messages") &&
        memberIds.includes(connection.memberId) &&
        client.readyState === webSockets.WebSocket.OPEN
      ) {
        client.send(payload);
      }
    }
  }

  #requireChat(): TeamChatStore {
    if (!this.#options.chat) throw new Error("Direct messages are unavailable.");
    return this.#options.chat;
  }

  #duplicateAgent(
    sourceAgentId: string,
    operationId: string,
  ): Effect.Effect<DuplicateAgentResult, AgentDuplicationFailed> {
    return Effect.suspend(() => {
      const committed = this.#options.agents.committedAgentDuplication(operationId, sourceAgentId);
      if (committed) {
        return Effect.succeed({ agent: committed.agent, layout: this.#options.sidebarLayout.getSnapshot() });
      }
      const pending = this.#duplicateRequests.get(operationId);
      if (pending) {
        if (pending.sourceAgentId !== sourceAgentId) {
          return Effect.fail(
            new AgentDuplicationFailed({
              cause: new Error("This agent duplication operation belongs to another source agent."),
            }),
          );
        }
        return Deferred.await(pending.result);
      }
      const result = Deferred.makeUnsafe<DuplicateAgentResult, AgentDuplicationFailed>();
      this.#duplicateRequests.set(operationId, { sourceAgentId, result });
      return duplicateAgentIntoLayout(
        this.#options.agents,
        this.#options.sidebarLayout,
        sourceAgentId,
        operationId,
        (agentId) => this.copyAgentAccess(sourceAgentId, agentId),
      ).pipe(
        Effect.onExit((exit) => {
          this.#duplicateRequests.delete(operationId);
          return Deferred.done(result, exit);
        }),
        Effect.uninterruptible,
      );
    });
  }

  #requireDirectRecipient(senderMemberId: string, recipientMemberId: string): TeamMemberSummary {
    if (senderMemberId === recipientMemberId) {
      throw new HttpError(400, sourceText("error.team.directMessageSelf"));
    }
    const sender = this.#options.store.getMember(senderMemberId);
    const recipient = this.#options.store.getMember(recipientMemberId);
    if (!sender || sender.disabled) throw new HttpError(403, sourceText("error.host.teamAccessUnavailable"));
    if (!recipient || recipient.disabled) {
      throw new HttpError(404, sourceText("error.team.directRecipientUnavailable"));
    }
    return recipient;
  }

  #json(response: ServerResponse, status: number, value: object | null): RouteOutcome {
    const route = this.#responseRoutes.get(response);
    if (!route) throw new Error("Team API response route is unavailable.");
    const options = {
      preserveSemanticTags: supportsTeamSemanticTags(route.capabilities),
      historyExtent: route.capabilities.has(TEAM_HISTORY_EXTENT_CAPABILITY),
      channelAttention: route.capabilities.has(TEAM_CHANNEL_ATTENTION_CAPABILITY),
      channelIsolation: route.capabilities.has(CHANNEL_ISOLATION_CAPABILITY),
      channelPicture: route.capabilities.has(CHANNEL_PICTURE_CAPABILITY),
      channelBrowser: route.capabilities.has(CHANNEL_BROWSER_CAPABILITY),
      channelSeenSubtasks: route.capabilities.has(CHANNEL_SEEN_SUBTASKS_CAPABILITY),
      channelTaskWaits: route.capabilities.has(CHANNEL_TASK_WAITS_CAPABILITY),
      mcpManyServers: route.capabilities.has(MCP_MANY_SERVERS_CAPABILITY),
      providerManyAccounts: route.capabilities.has(PROVIDER_MANY_ACCOUNTS_CAPABILITY),
      routineResultsWhatsApp: route.capabilities.has(ROUTINE_RESULTS_WHATSAPP_CAPABILITY),
      storageWorkflowFiles: route.capabilities.has(STORAGE_WORKFLOW_FILES_CAPABILITY),
      agentTaskUiBlocks: route.capabilities.has(AGENT_TASK_UI_BLOCKS_CAPABILITY),
      uiBlocks: route.capabilities.has(TEAM_UI_BLOCKS_CAPABILITY),
      subagents: route.capabilities.has(TEAM_SUBAGENTS_CAPABILITY),
      promptMultiSelect: route.capabilities.has(TEAM_PROMPT_MULTI_SELECT_CAPABILITY),
      videoGeneration: route.capabilities.has(TEAM_VIDEO_GENERATION_CAPABILITY),
      memoryChanges: route.capabilities.has(TEAM_MEMORY_CHANGES_CAPABILITY),
      usageTertiary: route.capabilities.has(TEAM_USAGE_TERTIARY_CAPABILITY),
      usageGroups: route.capabilities.has(TEAM_USAGE_GROUPS_CAPABILITY),
      usageReadFailed: route.capabilities.has(TEAM_USAGE_READ_FAILED_CAPABILITY),
      agentPendingRuntime: route.capabilities.has(AGENT_PENDING_RUNTIME_CAPABILITY),
      queueHold: route.capabilities.has(QUEUE_HOLD_CAPABILITY),
      queueHoldSignIn: route.capabilities.has(QUEUE_HOLD_SIGN_IN_CAPABILITY),
    };
    const visibleValue =
      status < 400 && route.hiddenAgentIds
        ? route.protocol < 4
          ? legacyProviderView(value, route.hiddenAgentIds)
          : hiddenAgentView(
              value,
              route.hiddenAgentIds,
              route.protocol < 5 ? 4 : route.protocol < 6 ? 5 : route.protocol < 7 ? 6 : route.protocol < 8 ? 7 : 8,
            )
        : value;
    const effortValue =
      status < 400 && !route.capabilities.has(TEAM_REASONING_EFFORTS_CAPABILITY)
        ? withLegacyReasoningEfforts(visibleValue)
        : visibleValue;
    const sideRoute = teamSideRouteCodec(route.path);
    const encoded = sideRoute
      ? JSON.stringify(sideRoute.response(route.path, status, effortValue, options))
      : teamHttpCodec(route.protocol).encodeResponse(route.method, route.path, status, effortValue, options);
    const answered = route.capabilities.has(TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY)
      ? withUiBlockAutoAnswers(encoded, effortValue)
      : encoded;
    const withVault = route.capabilities.has(TEAM_UI_BLOCK_VAULT_CAPABILITY)
      ? withUiBlockVaultRequests(answered, effortValue)
      : answered;
    const body = route.capabilities.has(SKILL_LEARNING_CAPABILITY)
      ? withSkillSuggestionNames(withVault, effortValue)
      : withVault;
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(`${body}\n`);
    return "handled";
  }

  #unrepresentableAgentIds(
    agents: readonly AgentSummary[],
    protocol: number,
    capabilities: ReadonlySet<string>,
  ): Set<string> {
    const codec = teamHttpCodec(protocol);
    const efforts = capabilities.has(TEAM_REASONING_EFFORTS_CAPABILITY);
    const options = { preserveSemanticTags: supportsTeamSemanticTags(capabilities) };
    const cacheKey = `${protocol}:${efforts}:${options.preserveSemanticTags}`;
    const previous = this.#representableAgents.get(cacheKey);
    const checked = new Map<string, { json: string; representable: boolean }>();
    const hidden = new Set<string>();
    for (const agent of agents) {
      const json = JSON.stringify(agent);
      const known = previous?.get(agent.id);
      let representable = known?.json === json ? known.representable : null;
      if (representable === null) {
        representable = true;
        try {
          const listed = efforts ? [agent] : withLegacyReasoningEfforts([agent]);
          codec.encodeResponse("GET", TEAM_API_ROUTES.agents.all, 200, listed, options);
        } catch {
          representable = false;
        }
      }
      checked.set(agent.id, { json, representable });
      if (!representable) {
        hidden.add(agent.id);
        const key = `${protocol}:${agent.id}`;
        if (this.#reportedUnrepresentableAgents.has(key)) continue;
        this.#reportedUnrepresentableAgents.add(key);
        (this.#options.logger ?? logger).warn(
          `Team API protocol ${protocol} cannot describe agent ${agent.id}; it is hidden from these clients.`,
        );
      }
    }
    this.#representableAgents.set(cacheKey, checked);
    return hidden;
  }

  hiddenAgentIds(protocol: number, capabilities: ReadonlySet<string>, member?: AccessMember | string): Set<string> {
    return this.#hiddenAgentIdsOf(this.#options.agents.listAgents(), protocol, capabilities, member);
  }

  #hiddenAgentIdsOf(
    agents: readonly AgentSummary[],
    protocol: number,
    capabilities: ReadonlySet<string>,
    member?: AccessMember | string,
  ): Set<string> {
    const hidden = hiddenProviderAgentIds(agents, protocol);
    for (const id of this.#unrepresentableAgentIds(
      agents.filter((agent) => !hidden.has(agent.id)),
      protocol,
      capabilities,
    ))
      hidden.add(id);
    if (member !== undefined) for (const id of this.#blockedAgentIds(member, agents)) hidden.add(id);
    return hidden;
  }

  copyAgentAccess(sourceAgentId: string, agentId: string): Effect.Effect<void> {
    const access = this.#options.agentAccess;
    const serverId = this.#options.store.getIdentity()?.serverId;
    if (!access || !serverId) return Effect.void;
    return access
      .copyAgent(serverId, sourceAgentId, agentId)
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("The duplicated agent's roles did not save.", toLogValue(error))),
        ),
      );
  }

  agentLevel(member: AccessMember | string, agentId: string): AgentAccessLevel {
    const access = this.#options.agentAccess;
    const serverId = this.#options.store.getIdentity()?.serverId;
    if (!access || !serverId) return "manage";
    return agentAccessLevel(access.levels(serverId), this.#accessMember(member), agentId);
  }

  #blockedAgentIds(
    member: AccessMember | string,
    agents: readonly AgentSummary[] = this.#options.agents.listAgents(),
  ): Set<string> {
    const blocked = new Set<string>();
    const resolved = this.#accessMember(member);
    const access = this.#options.agentAccess;
    const serverId = this.#options.store.getIdentity()?.serverId;
    if (!access || !serverId || canAdministerServer(resolved.role)) return blocked;
    const levels = access.levels(serverId);
    for (const agent of agents) if (agentAccessLevel(levels, resolved, agent.id) === "none") blocked.add(agent.id);
    return blocked;
  }

  #roles(): readonly AgentAccessRole[] {
    const serverId = this.#options.store.getIdentity()?.serverId;
    const levels = serverId ? this.#options.agentAccess?.levels(serverId) : undefined;
    return levels && levels !== "closed" ? levels.roles : [];
  }

  #mcpServerOwners(): TeamApiMcpServerOwners | undefined {
    const { mcpServerOwners: owners, mcpAccess } = this.#options;
    if (!owners || !mcpAccess) return owners;
    return {
      addedBy: (mcpServerId, memberId) => owners.addedBy(mcpServerId, memberId),
      add: (mcpServerId, memberId) => owners.add(mcpServerId, memberId),
      remove: (mcpServerId) => owners.remove(mcpServerId).pipe(Effect.andThen(mcpAccess.remove(mcpServerId))),
      level: (mcpServerId, memberId) =>
        mcpAccessLevel(
          mcpAccess.get(mcpServerId),
          this.#accessMember(memberId),
          this.#roles(),
          owners.addedBy(mcpServerId, memberId),
        ),
    };
  }

  #accessMember(member: AccessMember | string): AccessMember {
    if (typeof member !== "string") return member;
    const { store } = this.#options;
    const known = store.getMember(member) ?? store.listMembers().find((candidate) => candidate.id === member);
    return known ?? { id: member, role: "member" };
  }

  #connectionMember(connection: EventClientState): AccessMember {
    return this.#options.store.authenticate(connection.token) ?? { id: connection.memberId, role: "member" };
  }

  agentAccessChanged(): void {
    const serverId = this.#options.store.getIdentity()?.serverId;
    if (!this.#options.agentAccess || !serverId) return;
    const revision = this.#options.agentAccess.get(serverId).revision;
    this.#broadcastAgentEventToClients({ type: "agent-access-changed", revision });
    this.#broadcastAgentEventToClients({ type: "agents-changed", agents: this.#options.agents.listAgents() });
    for (const [client, connection] of this.#eventClients)
      if (connection.capabilities.has("agent-runtime-snapshots")) this.#sendRuntimeSnapshot(client, connection, false);
    this.#publishPresence();
    const liveVoice = this.#options.liveVoice;
    if (liveVoice)
      for (const voice of this.#liveVoiceSessions.all())
        if (agentAccessRank(this.agentLevel(voice.memberId, voice.agentId)) < agentAccessRank("chat")) {
          this.#liveVoiceSessions.remove(voice.sessionId);
          void runCauseEffect(liveVoice.stopLiveVoice(voice.sessionId, voice.memberId)).catch(() => undefined);
        }
    this.#endClosedAgentTabs();
  }

  #endClosedAgentTabs(): void {
    const { browser, browserView } = this.#options;
    const owners = new Map(browser.listTabs().map((tab) => [tab.id, tab.ownerAgentId]));
    if (owners.size === 0) return;
    const blocked = new Map<string, ReadonlySet<string>>();
    const refused = (memberId: string, tabId: string) => {
      const owner = owners.get(tabId);
      if (typeof owner !== "string") return false;
      let agents = blocked.get(memberId);
      if (!agents) {
        agents = this.#blockedAgentIds(memberId);
        blocked.set(memberId, agents);
      }
      return agents.has(owner);
    };
    browser.releaseUserControlRefused((tabId, holder) => holder.kind === "member" && refused(holder.memberId, tabId));
    if (browserView)
      void runCauseEffect(browserView.closeRefusedSessions((view) => refused(view.memberId, view.tabId))).catch(
        () => undefined,
      );
    const display = browser.getDisplayState();
    this.#broadcastAgentEventToClients({
      type: "browser-changed",
      tabs: display.tabs,
      activeTabId: display.activeTabId,
    });
  }

  #protocolSupport(protocol: number | null = null): TeamProtocolSupportV1 | TeamProtocolSupportV10 {
    const support = {
      appVersion: this.#options.appVersion ?? "0.0.0",
      protocol: { minimum: TEAM_PROTOCOL_V1, maximum: TEAM_PROTOCOL_V10 },
      capabilities: this.#servedCapabilities(protocol),
    };
    return protocol !== null && protocol >= TEAM_PROTOCOL_V10
      ? { ...support, ...encodeTeamCapabilitiesV10(support.capabilities) }
      : support;
  }

  #servedCapabilities(protocol: number | null): string[] {
    const expanded = protocol !== null && protocol >= 7;
    return teamCapabilitiesVisibleToProtocol(TEAM_CURRENT_CAPABILITIES, protocol ?? TEAM_PROTOCOL_V1).filter(
      (capability) => {
        if (!expanded && !legacyTeamCapabilities([capability]).length) return false;
        if (
          capability === "channel-chats-v1" ||
          capability === CHANNEL_DELETE_CAPABILITY ||
          capability === CHANNEL_TASK_CANCEL_CAPABILITY ||
          capability === CHANNEL_ISOLATION_CAPABILITY ||
          capability === CHANNEL_PICTURE_CAPABILITY ||
          capability === CHANNEL_BROWSER_CAPABILITY
        )
          return this.#options.channels !== undefined;
        if (capability === "remote-desktop-setup")
          return this.#options.remoteScreen?.checkSetup !== undefined && this.#options.remoteScreen?.test !== undefined;
        if (capability === MCP_SERVERS_CAPABILITY) return this.#options.mcpServers !== undefined;
        if (capability === ATTACHMENT_PREVIEW_CAPABILITY) return this.#options.attachmentPreviews !== undefined;
        if (capability === LIVE_VOICE_CAPABILITY) return this.#options.liveVoice !== undefined;
        if (capability === MCP_ACCOUNTS_CAPABILITY)
          return this.#options.mcpServers !== undefined && this.#options.mcpSignIns !== undefined;
        if (capability === MCP_SIGN_IN_CAPABILITY)
          return this.#options.mcpServers !== undefined && this.#options.mcpSignIns !== undefined;
        if (capability === MCP_MEMBER_ACCESS_CAPABILITY)
          return this.#options.mcpServers !== undefined && this.#options.mcpServerOwners !== undefined;
        if (capability === MCP_ACCESS_CAPABILITY)
          return this.#options.mcpServers !== undefined && this.#options.mcpAccess !== undefined;
        if (capability === MCP_SIGN_IN_APP_CAPABILITY)
          return this.#options.mcpServers !== undefined && this.#options.mcpSignIns !== undefined;
        if (capability === SIGN_IN_RELAY_CAPABILITY || capability === SIGN_IN_RELAY_DEEP_LINK_CAPABILITY)
          return this.#options.mcpServers !== undefined && this.#options.signInRelay !== undefined;
        if (capability === PROVIDER_SIGN_IN_RELAY_V2_CAPABILITY)
          return (
            this.#options.mcpServers !== undefined &&
            this.#options.signInRelay !== undefined &&
            devinSignInPageRelayed()
          );
        if (capability === PROVIDER_ACCOUNT_RELAY_CAPABILITY || capability === PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY)
          return (
            this.#options.mcpServers !== undefined &&
            this.#options.signInRelay !== undefined &&
            this.#options.providerAccounts !== undefined
          );
        if (capability === CONNECTORS_CAPABILITY) return this.#options.connectors !== undefined;
        if (capability === DISCORD_ACCESS_CAPABILITY) return this.#options.connectors !== undefined;
        if (capability === WHATSAPP_CONNECTOR_CAPABILITY) return this.#options.connectors !== undefined;
        if (capability === WHATSAPP_WORKING_MESSAGE_CAPABILITY) return this.#options.connectors !== undefined;
        if (capability === WHATSAPP_STATUS_REACTIONS_CAPABILITY) return this.#options.connectors !== undefined;
        if (capability === ONEPASSWORD_CONNECTOR_CAPABILITY) return this.#options.onePasswordConnector !== undefined;
        if (capability === BITWARDEN_CONNECTOR_CAPABILITY) return this.#options.bitwardenConnector !== undefined;
        if (capability === PASSWORD_MANAGERS_CAPABILITY) return this.#options.passwordManagers !== undefined;
        if (capability === VAULT_CAPABILITY) return this.#options.vault !== undefined;
        if (capability === BROWSER_SECRET_VAULT_CAPABILITY) return this.#options.vault !== undefined;
        if (capability === VAULT_IMPORT_CAPABILITY) return this.#options.vault !== undefined;
        if (capability === VAULT_V2_CAPABILITY) return this.#options.vault !== undefined;
        if (capability === VAULT_V3_CAPABILITY) return this.#options.vault !== undefined;
        if (capability === VAULT_V4_CAPABILITY) return this.#options.vault !== undefined;
        if (capability === VAULT_MEMBER_SAVE_CAPABILITY) return this.#options.vault !== undefined;
        if (capability === PROVIDER_HOST_SIGN_IN_CAPABILITY) return this.#options.providerHostSignIns !== undefined;
        if (capability === PROVIDER_ACCOUNTS_CAPABILITY) return this.#options.providerAccounts !== undefined;
        if (capability === PROVIDER_ACCOUNT_MODELS_CAPABILITY) return this.#options.providerAccounts !== undefined;
        if (capability === PROVIDER_ACCOUNT_POOL_CAPABILITY) return this.#options.providerAccounts !== undefined;
        if (capability === LIVE_VOICE_ACCOUNT_CAPABILITY)
          return this.#options.providerAccounts !== undefined && this.#options.liveVoice !== undefined;
        if (capability === PROVIDER_ACCOUNT_KEYS_CAPABILITY) return this.#options.providerAccounts !== undefined;
        if (capability === PROVIDER_ACCOUNT_CODE_CAPABILITY) return this.#options.providerAccounts !== undefined;
        if (capability === PROVIDER_USAGE_RESET_CAPABILITY) return this.#options.providerUsageResets !== undefined;
        if (capability === PROVIDER_SIGN_OUT_CAPABILITY) return this.#options.providerSignOut !== undefined;
        if (capability === STORAGE_CAPABILITY) return this.#options.storage !== undefined;
        if (capability === STORAGE_DISK_CAPABILITY) return this.#options.storage !== undefined;
        if (capability === STORAGE_USER_FILES_CAPABILITY) return this.#options.storage !== undefined;
        if (capability === STORAGE_WORKFLOW_FILES_CAPABILITY)
          return this.#options.storage !== undefined && this.#options.workflows !== undefined;
        if (capability === LIBRARY_FOLDERS_CAPABILITY || capability === LIBRARY_FOLDERS_EVENTS_CAPABILITY)
          return this.#options.libraryFolders !== undefined;
        if (capability === STORAGE_CHANNEL_CAPABILITY)
          return this.#options.storage !== undefined && this.#options.channels !== undefined;
        if (capability === MACHINE_RESOURCES_CAPABILITY) return this.#options.machine !== undefined;
        if (capability === SERVER_SAFE_MODE_CAPABILITY) return false;
        if (capability === BACKGROUND_PROCESSES_CAPABILITY) return this.#options.backgroundProcesses !== undefined;
        if (capability === ROUTINES_ONCE_CAPABILITY) return true;
        if (capability === HOSTED_SITES_CAPABILITY) return this.#options.hostedSites !== undefined;
        if (capability === AGENT_ADMIN_CAPABILITY) return this.#options.admin?.agents !== undefined;
        if (capability === ACP_REGISTRY_CAPABILITY) return this.#options.admin?.acpRegistry !== undefined;
        if (capability === CUSTOM_AGENTS_CAPABILITY) return this.#options.admin?.customAgents !== undefined;
        if (capability === AGENT_SESSION_SETTINGS_CAPABILITY) return this.#options.admin?.sessionSettings !== undefined;
        if (capability === AGENT_FOLDERS_CAPABILITY) return this.#options.admin?.folders !== undefined;
        if (capability === CHANNEL_FOLDERS_CAPABILITY) return this.#options.admin?.channelFolders !== undefined;
        if (capability === AGENT_INSTRUCTIONS_CAPABILITY) return this.#options.admin?.instructions !== undefined;
        if (capability === AGENT_HIDDEN_CAPABILITY) return this.#options.hiddenAgents !== undefined;
        if (capability === AGENT_HIDDEN_WORK_CAPABILITY) return this.#options.hiddenAgents !== undefined;
        if (capability === AGENT_COLORS_CAPABILITY) return true;
        if (capability === CHAT_COLORS_CAPABILITY) return true;
        if (capability === AGENT_TASKS_CAPABILITY) return this.#options.agentTasks !== undefined;
        if (capability === AGENT_QUEUE_TASK_CAPABILITY) return this.#options.agentTasks !== undefined;
        if (capability === AGENT_THREAD_QUEUE_CAPABILITY) return this.#options.agentTasks !== undefined;
        if (capability === AGENT_THREAD_REQUESTS_CAPABILITY) return this.#options.agentTasks !== undefined;
        if (capability === AGENT_ACTIVE_QUEUES_CAPABILITY) return true;
        if (capability === AGENT_CREATE_OPERATION_CAPABILITY) return true;
        if (capability === AGENT_THREADS_CAPABILITY) return this.#options.agentTasks !== undefined;
        if (capability === AGENT_TASK_UI_BLOCKS_CAPABILITY) return this.#options.agentTasks !== undefined;
        if (capability === AGENT_THREAD_READS_CAPABILITY) return this.#options.agentTasks !== undefined;
        if (capability === AGENT_THREAD_FILES_CAPABILITY) return this.#options.agentTasks !== undefined;
        if (capability === AGENT_THREAD_REPLIES_CAPABILITY) return this.#options.agentTasks !== undefined;
        if (capability === AGENT_THREAD_BRANCHES_CAPABILITY) return this.#options.agentTasks !== undefined;
        if (capability === AGENT_THREAD_PAGES_CAPABILITY) return this.#options.agentTasks !== undefined;
        if (capability === AGENT_ARCHIVED_THREADS_CAPABILITY) return this.#options.agentTasks !== undefined;
        if (capability === AGENT_HOST_SETTINGS_CAPABILITY) return this.#options.admin?.agentHost !== undefined;
        if (capability === AGENT_BACKUP_MODELS_CAPABILITY) return this.#options.admin?.agentHost !== undefined;
        if (capability === AGENT_TASK_LIMIT_CAPABILITY) return this.#options.admin?.agentHost !== undefined;
        if (capability === AGENT_NEW_CHAT_CAPABILITY) return this.#options.admin?.agentHost !== undefined;
        if (capability === AGENT_PLAN_CARD_CAPABILITY) return this.#options.admin?.agentHost !== undefined;
        if (capability === AGENT_BUILTIN_MEMORY_CAPABILITY) return this.#options.admin?.agentHost !== undefined;
        if (capability === AGENT_DEFAULTS_CAPABILITY) return this.#options.admin?.agentDefaults !== undefined;
        if (capability === AGENT_FAST_MODE_CAPABILITY) return this.#options.admin?.agentHost !== undefined;
        if (capability === AGENT_SPEED_CAPABILITY) return this.#options.admin?.agentHost !== undefined;
        if (capability === MODEL_STEERING_CAPABILITY) return this.#options.admin?.agentHost !== undefined;
        if (capability === WORKSPACE_ONLY_PROCESS_LIMIT_CAPABILITY) return !canConfineProcesses();
        if (capability === MAC_APPS_LIMIT_CAPABILITY) return process.platform !== "darwin";
        if (
          capability === BROWSER_PROFILES_CAPABILITY ||
          capability === BROWSER_PROFILES_EVENTS_CAPABILITY ||
          capability === BROWSER_PROXIES_CAPABILITY
        )
          return this.#options.browserProfiles !== undefined;
        if (capability === BROWSER_EGRESS_CAPABILITY) return this.#options.browserProfiles !== undefined;
        if (capability === SKILLS_ADMIN_CAPABILITY) return this.#options.admin?.skills !== undefined;
        if (capability === GITHUB_SKILLS_CAPABILITY) return this.#options.admin?.skills !== undefined;
        if (capability === SKILLS_EVENTS_CAPABILITY) return this.#options.skills !== undefined;
        if (capability === SHARED_TABLES_CAPABILITY) return this.#options.admin?.sharedTables !== undefined;
        if (capability === AGENT_INSTALL_CAPABILITY)
          return (
            this.#options.admin?.marketplaceAgents !== undefined && this.#options.admin?.agentTemplates !== undefined
          );
        if (capability === AGENT_UPDATE_CAPABILITY) return this.#options.admin?.marketplaceAgents !== undefined;
        if (capability === AGENT_PUBLISH_CAPABILITY) return this.#options.admin?.agentTemplates !== undefined;
        if (
          capability === PROVIDERS_ADMIN_CAPABILITY ||
          capability === PROVIDERS_RUNTIMES_V2_CAPABILITY ||
          capability === PROVIDERS_V4_CAPABILITY ||
          capability === PROVIDERS_V5_CAPABILITY ||
          capability === PROVIDERS_V8_CAPABILITY ||
          capability === PROVIDER_USE_CAPABILITY ||
          capability === CUSTOM_PROVIDER_HARNESS_CAPABILITY ||
          capability === CUSTOM_PROVIDER_EDIT_CAPABILITY ||
          capability === CUSTOM_PROVIDER_HARNESS_CHOICE_CAPABILITY
        )
          return this.#options.admin?.providers !== undefined;
        if (
          capability === CLAUDE_API_KEY_CAPABILITY ||
          capability === CODEX_API_KEY_CAPABILITY ||
          capability === MISTRAL_CODE_SIGN_IN_CAPABILITY
        )
          return this.#options.admin?.providers !== undefined;
        if (capability === PROVIDERS_SIGN_IN_V3_CAPABILITY) return this.#options.admin?.providers?.pasteSignIn === true;
        if (capability === HOST_ADMIN_CAPABILITY) return this.#options.admin?.identity !== undefined;
        if (capability === HOST_APPEARANCE_CAPABILITY) return this.#options.admin?.identity !== undefined;
        if (capability === HOST_RELEASE_CAPABILITY) return this.#options.admin?.release !== undefined;
        if (capability === HOST_TIMEZONE_CAPABILITY) return this.#options.admin?.timezone !== undefined;
        if (capability === HOST_VOICE_MODEL_CAPABILITY) return this.#options.admin?.voiceModel !== undefined;
        if (capability === HOST_TURN_LIMITS_CAPABILITY) return this.#options.admin?.turnLimits !== undefined;
        if (capability === HOST_RESTART_CAPABILITY) return this.#options.admin?.restart !== undefined;
        if (capability === OWNER_TRANSFER_CAPABILITY) return this.#options.admin?.ownerTransfer === true;
        if (capability === HOST_PERSONALITY_CAPABILITY) return this.#options.admin?.personality !== undefined;
        if (capability === HOST_KEY_ROTATION_CAPABILITY) return this.#options.admin?.hostKey !== undefined;
        if (capability === LOCAL_SERVERS_CAPABILITY) return this.#options.admin?.localServers !== undefined;
        if (capability === AGENT_MEMORY_LIMIT_CAPABILITY) return this.#options.admin?.memoryLimit !== undefined;
        if (capability === MEMORY_REVIEW_CAPABILITY) return this.#options.admin?.memoryReview !== undefined;
        if (capability === SKILL_LEARNING_CAPABILITY) return this.#options.admin?.skillLearning !== undefined;
        if (capability === BROWSING_MEMORY_CAPABILITY) return this.#options.admin?.browsingMemory !== undefined;
        if (capability === PROMPT_CACHE_TTL_CAPABILITY || capability === PROMPT_CACHE_TTL_PI_CAPABILITY)
          return this.#options.admin?.promptCacheTtl !== undefined;
        if (capability === CLAUDE_USER_SETUP_CAPABILITY) return this.#options.admin?.claudeUserSetup !== undefined;
        if (capability === CLAUDE_COMPACT_WINDOW_CAPABILITY)
          return this.#options.admin?.claudeCompactWindow !== undefined;
        if (capability === CACHE_EXPIRY_COMPACTION_CAPABILITY)
          return this.#options.admin?.cacheExpiryCompaction !== undefined;
        if (capability === PROVIDER_ENVIRONMENT_CAPABILITY)
          return this.#options.admin?.providerEnvironment !== undefined;
        if (capability === PROVIDER_DETECTION_CAPABILITY) return this.#options.admin?.providerDetection !== undefined;
        if (capability === MODEL_VISIBILITY_CAPABILITY) return this.#options.admin?.modelVisibility !== undefined;
        if (capability === PROVIDER_DEFAULT_CAPABILITY) return this.#options.admin?.defaultProvider !== undefined;
        if (capability === AGENT_ACCESS_CAPABILITY) return this.#options.agentAccess !== undefined;
        if (capability === SERVER_AUDIT_CAPABILITY) return this.#options.serverAudit !== undefined;
        if (capability === HOST_UPDATE_CAPABILITY || capability === HOST_MEMBER_UPDATE_CAPABILITY)
          return this.#options.admin?.update !== undefined;
        if (capability === EVENTS_CAPABILITY) return this.#options.events !== undefined;
        if (capability === ROUTINE_RECOVERY_CAPABILITY) return this.#options.events !== undefined;
        if (capability === ROUTINE_RESULTS_CAPABILITY || capability === ROUTINE_RESULTS_WHATSAPP_CAPABILITY)
          return this.#options.admin?.routineResults !== undefined;
        if (capability === ROUTINE_RUN_COMMAND_CAPABILITY) return this.#options.admin?.routineRunCommand !== undefined;
        if (capability === ROUTINE_RUN_PLACE_CAPABILITY) return this.#options.routineRunPlaces !== undefined;
        if (capability === ROUTINE_PAUSE_REASONS_CAPABILITY) return this.#options.routineRunPlaces !== undefined;
        if (capability === WEBHOOK_TESTS_CAPABILITY) return this.#options.events !== undefined;
        if (capability === WEBHOOK_SENDER_SECRET_CAPABILITY) return this.#options.events !== undefined;
        if (capability === WEBHOOK_AGENT_SECRET_CAPABILITY) return this.#options.events !== undefined;
        if (capability === AGENT_IMPORT_CAPABILITY || capability === AGENT_IMPORT_V2_CAPABILITY)
          return this.#options.agentImport !== undefined;
        if (capability === HERMES_IMPORT_CAPABILITY) return this.#options.hermesImport !== undefined;
        if (capability === INSTANCE_TRANSFER_CAPABILITY) return this.#options.instanceTransfer !== undefined;
        if (capability === INSTANCE_TRANSFER_CHUNKS_CAPABILITY) return this.#options.instanceTransfer !== undefined;
        if (capability === INSTANCE_TRANSFER_FULL_COPY_CAPABILITY) return this.#options.instanceTransfer !== undefined;
        if (capability === LIVE_ACTIVITY_PUSH_CAPABILITY) return this.#options.liveActivityPush !== undefined;
        if (capability === ROUTINE_FLOWS_CAPABILITY) return this.#options.routineFlows !== undefined;
        if (capability === ROUTINE_FLOW_STOP_CAPABILITY) return this.#options.routineFlows !== undefined;
        if (capability === WORKFLOWS_CAPABILITY) return this.#options.workflows !== undefined;
        if (capability === WORKFLOW_FOLDERS_CAPABILITY)
          return this.#options.workflows !== undefined && this.#options.workflowFolders !== undefined;
        if (capability === CRM_CAPABILITY) return this.#options.crm !== undefined;
        if (capability === WORKFLOWS_GITHUB_CAPABILITY) return this.#options.workflows?.github !== undefined;
        if (capability === WORKFLOWS_MEDIA_CAPABILITY) return this.#options.workflows !== undefined;
        if (capability === WORKFLOWS_SUNRA_CAPABILITY) return this.#options.workflows !== undefined;
        if (capability === WORKFLOWS_HIGGSFIELD_CAPABILITY) return this.#options.workflows !== undefined;
        if (capability === WORKFLOWS_MEDIA_CATALOG_CAPABILITY) return this.#options.workflows !== undefined;
        if (capability === WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY) return this.#options.workflows !== undefined;
        if (capability === WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY) return this.#options.workflows !== undefined;
        if (capability === WORKFLOWS_STEP_SETTINGS_CAPABILITY) return this.#options.workflows !== undefined;
        if (capability === WORKFLOWS_PAUSE_CAPABILITY) return this.#options.workflows !== undefined;
        if (capability === WORKFLOWS_CHANNELS_CAPABILITY) return this.#options.workflows !== undefined;
        if (capability === WORKFLOWS_AGENT_FILES_CAPABILITY) return this.#options.workflows !== undefined;
        if (capability === WORKFLOWS_ANSWERS_CAPABILITY) return this.#options.workflows !== undefined;
        if (capability === WORKFLOWS_CHATS_CAPABILITY)
          return this.#options.workflows !== undefined && this.#options.admin?.routineResults !== undefined;
        if (
          capability === PUSH_NOTIFICATIONS_CAPABILITY ||
          capability === ANDROID_PUSH_NOTIFICATIONS_CAPABILITY ||
          capability === PUSH_NOTIFICATION_THREADS_CAPABILITY ||
          capability === COMPUTER_ACTIVITY_CAPABILITY
        )
          return this.#options.pushNotifications !== undefined;
        if (capability === FOCUS_USE_CAPABILITY) return this.#options.focusUse === true;
        if (capability === AGENT_NOTIFICATION_LEVELS_CAPABILITY)
          return this.#options.agentNotificationLevels !== undefined;
        if (capability === SIDEBAR_PINS_CAPABILITY) return this.#options.sidebarPins !== undefined;
        return true;
      },
    );
  }

  #protocolIssue(request: IncomingMessage): TeamProtocolIssue | null {
    if (!this.#options.appVersion) return null;
    const rawProtocol = firstHeaderValue(request.headers[TEAM_PROTOCOL_VERSION_HEADER.toLowerCase()]);
    const clientAppVersion = firstHeaderValue(request.headers[TEAM_APP_VERSION_HEADER.toLowerCase()]);
    const protocol = rawProtocol ? Number(rawProtocol) : null;
    const host = this.#protocolSupport();
    if (!rawProtocol || !clientAppVersion) {
      return {
        status: 426,
        body: {
          error: sourceText("error.team.clientUpdateRequired"),
          code: "client_update_required",
          host,
        },
      };
    }
    if (
      !Number.isSafeInteger(protocol) ||
      protocol === null ||
      protocol < 1 ||
      protocol > 65_535 ||
      clientAppVersion.length > 64
    ) {
      return {
        status: 400,
        body: { error: "Invalid Team API protocol headers.", code: "protocol_error", host },
      };
    }
    if (protocol === TEAM_PROTOCOL_V10 && !requestCapabilityListsV10(request)) {
      return {
        status: 400,
        body: { error: "Invalid Team API protocol headers.", code: "protocol_error", host },
      };
    }
    if (protocol >= TEAM_PROTOCOL_V1 && protocol <= TEAM_PROTOCOL_V10) return null;
    const clientIsOlder = protocol < TEAM_PROTOCOL_V1;
    return {
      status: 426,
      body: {
        error: clientIsOlder
          ? sourceText("error.team.clientUpdateRequired")
          : sourceText("error.team.hostUpdateRequired"),
        code: clientIsOlder ? "client_update_required" : "host_update_required",
        host,
        client: { appVersion: clientAppVersion, protocol },
      },
    };
  }

  #empty(response: ServerResponse, status: number): RouteOutcome {
    response.writeHead(status);
    response.end();
    return "handled";
  }

  #requestContext(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    token: string,
    authenticated: { member: TeamMemberSummary; sessionId: string; sessionExpiresAt: string },
  ): TeamApiRequestContext {
    return {
      request,
      response,
      method: request.method ?? "GET",
      url,
      protocol: requestProtocol(request),
      capabilities: requestCapabilities(request),
      member: authenticated.member,
      token,
      sessionId: authenticated.sessionId,
      sessionExpiresAt: authenticated.sessionExpiresAt,
      agentLevel: (agentId) => this.agentLevel(authenticated.member, agentId),
      json: (status, value) => this.#json(response, status, value),
      empty: (status) => this.#empty(response, status),
    };
  }
}

function pruneSessions(sessions: Map<string, { at: number }>, now: number): void {
  if (sessions.size <= SESSION_USE_LIMIT) return;
  for (const [sessionId, use] of sessions) if (now - use.at > SESSION_USE_MAX_AGE_MS) sessions.delete(sessionId);
}

function unavailableSidebarLayout(): TeamApiSidebarLayout {
  return {
    getSnapshot: () => ({
      revision: 0,
      sections: [],
      order: ["people", "unassigned"],
      agentAssignments: {},
      agentOrder: [],
    }),
    mutate: () =>
      Effect.fail(
        new StoredStateFailure({ cause: new HttpError(503, sourceText("error.team.sidebarLayoutUnavailable")) }),
      ),
    withProfileAssignment: () =>
      Effect.fail(new StoredStateFailure({ cause: new Error(sourceText("error.team.sidebarLayoutUnavailable")) })),
    placeDuplicateAfter: () =>
      Effect.fail(
        new StoredStateFailure({ cause: new HttpError(503, sourceText("error.team.sidebarLayoutUnavailable")) }),
      ),
    removeAgent: () =>
      Effect.succeed({
        revision: 0,
        sections: [],
        order: ["people", "unassigned"],
        agentAssignments: {},
        agentOrder: [],
      }),
    on: () => undefined,
    off: () => undefined,
  };
}

function usageEventForPeer(
  event: AgentEvent | TeamRealtimeEvent,
  capabilities: ReadonlySet<string>,
): AgentEvent | TeamRealtimeEvent | null {
  if (event.type !== "usage-changed" || capabilities.has(TEAM_USAGE_READ_FAILED_CAPABILITY)) return event;
  const usage = usageEventWithoutReadFailed(event.usage);
  return usage === event.usage ? event : usage && { ...event, usage };
}

function eventProtocol(capabilities: ReadonlySet<string>): 1 | 4 | 5 | 6 | 7 | 8 {
  if (capabilities.has(TEAM_OPEN_PROVIDERS_CAPABILITY)) return 8;
  if (capabilities.has(TEAM_PI_MUSE_CAPABILITY)) return 7;
  if (capabilities.has(TEAM_CURSOR_CLINE_CAPABILITY)) return 6;
  return capabilities.has(TEAM_LOCAL_PROVIDERS_CAPABILITY) ? 5 : capabilities.has("opencode") ? 4 : 1;
}

const EVENT_ENCODING_CAPABILITIES = [
  TEAM_REASONING_EFFORTS_CAPABILITY,
  "browser-secret-handoff",
  BROWSER_SIGN_IN_CAPABILITY,
  BROWSER_VAULT_SKIP_CAPABILITY,
  TEAM_CONTEXT_USAGE_CAPABILITY,
  AGENT_BACKGROUND_WORK_CAPABILITY,
  TEAM_USAGE_GROUPS_CAPABILITY,
  TEAM_USAGE_READ_FAILED_CAPABILITY,
  TEAM_USAGE_TERTIARY_CAPABILITY,
  AGENT_PENDING_RUNTIME_CAPABILITY,
  TEAM_UI_BLOCKS_CAPABILITY,
  TEAM_SUBAGENTS_CAPABILITY,
  TEAM_PROMPT_MULTI_SELECT_CAPABILITY,
  TEAM_VIDEO_GENERATION_CAPABILITY,
  TEAM_MEMORY_CHANGES_CAPABILITY,
  TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY,
  TEAM_UI_BLOCK_VAULT_CAPABILITY,
  SKILL_LEARNING_CAPABILITY,
  QUEUE_HOLD_CAPABILITY,
  QUEUE_HOLD_SIGN_IN_CAPABILITY,
];

function eventEncodingKey(capabilities: ReadonlySet<string>, options: { preserveSemanticTags?: boolean }): string {
  let key = `${eventProtocol(capabilities)}:${options.preserveSemanticTags === true}:`;
  for (const capability of EVENT_ENCODING_CAPABILITIES) key += capabilities.has(capability) ? "1" : "0";
  return key;
}

function isLegacyConversationClient(connection: EventClientState): boolean {
  return connection.includeConversationEvents && !connection.capabilities.has("agent-runtime-snapshots");
}

function optionalEventAgentId(event: OptionalTeamEvent): string | null {
  if (event.type === "agent-tasks-changed" || event.type === "agent-task-conversation") return event.snapshot.agentId;
  return "agentId" in event ? event.agentId : null;
}

function eventCapability(event: AgentEvent): TeamCurrentCapability | null {
  if (
    event.type === "channels-changed" ||
    event.type === "channel-memories-changed" ||
    event.type === "channel-routines-changed"
  )
    return "channel-chats-v1";
  if (event.type === "agent-session-settings-changed") return AGENT_SESSION_SETTINGS_CAPABILITY;
  if (event.type === "message-pins-changed") return MESSAGE_PINS_CAPABILITY;
  if (event.type === "hidden-agents-changed") return AGENT_HIDDEN_CAPABILITY;
  if (event.type === "agent-colors-changed") return AGENT_COLORS_CAPABILITY;
  if (event.type === "chat-colors-changed") return CHAT_COLORS_CAPABILITY;
  if (event.type === "agent-access-changed") return AGENT_ACCESS_CAPABILITY;
  if (event.type === "browser-user-control-changed") return BROWSER_USER_CONTROL_CAPABILITY;
  if (event.type === "browser-page-state-changed") return BROWSER_PAGE_STATE_CAPABILITY;
  if (
    event.type === "agent-tasks-changed" ||
    event.type === "agent-task-conversation" ||
    event.type === "agent-task-conversation-delta"
  )
    return AGENT_TASKS_CAPABILITY;
  if (event.type === "skills-changed") return SKILLS_EVENTS_CAPABILITY;
  if (event.type === "routine-flows-changed") return ROUTINE_FLOWS_CAPABILITY;
  if (event.type === "workflows-changed") return WORKFLOWS_CAPABILITY;
  if (event.type === "workflow-folders-changed") return WORKFLOW_FOLDERS_CAPABILITY;
  if (event.type === "crm-changed") return CRM_CAPABILITY;
  if (event.type === "vault-changed") return VAULT_CAPABILITY;
  if (event.type === "browser-profiles-changed") return BROWSER_PROFILES_EVENTS_CAPABILITY;
  if (event.type === "library-folders-changed") return LIBRARY_FOLDERS_EVENTS_CAPABILITY;
  if (event.type === "usage-credits-changed") return USAGE_CREDITS_CAPABILITY;
  if (event.type === "turn-progress") return TEAM_AGENT_ACTIVITY_CAPABILITY;
  if (event.type === "runtime-snapshot") return "agent-runtime-snapshots";
  if (event.type === "sidebar-layout-changed") return "sidebar-layout";
  if (event.type === "browser-changed" || event.type === "browser-control-changed") return "browser-control";
  if (event.type === "conversation-page") return "conversation-pagination";
  return null;
}
