import type { AgentModelId } from "./ipc-agent-identity";
import type { AgentInstructionFileName } from "./ipc-agent-instructions";
import type { AccountUsageLimit, AgentAuthState } from "./ipc-agent-status";
import type { ExternalDestination } from "./ipc-app-auth";
import { isOneOf, isString } from "./runtime-values";

export const AGENT_PROVIDERS = [
  "codex",
  "claude",
  "grok",
  "opencode",
  "antigravity",
  "cursor",
  "cline",
  "pi",
  "muse",
  "inception",
  "deepseek",
  "openrouter",
  "hermes",
  "acp",
  "kimi",
  "devin",
  "copilot",
  "mistral",
] as const;
export type AgentProviderId = (typeof AGENT_PROVIDERS)[number];

export function isAgentProvider(value: unknown): value is AgentProviderId {
  return isOneOf(AGENT_PROVIDERS, value);
}

export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;

declare const FOREIGN_PROVIDER: unique symbol;
export type ForeignProviderId = string & { readonly [FOREIGN_PROVIDER]: true };
export type AgentProviderRef = AgentProviderId | ForeignProviderId;

export function isForeignProviderId(value: unknown): value is ForeignProviderId {
  return isString(value) && PROVIDER_ID_PATTERN.test(value) && !isAgentProvider(value);
}

export function isAgentProviderRef(value: unknown): value is AgentProviderRef {
  return isAgentProvider(value) || isForeignProviderId(value);
}

export function isKnownAgentProvider(provider: AgentProviderRef): provider is AgentProviderId {
  return isAgentProvider(provider);
}

export const MANAGED_SKILL_FOLDERS = [".agents/skills", ".claude/skills"] as const;

export function foreignProvider(provider: AgentProviderRef): ForeignProviderId | undefined {
  return isKnownAgentProvider(provider) ? undefined : provider;
}

export function providerDisplayName(provider: AgentProviderRef, hostLabel?: string): string {
  if (isAgentProvider(provider)) return agentProviderName(provider);
  return hostLabel?.trim() || provider;
}

export interface AgentProviderDescriptor {
  readonly id: AgentProviderId;
  readonly displayName: string;
  readonly cliName: string;
  readonly onboardingDescription: string;
  readonly signInMessage: string;
  readonly installGuideLink: ExternalDestination | null;
  readonly defaultModel: AgentModelId;
  readonly legacyModelPrefix: string | null;
  readonly authKind: AgentAuthState["kind"];
  readonly pickerOrder: number;
  readonly localCodeSignIn: "device" | "paste" | null;
  readonly windowsCodeSignIn?: "paste";
  readonly accountSignIn?: "key";
  readonly accountCodeSignIn?: "device" | "paste";
  readonly signInPageEnd: "callback" | "page";
  readonly mainlandChinaSignInSite?: string;
  readonly skillFolders: readonly [string, ...string[]];
  readonly homeSkills: "native" | "plugin" | "instructions";
  readonly workspaceInstructionFiles: readonly AgentInstructionFileName[];
  readonly workspaceEnforcement: "tool-sandbox" | "command-sandbox" | "confined-process";
  readonly steer: "native" | "deferred" | "reported";
  readonly concurrentTurns: boolean;
  readonly reportsUsage: boolean;
  readonly approvalsInFullAccess: boolean;
  readonly foldersInFullAccess: boolean;
}

const AGENT_PROVIDER_DESCRIPTOR_TABLE = {
  codex: {
    id: "codex",
    displayName: "ChatGPT",
    cliName: "Codex CLI",
    onboardingDescription: "Included with OpenBot",
    signInMessage: "Connect ChatGPT to continue.",
    installGuideLink: null,
    defaultModel: "gpt-6-luna",
    legacyModelPrefix: null,
    authKind: "chatgpt",
    pickerOrder: 1,
    localCodeSignIn: "device",
    accountCodeSignIn: "device",
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: ["AGENTS.md"],
    workspaceEnforcement: "command-sandbox",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: true,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  claude: {
    id: "claude",
    displayName: "Claude",
    cliName: "Claude Code",
    onboardingDescription: "Included with OpenBot",
    signInMessage: "Connect Claude to continue.",
    installGuideLink: "claude-install",
    defaultModel: "claude-haiku-5-5",
    legacyModelPrefix: "claude-",
    authKind: "claude",
    pickerOrder: 0,
    localCodeSignIn: "paste",
    accountCodeSignIn: "paste",
    signInPageEnd: "callback",
    skillFolders: [".claude/skills"],
    homeSkills: "plugin",
    workspaceInstructionFiles: ["CLAUDE.md"],
    workspaceEnforcement: "tool-sandbox",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: true,
    approvalsInFullAccess: false,
    foldersInFullAccess: false,
  },
  grok: {
    id: "grok",
    displayName: "Grok",
    cliName: "Grok CLI",
    onboardingDescription: "Included with OpenBot",
    signInMessage: "Run `grok login` or set XAI_API_KEY to use Grok.",
    installGuideLink: null,
    defaultModel: "grok-4.7",
    legacyModelPrefix: "grok-",
    authKind: "grok",
    pickerOrder: 2,
    localCodeSignIn: "device",
    accountCodeSignIn: "device",
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: [],
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: true,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  opencode: {
    id: "opencode",
    displayName: "OpenCode",
    cliName: "OpenCode CLI",
    onboardingDescription: "Free models, no account needed",
    signInMessage: "OpenCode listed no model. Add an OpenCode Go key to continue.",
    installGuideLink: null,
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "opencode",
    pickerOrder: 3,
    localCodeSignIn: null,
    signInPageEnd: "callback",
    skillFolders: [".opencode/skills", ".agents/skills", ".claude/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: ["AGENTS.md"],
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: true,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  antigravity: {
    id: "antigravity",
    displayName: "Gemini",
    cliName: "Antigravity CLI",
    onboardingDescription: "Google AI Pro or Ultra plan",
    signInMessage: "Sign in with Google to use Gemini.",
    installGuideLink: null,
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "antigravity",
    pickerOrder: 4,
    localCodeSignIn: null,
    windowsCodeSignIn: "paste",
    signInPageEnd: "callback",
    skillFolders: [".gemini/skills", ".agents/skills"],
    homeSkills: "instructions",
    workspaceInstructionFiles: [],
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: true,
    approvalsInFullAccess: true,
    foldersInFullAccess: true,
  },
  cursor: {
    id: "cursor",
    displayName: "Cursor",
    cliName: "Cursor CLI",
    onboardingDescription: "Cursor plan or API key",
    signInMessage: "Sign in with Cursor or set CURSOR_API_KEY to use Cursor.",
    installGuideLink: null,
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "cursor",
    accountSignIn: "key",
    pickerOrder: 5,
    localCodeSignIn: "device",
    signInPageEnd: "callback",
    skillFolders: [".cursor/skills", ".claude/skills", ".agents/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: ["AGENTS.md", "CLAUDE.md"],
    workspaceEnforcement: "confined-process",
    steer: "deferred",
    concurrentTurns: true,
    reportsUsage: true,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  cline: {
    id: "cline",
    displayName: "Cline",
    cliName: "Cline CLI",
    onboardingDescription: "Free models with a Cline account",
    signInMessage: "Sign in with Cline or set CLINE_API_KEY to use Cline.",
    installGuideLink: null,
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "cline",
    pickerOrder: 6,
    localCodeSignIn: "device",
    signInPageEnd: "callback",
    skillFolders: [".cline/skills", ".clinerules/skills", ".agents/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: ["AGENTS.md"],
    workspaceEnforcement: "confined-process",
    steer: "deferred",
    concurrentTurns: true,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  kimi: {
    id: "kimi",
    displayName: "Kimi",
    cliName: "Kimi Code CLI",
    onboardingDescription: "Kimi models with a Kimi Code account",
    signInMessage: "Sign in with Kimi to use Kimi.",
    installGuideLink: null,
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "kimi",
    pickerOrder: 7,
    localCodeSignIn: "device",
    signInPageEnd: "page",
    mainlandChinaSignInSite: "kimi.com",
    skillFolders: [".kimi/skills", ".claude/skills", ".codex/skills", ".agents/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: ["AGENTS.md"],
    workspaceEnforcement: "confined-process",
    steer: "deferred",
    concurrentTurns: true,
    reportsUsage: true,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  devin: {
    id: "devin",
    displayName: "Devin",
    cliName: "Devin CLI",
    onboardingDescription: "Many models with a Devin account",
    signInMessage: "Sign in with Devin to use Devin.",
    installGuideLink: null,
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "devin",
    pickerOrder: 8,
    localCodeSignIn: null,
    signInPageEnd: "callback",
    skillFolders: [".devin/skills", ".claude/skills", ".agents/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: ["AGENTS.md", "CLAUDE.md"],
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  copilot: {
    id: "copilot",
    displayName: "GitHub Copilot",
    cliName: "GitHub Copilot CLI",
    onboardingDescription: "Many models with a Copilot plan",
    signInMessage: "Sign in with GitHub or set COPILOT_GITHUB_TOKEN to use GitHub Copilot.",
    installGuideLink: null,
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "copilot",
    pickerOrder: 9,
    localCodeSignIn: "device",
    signInPageEnd: "callback",
    skillFolders: [".github/skills", ".agents/skills", ".claude/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: ["AGENTS.md", "CLAUDE.md"],
    workspaceEnforcement: "confined-process",
    steer: "deferred",
    concurrentTurns: true,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  mistral: {
    id: "mistral",
    displayName: "Mistral",
    cliName: "Mistral Vibe",
    onboardingDescription: "Mistral models with a Mistral account",
    signInMessage: "Sign in with Mistral or set MISTRAL_API_KEY to use Mistral.",
    installGuideLink: null,
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "mistral",
    pickerOrder: 10,
    localCodeSignIn: null,
    signInPageEnd: "page",
    skillFolders: [".vibe/skills", ".agents/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: ["AGENTS.md"],
    workspaceEnforcement: "confined-process",
    steer: "deferred",
    concurrentTurns: true,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  pi: {
    id: "pi",
    displayName: "Pi",
    cliName: "Pi CLI",
    onboardingDescription: "Included with OpenBot",
    signInMessage: "Use /login in Pi on the host computer. Close Pi when sign-in is complete.",
    installGuideLink: null,
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "pi",
    pickerOrder: 11,
    localCodeSignIn: null,
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: ["AGENTS.md", "CLAUDE.md"],
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  muse: {
    id: "muse",
    displayName: "Muse",
    cliName: "Muse CLI",
    onboardingDescription: "Included with OpenBot",
    signInMessage: "Sign in to Muse on the host computer to continue.",
    installGuideLink: null,
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "muse",
    pickerOrder: 12,
    localCodeSignIn: "device",
    signInPageEnd: "page",
    skillFolders: [".agents/skills"],
    homeSkills: "instructions",
    workspaceInstructionFiles: ["AGENTS.md"],
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: true,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  inception: {
    id: "inception",
    displayName: "Inception",
    cliName: "Pi CLI",
    onboardingDescription: "Mercury models with an Inception API key",
    signInMessage: "Add an Inception API key to continue.",
    installGuideLink: null,
    defaultModel: "mercury-3",
    legacyModelPrefix: null,
    authKind: "inception",
    pickerOrder: 13,
    localCodeSignIn: null,
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: ["AGENTS.md", "CLAUDE.md"],
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek",
    cliName: "Pi CLI",
    onboardingDescription: "DeepSeek models with a DeepSeek API key",
    signInMessage: "Add a DeepSeek API key to continue.",
    installGuideLink: null,
    defaultModel: "deepseek-v4-pro",
    legacyModelPrefix: null,
    authKind: "deepseek",
    pickerOrder: 14,
    localCodeSignIn: null,
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: ["AGENTS.md", "CLAUDE.md"],
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    cliName: "Pi CLI",
    onboardingDescription: "Many models with an OpenRouter API key",
    signInMessage: "Add an OpenRouter API key to continue.",
    installGuideLink: null,
    defaultModel: "anthropic/claude-sonnet-5.5",
    legacyModelPrefix: null,
    authKind: "openrouter",
    pickerOrder: 15,
    localCodeSignIn: null,
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "native",
    workspaceInstructionFiles: ["AGENTS.md", "CLAUDE.md"],
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  hermes: {
    id: "hermes",
    displayName: "Hermes",
    cliName: "Hermes Agent",
    onboardingDescription: "Nous Portal plan or your Hermes setup",
    signInMessage: "Sign in with Nous Portal or run `hermes setup` to use Hermes.",
    installGuideLink: "hermes-install",
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "hermes",
    pickerOrder: 16,
    localCodeSignIn: "device",
    signInPageEnd: "page",
    skillFolders: [".agents/skills"],
    homeSkills: "instructions",
    workspaceInstructionFiles: ["AGENTS.md"],
    workspaceEnforcement: "confined-process",
    steer: "deferred",
    concurrentTurns: true,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  acp: {
    id: "acp",
    displayName: "Custom agent",
    cliName: "ACP agent",
    onboardingDescription: "An agent you run by command",
    signInMessage: "Sign in with the agent's own command, then try again.",
    installGuideLink: null,
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "acp",
    pickerOrder: 7,
    localCodeSignIn: null,
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "instructions",
    workspaceInstructionFiles: [],
    workspaceEnforcement: "confined-process",
    steer: "reported",
    concurrentTurns: false,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
} as const satisfies Record<AgentProviderId, AgentProviderDescriptor>;

export const AGENT_PROVIDER_DESCRIPTORS: readonly AgentProviderDescriptor[] = AGENT_PROVIDERS.map(
  (provider) => AGENT_PROVIDER_DESCRIPTOR_TABLE[provider],
);

export function agentProviderDescriptor(provider: AgentProviderId): AgentProviderDescriptor {
  return AGENT_PROVIDER_DESCRIPTOR_TABLE[provider];
}

export function providerSteersTurns(provider: AgentProviderRef): boolean {
  return !isKnownAgentProvider(provider) || agentProviderDescriptor(provider).steer === "native";
}

export function agentSteersTurns(
  runtime: { provider: AgentProviderRef; model: string },
  models: readonly { provider: string; id: string; steersTurns?: boolean | undefined }[],
): boolean {
  if (!isKnownAgentProvider(runtime.provider) || agentProviderDescriptor(runtime.provider).steer !== "reported")
    return providerSteersTurns(runtime.provider);
  const agentId = customAgentIdOfModel(runtime.model);
  return models.some(
    (model) =>
      model.provider === runtime.provider &&
      model.steersTurns === true &&
      (agentId === null ? model.id === runtime.model : customAgentIdOfModel(model.id) === agentId),
  );
}

export function agentProviderName(provider: AgentProviderId): string {
  return AGENT_PROVIDER_DESCRIPTOR_TABLE[provider].displayName;
}

export function agentProviderCliName(provider: AgentProviderId): string {
  return AGENT_PROVIDER_DESCRIPTOR_TABLE[provider].cliName;
}

export const PICKER_PROVIDERS: readonly AgentProviderId[] = AGENT_PROVIDER_DESCRIPTORS.filter(
  (descriptor) => descriptor.id !== "acp",
)
  .sort((left, right) => left.pickerOrder - right.pickerOrder)
  .map((descriptor) => descriptor.id);

export const MANAGED_RUNTIME_PROVIDERS = [
  "codex",
  "claude",
  "grok",
  "opencode",
  "antigravity",
  "cursor",
  "cline",
  "kimi",
  "devin",
  "copilot",
  "mistral",
  "pi",
  "muse",
] as const satisfies readonly AgentProviderId[];
export type ManagedProviderId = (typeof MANAGED_RUNTIME_PROVIDERS)[number];

export function isManagedRuntimeProvider(provider: AgentProviderId): provider is ManagedProviderId {
  return isOneOf(MANAGED_RUNTIME_PROVIDERS, provider);
}

export const LOCAL_ONLY_PROVIDERS = [
  "antigravity",
  "cursor",
  "cline",
  "kimi",
  "devin",
  "copilot",
  "mistral",
  "pi",
  "muse",
  "inception",
  "deepseek",
  "openrouter",
  "hermes",
  "acp",
] as const satisfies readonly AgentProviderId[];

export function isLocalOnlyProvider(provider: AgentProviderId): boolean {
  return isOneOf(LOCAL_ONLY_PROVIDERS, provider);
}

export const KEY_ONLY_PROVIDERS = ["inception", "deepseek", "openrouter"] as const satisfies readonly AgentProviderId[];
export type KeyOnlyProviderId = (typeof KEY_ONLY_PROVIDERS)[number];

export function isKeyOnlyProvider(provider: AgentProviderRef): provider is KeyOnlyProviderId {
  return isOneOf(KEY_ONLY_PROVIDERS, provider);
}

export function pasteCodeSignInSupported(platform: string): boolean {
  return platform === "linux";
}

export const CUSTOM_AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

const AGENT_IDS_RESERVED_AT_RELEASE = ["codex", "claude", "grok", "opencode", "antigravity", "acp", "custom"] as const;

export function isCustomAgentId(value: string): boolean {
  return CUSTOM_AGENT_ID_PATTERN.test(value) && !isOneOf(AGENT_IDS_RESERVED_AT_RELEASE, value);
}

export function isNewCustomAgentId(value: string): boolean {
  return isCustomAgentId(value) && !isAgentProvider(value);
}

export const CUSTOM_AGENT_DEFAULT_MODEL = "default";

export function customAgentIdOfModel(model: string): string | null {
  const slash = model.indexOf("/");
  if (slash <= 0) return null;
  const id = model.slice(0, slash);
  return isCustomAgentId(id) ? id : null;
}

export const INSTALLER_PROVIDERS = ["hermes"] as const satisfies readonly AgentProviderId[];
export type InstallerProviderId = (typeof INSTALLER_PROVIDERS)[number];

export type DownloadableProviderId = ManagedProviderId | InstallerProviderId;

export function isInstallerProvider(provider: AgentProviderId): provider is InstallerProviderId {
  return isOneOf(INSTALLER_PROVIDERS, provider);
}

export function isDownloadableProvider(provider: AgentProviderId): provider is DownloadableProviderId {
  return isManagedRuntimeProvider(provider) || isInstallerProvider(provider);
}

export const MANAGED_TOOL_RUNTIMES = ["bun"] as const;
export type ManagedToolRuntimeId = (typeof MANAGED_TOOL_RUNTIMES)[number];

export type ManagedRuntimeId = ManagedProviderId | ManagedToolRuntimeId;

export function isManagedToolRuntime(id: string): id is ManagedToolRuntimeId {
  return isOneOf(MANAGED_TOOL_RUNTIMES, id);
}

export function isFreeOpencodeModelName(name: string): boolean {
  return /\bfree$/i.test(name.trim());
}

const FREE_TIER_MODEL_IDS = new Set(["opencode/big-pickle"]);

export const OPENCODE_DEFAULT_FREE_MODEL: AgentModelId = "opencode/beam-free";

export const OPENCODE_RECOMMENDED_FREE_MODELS: readonly AgentModelId[] = [
  OPENCODE_DEFAULT_FREE_MODEL,
  "opencode/big-pickle",
  "opencode/glm-5.3-flash-free",
];

export function isFreeOpencodeModel(id: string, name: string): boolean {
  return FREE_TIER_MODEL_IDS.has(id.trim().toLowerCase()) || isFreeOpencodeModelName(name);
}

export function accountUsageCoversModel(provider: AgentProviderId, model: string | null | undefined): boolean {
  if (provider === "opencode") return Boolean(model?.toLowerCase().startsWith("opencode-go/"));
  if (provider === "antigravity") return !/^(?:claude|gpt)/iu.test(model ?? "");
  return true;
}

export function usageQuotaForModel(
  limit: AccountUsageLimit,
  model: string | null | undefined,
): Pick<AccountUsageLimit, "primary" | "secondary"> | undefined {
  return model && limit.groups?.some((group) => group.models.length > 0)
    ? usageGroupForModel(limit.groups, model)
    : limit;
}

export function usageGroupForModel<Group extends { models: readonly string[] }>(
  groups: readonly Group[],
  model: string,
): Group | undefined {
  const id = new Set(modelWords(model));
  let best: { group: Group; length: number } | undefined;
  for (const group of groups)
    for (const listed of group.models) {
      const words = modelWords(listed);
      if (words.length > (best?.length ?? 0) && words.every((word) => id.has(word)))
        best = { group, length: words.length };
    }
  return best?.group;
}

function modelWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.]+/u)
    .filter(Boolean);
}
