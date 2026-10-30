import type { AgentModelId } from "./ipc-agent-identity";
import type { AccountUsageLimit, AgentAuthState } from "./ipc-agent-status";
import type { ExternalDestination } from "./ipc-app-auth";
import { isOneOf, isString } from "./runtime-values";

/**
 * The coding agents OpenBot can drive, and everything about one that is the same wherever it is
 * named. A provider used to be written out by hand about twenty times - five copies of the same
 * literal chain, four renderer lists, a preload destructure that threw on an id it did not know,
 * an analytics regex - so adding one meant finding every copy, and missing one was silent.
 *
 * This is the list. A new provider is one row here plus one driver in
 * `src/backend/provider-drivers.ts`: the row carries the identity, the driver carries the
 * behaviour. Contracts owns the row because it is the only package the renderer, the main process,
 * the backend, the preload bridge, mobile and the account Worker all reach.
 *
 * Deliberately not here: the frozen Team API validators in `team-protocol/v1.ts` and the shipped
 * SQL `CHECK` lists, which are released vocabulary and must never move when this table moves; and
 * the per-provider argv, palette tokens and runtime-lock schemas, which belong to the driver, the
 * stylesheet and the lock file.
 */
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
  "acp",
] as const;
export type AgentProviderId = (typeof AGENT_PROVIDERS)[number];

export function isAgentProvider(value: unknown): value is AgentProviderId {
  return isOneOf(AGENT_PROVIDERS, value);
}

/** The form of every provider id, including one that a newer host adds. */
export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;

declare const FOREIGN_PROVIDER: unique symbol;
/**
 * A provider that a newer host runs and this OpenBot does not know. Only client data holds one: the
 * host's own agents, database and drivers use `AgentProviderId`.
 */
export type ForeignProviderId = string & { readonly [FOREIGN_PROVIDER]: true };
/** The provider of an agent or a model that a client reads from a host. */
export type AgentProviderRef = AgentProviderId | ForeignProviderId;

export function isForeignProviderId(value: unknown): value is ForeignProviderId {
  return isString(value) && PROVIDER_ID_PATTERN.test(value) && !isAgentProvider(value);
}

export function isAgentProviderRef(value: unknown): value is AgentProviderRef {
  return isAgentProvider(value) || isForeignProviderId(value);
}

/** Whether this OpenBot can set up, sign in and pick models for the provider. */
export function isKnownAgentProvider(provider: AgentProviderRef): provider is AgentProviderId {
  return isAgentProvider(provider);
}

/** The provider when this build does not know it, else undefined. */
export function foreignProvider(provider: AgentProviderRef): ForeignProviderId | undefined {
  return isKnownAgentProvider(provider) ? undefined : provider;
}

/**
 * The provider name to put in front of a user. A foreign provider shows the name its host sends,
 * else its id.
 */
export function providerDisplayName(provider: AgentProviderRef, hostLabel?: string): string {
  if (isAgentProvider(provider)) return agentProviderName(provider);
  return hostLabel?.trim() || provider;
}

export interface AgentProviderDescriptor {
  readonly id: AgentProviderId;
  /** The account brand the user recognises. One name per provider, used on every surface. */
  readonly displayName: string;
  /** The command-line tool behind it, named only where the tool itself is the subject. */
  readonly cliName: string;
  /** The single line under the provider name in onboarding and in settings. */
  readonly onboardingDescription: string;
  /** What to tell a user whose provider needs a credential before it can answer. */
  readonly signInMessage: string;
  /** Where "install it yourself" leads. `null` means OpenBot ships the CLI and there is nowhere to go. */
  readonly installGuideLink: ExternalDestination | null;
  /** The model a new agent starts on. A provider lists its own models, so this id can be missing. */
  readonly defaultModel: AgentModelId;
  /**
   * The model-id prefix that identifies this provider in a `bots.json` import, which predates the
   * provider field. `null` means never guessed: a file older than the provider cannot name it.
   */
  readonly legacyModelPrefix: string | null;
  /** The `AgentAuthState` arm this provider reports when it has an account. */
  readonly authKind: AgentAuthState["kind"];
  /** Left-to-right order in the model picker and top-to-bottom in the onboarding list. */
  readonly pickerOrder: number;
  /**
   * The sign-in that this computer's driver runs when the browser callback cannot reach OpenBot.
   * `device`: a device code or a link that the user finishes on any device. `paste`: a code that
   * the user pastes back, which only a computer where `pasteCodeSignInSupported` can run. `null`:
   * none. It mirrors the driver's `codeSignIn` in `src/backend/provider-drivers.ts`; keep the
   * two in step.
   *
   * Declared here rather than beside the backend's sign-in driver because the picker decides
   * whether to offer the second sign-in before it has asked main anything, and a capability the
   * renderer guesses at is a button that fails when it is pressed.
   */
  readonly localCodeSignIn: "device" | "paste" | null;
  /**
   * Where the provider's sign-in page ends. `callback`: the page sends the browser to an address on
   * the computer that started it, so a browser tab elsewhere must paste that address back. `page`:
   * the user finishes on the page and the provider sees it by itself, so any browser can run it.
   */
  readonly signInPageEnd: "callback" | "page";
  /**
   * The workspace skill folders the CLI reads by itself, in its own order. OpenBot writes only
   * `.agents/skills` and `.claude/skills`, so each list names at least one of them.
   * Sources: the Codex "build skills" guide, the Claude Code skills guide, the opencode skills guide
   * and the skill paths in Google's Antigravity ACP server, in the Cursor CLI and in the Cline CLI.
   */
  readonly skillFolders: readonly [string, ...string[]];
  /**
   * How the CLI gets the user's skills in `~/.agents/skills`. `native`: the CLI reads that folder by
   * itself. `plugin`: OpenBot gives the folder to Claude as a session plugin
   * (`claudeHomeSkillPlugin`). `instructions`: the CLI does not read it, so the developer instructions
   * name each skill and its `SKILL.md`. Sources: the strings and docs of the installed Codex, Grok,
   * OpenCode, Cursor, Cline and Pi CLIs; the Antigravity ACP server reads only `$GEMINI_HOME`; Muse
   * and a custom ACP agent are not known to read it.
   */
  readonly homeSkills: "native" | "plugin" | "instructions";
  /**
   * How a Workspace only agent is held to its folders. `tool-sandbox`: the client checks each tool
   * and asks before an edit. `command-sandbox`: the CLI runs each command in a sandbox.
   * `confined-process`: the CLI runs in a sandboxed process of its own (`process-confinement.ts`).
   */
  readonly workspaceEnforcement: "tool-sandbox" | "command-sandbox" | "confined-process";
  /**
   * How the CLI takes a message into a running turn. `native`: it reads the message at its next
   * step (Grok through its `x.ai/interject` ACP extension). `deferred`: the protocol has no steer
   * request (ACP), so the message can wait until the turn ends. Only a `native` provider steers a
   * message sent in `steer` mode; the others queue it.
   */
  readonly steer: "native" | "deferred";
  /**
   * Whether the CLI runs turns of two sessions of one agent at the same time. `false`: the agent runs
   * one turn at a time, so its tasks and its own chat wait for each other. A custom ACP agent is
   * `false`, because OpenBot cannot know what the command does with a second prompt.
   */
  readonly concurrentTurns: boolean;
  /**
   * Whether OpenBot can read the plan's remaining usage. `false`: the CLI exposes no usage reading,
   * so the dock says the provider does not report usage instead of waiting for a reading. Declared
   * here because the renderer cannot see the drivers; set it to `true` with a driver's usage read
   * (Codex and Claude read it themselves, Grok, OpenCode, Antigravity and Cursor through `readRateLimits`).
   */
  readonly reportsUsage: boolean;
  /**
   * Whether an agent outside Workspace only can stop and ask before it acts. `false`: the client
   * allows every tool in full reach (`claude-client.ts` `canUseTool`), so the agent has no "Ask
   * first" level. Each ACP agent sends `session/request_permission` only when its own CLI decides
   * to ask.
   */
  readonly approvalsInFullAccess: boolean;
  /**
   * Whether the added folders apply in Full access too. `true`: the CLI's own file tools reach only
   * the workspace, the shared folder and the added folders in every access level, so the user can add
   * folders in Full access. Antigravity 1.4.5 limits them to `cwd` and `additionalDirectories` for
   * every session that is not a Google admin session (#3843).
   */
  readonly foldersInFullAccess: boolean;
}

/**
 * `satisfies Record<AgentProviderId, …>` is the coverage check: an id added to the union without a
 * row here is a `TS2741` naming the id, before anything runs and with no test to keep in step.
 */
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
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "native",
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
    signInPageEnd: "callback",
    skillFolders: [".claude/skills"],
    homeSkills: "plugin",
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
    defaultModel: "grok-4.6",
    legacyModelPrefix: "grok-",
    authKind: "grok",
    pickerOrder: 2,
    localCodeSignIn: "device",
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "native",
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
    // Only reached when a spawn lists no model at all, which is not the keyless free tier: that
    // one works with no credential. So this asks for the optional key instead of a terminal login.
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
    workspaceEnforcement: "confined-process",
    steer: "deferred",
    concurrentTurns: true,
    reportsUsage: true,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  // Google moved Google AI Pro and Ultra accounts from Gemini CLI to Antigravity on 18 June 2026,
  // so the plan runs through Google's Antigravity ACP server. The account and the models are Gemini.
  antigravity: {
    id: "antigravity",
    displayName: "Gemini",
    cliName: "Antigravity ACP server",
    onboardingDescription: "Google AI Pro or Ultra plan",
    signInMessage: "Sign in with Google to use Gemini.",
    installGuideLink: null,
    defaultModel: "",
    legacyModelPrefix: null,
    authKind: "antigravity",
    pickerOrder: 4,
    localCodeSignIn: null,
    signInPageEnd: "callback",
    skillFolders: [".gemini/skills", ".agents/skills"],
    homeSkills: "instructions",
    workspaceEnforcement: "confined-process",
    steer: "deferred",
    concurrentTurns: true,
    reportsUsage: true,
    approvalsInFullAccess: true,
    foldersInFullAccess: true,
  },
  // The Cursor CLI (`cursor-agent acp`) with the user's Cursor plan. Sign-in is the ACP
  // `cursor_login` method, which opens a browser. `CURSOR_API_KEY` in the environment also signs in.
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
    pickerOrder: 5,
    localCodeSignIn: "device",
    signInPageEnd: "callback",
    skillFolders: [".cursor/skills", ".claude/skills", ".agents/skills"],
    homeSkills: "native",
    workspaceEnforcement: "confined-process",
    steer: "deferred",
    concurrentTurns: true,
    reportsUsage: true,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  // The Cline CLI (`cline --acp`). Sign-in is the ACP `cline` method, which opens a browser. A Cline
  // account runs the free models; `CLINE_API_KEY` in the environment also signs in.
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
    pickerOrder: 7,
    localCodeSignIn: null,
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "native",
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
    pickerOrder: 8,
    localCodeSignIn: "device",
    signInPageEnd: "page",
    skillFolders: [".agents/skills"],
    homeSkills: "instructions",
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: true,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  // Inception's Mercury models run in the Pi CLI that OpenBot downloads for Pi, with a key the user
  // saves here. Pi's own sign-in and models stay on the Pi row.
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
    pickerOrder: 9,
    localCodeSignIn: null,
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "native",
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  // DeepSeek's models run in the Pi CLI that OpenBot downloads for Pi, which has a built-in DeepSeek
  // provider. The user saves the key here. Pi's own sign-in and models stay on the Pi row.
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
    pickerOrder: 10,
    localCodeSignIn: null,
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "native",
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  // OpenRouter's models run in the Pi CLI that OpenBot downloads for Pi, which has a built-in OpenRouter
  // provider. The user saves the key here. Pi's own sign-in and models stay on the Pi row.
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
    pickerOrder: 11,
    localCodeSignIn: null,
    signInPageEnd: "callback",
    skillFolders: [".agents/skills"],
    homeSkills: "native",
    workspaceEnforcement: "confined-process",
    steer: "native",
    concurrentTurns: true,
    reportsUsage: false,
    approvalsInFullAccess: true,
    foldersInFullAccess: false,
  },
  // One provider for every Agent Client Protocol agent the user adds by command. The model id names
  // the agent (`<customAgentId>/<agentModel>`), so one provider row serves them all and the shipped
  // provider CHECK lists grow by one word only once.
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
    workspaceEnforcement: "confined-process",
    steer: "deferred",
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

/**
 * Whether the provider can take a queued message into its running turn. A provider that this build
 * does not know can: its host decides, and refuses the message when it cannot.
 */
export function providerSteersTurns(provider: AgentProviderRef): boolean {
  return !isKnownAgentProvider(provider) || agentProviderDescriptor(provider).steer === "native";
}

/** The provider name to put in front of a user. */
export function agentProviderName(provider: AgentProviderId): string {
  return AGENT_PROVIDER_DESCRIPTOR_TABLE[provider].displayName;
}

/** The name of the tool, for copy whose subject is the command line rather than the account. */
export function agentProviderCliName(provider: AgentProviderId): string {
  return AGENT_PROVIDER_DESCRIPTOR_TABLE[provider].cliName;
}

/**
 * Picker and onboarding order, which is not `AGENT_PROVIDERS` order. `acp` is not in it: a custom
 * agent is the user's own command, listed in the picker's Custom tab and never offered as a default.
 */
export const PICKER_PROVIDERS: readonly AgentProviderId[] = AGENT_PROVIDER_DESCRIPTORS.filter(
  (descriptor) => descriptor.id !== "acp",
)
  .sort((left, right) => left.pickerOrder - right.pickerOrder)
  .map((descriptor) => descriptor.id);

/**
 * The providers whose CLI OpenBot downloads and pins itself, as a literal tuple rather than a
 * filter over the descriptors: `ManagedProviderId` is what makes `ProviderRuntimeSnapshot.providers`
 * a total record, so every reader gets a status without a guard, and a managed provider that has no
 * runtime entry is a compile error instead of an empty download card.
 */
export const MANAGED_RUNTIME_PROVIDERS = [
  "codex",
  "claude",
  "grok",
  "opencode",
  "antigravity",
  "cursor",
  "cline",
  "pi",
  "muse",
] as const satisfies readonly AgentProviderId[];
export type ManagedProviderId = (typeof MANAGED_RUNTIME_PROVIDERS)[number];

export function isManagedRuntimeProvider(provider: AgentProviderId): provider is ManagedProviderId {
  return isOneOf(MANAGED_RUNTIME_PROVIDERS, provider);
}

/**
 * The providers that only newer Team API protocols carry: Gemini and custom ACP agents from protocol
 * 5, Cursor and Cline from protocol 6, Pi and Muse from protocol 7, Inception, DeepSeek and OpenRouter
 * from protocol 8.
 * A joined server's settings list one only when the host's status names it.
 */
export const LOCAL_ONLY_PROVIDERS = [
  "antigravity",
  "cursor",
  "cline",
  "pi",
  "muse",
  "inception",
  "deepseek",
  "openrouter",
  "acp",
] as const satisfies readonly AgentProviderId[];

export function isLocalOnlyProvider(provider: AgentProviderId): boolean {
  return isOneOf(LOCAL_ONLY_PROVIDERS, provider);
}

/**
 * The providers that sign in only with an API key that the user saves in OpenBot. They run in the Pi
 * CLI, so their Connect and Reconnect open the key dialog.
 */
export const KEY_ONLY_PROVIDERS = ["inception", "deepseek", "openrouter"] as const satisfies readonly AgentProviderId[];
export type KeyOnlyProviderId = (typeof KEY_ONLY_PROVIDERS)[number];

export function isKeyOnlyProvider(provider: AgentProviderRef): provider is KeyOnlyProviderId {
  return isOneOf(KEY_ONLY_PROVIDERS, provider);
}

/**
 * Whether a computer on `platform` can run a sign-in whose code the user pastes back (Claude). The
 * CLI shows its prompt only on a terminal, and only the util-linux `script` gives it one there: see
 * the backend `startCliCodeLogin`.
 */
export function pasteCodeSignInSupported(platform: string): boolean {
  return platform === "linux";
}

/**
 * A custom agent id: the first segment of its model ids. No `_`, which `isAgentModel` refuses, and
 * no `/`, which separates the agent from its model.
 */
export const CUSTOM_AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * The ids no custom agent could have when custom agents shipped: a provider id or `custom` would read
 * as another provider's model. Frozen: a provider added later is refused only for a new agent
 * (`isNewCustomAgentId`), so an agent saved under that name before the upgrade stays readable,
 * routable and removable.
 */
const AGENT_IDS_RESERVED_AT_RELEASE = ["codex", "claude", "grok", "opencode", "antigravity", "acp", "custom"] as const;

/** A saved custom agent id: what the list decoders, a delete and the model router accept. */
export function isCustomAgentId(value: string): boolean {
  return CUSTOM_AGENT_ID_PATTERN.test(value) && !isOneOf(AGENT_IDS_RESERVED_AT_RELEASE, value);
}

/** The id of an agent to save or of a found agent. It must not be the name of a built-in provider. */
export function isNewCustomAgentId(value: string): boolean {
  return isCustomAgentId(value) && !isAgentProvider(value);
}

/** The model a custom agent with no model list runs on. The agent is given no model. */
export const CUSTOM_AGENT_DEFAULT_MODEL = "default";

/** The custom agent a model id belongs to, or null for an id with no agent segment. */
export function customAgentIdOfModel(model: string): string | null {
  const slash = model.indexOf("/");
  if (slash <= 0) return null;
  const id = model.slice(0, slash);
  return isCustomAgentId(id) ? id : null;
}

/**
 * The tools OpenBot downloads for the MCP servers rather than for an agent: a JavaScript runtime,
 * so that `npx some-server` starts on a machine that has never had Node.
 *
 * A separate id space, not a fifth managed provider. `ManagedProviderId` is what makes
 * `ProviderRuntimeSnapshot.providers` a total record of provider CLIs, and every renderer reader
 * iterates it to draw a provider card; a tool runtime in that tuple would become a provider
 * everywhere, from the picker to the model list.
 */
export const MANAGED_TOOL_RUNTIMES = ["bun"] as const;
export type ManagedToolRuntimeId = (typeof MANAGED_TOOL_RUNTIMES)[number];

/** Everything the runtime manager downloads, pins and verifies, whoever ends up running it. */
export type ManagedRuntimeId = ManagedProviderId | ManagedToolRuntimeId;

export function isManagedToolRuntime(id: string): id is ManagedToolRuntimeId {
  return isOneOf(MANAGED_TOOL_RUNTIMES, id);
}

/**
 * Whether an OpenCode model's display name marks it as one the free tier covers.
 *
 * OpenCode states the price in the name and nowhere else: `model/list` carries no price field, and
 * neither OpenCode endpoint authenticates, so this trailing word is the only thing that
 * separates a model any user can run from one that bills. The picker labels a model with it and the
 * catalog order picks the default from it, and those two have to agree -- a "Free" badge on a model
 * OpenBot would never default to, or a default that quietly bills, is the same bug twice.
 *
 * Only a trailing word counts. Anything looser would catch a model named for something else that
 * happens to contain "free".
 */
export function isFreeOpencodeModelName(name: string): boolean {
  return /\bfree$/i.test(name.trim());
}

/**
 * Free OpenCode models whose ids carry no Free marker.
 *
 * Keyless `opencode models` lists exactly these plus the `*-free` family -- re-run it with a clean
 * home directory if the free tier changes shape. Explicit on purpose: a stale entry hides a free
 * model, while guessing billed models as free bills the user. Every free decision -- the picker
 * badge, the catalog order, the stored-key drop -- goes through `isFreeOpencodeModel`, so the
 * three cannot disagree about what costs money.
 */
const FREE_TIER_MODEL_IDS = new Set(["opencode/big-pickle"]);

export function isFreeOpencodeModel(id: string, name: string): boolean {
  return FREE_TIER_MODEL_IDS.has(id.trim().toLowerCase()) || isFreeOpencodeModelName(name);
}

/**
 * Whether the provider's account quota limits this model. OpenCode reports only the Go quota, and
 * OpenCode also runs free, custom and own-sign-in models that the Go quota does not limit.
 * Antigravity's own reading is a Gemini quota group; its Claude and GPT models share another group,
 * which only the named groups (`usageGroupForModel`) show. Gemini model ids can be code names, so only
 * a Claude or GPT id is left out.
 */
export function accountUsageCoversModel(provider: AgentProviderId, model: string | null | undefined): boolean {
  if (provider === "opencode") return Boolean(model?.toLowerCase().startsWith("opencode-go/"));
  if (provider === "antigravity") return !/^(?:claude|gpt)/iu.test(model ?? "");
  return true;
}

/**
 * The windows that limit the model: the quota group that lists it when the reading lists the models
 * of its groups, or else the reading itself. Undefined when no group lists the model.
 */
export function usageQuotaForModel(
  limit: AccountUsageLimit,
  model: string | null | undefined,
): Pick<AccountUsageLimit, "primary" | "secondary"> | undefined {
  return model && limit.groups?.some((group) => group.models.length > 0)
    ? usageGroupForModel(limit.groups, model)
    : limit;
}

/**
 * The quota group that lists the model. Antigravity lists families ("Gemini Flash", "Gemini 4 Argon")
 * and the model ID adds a version and an effort (`gemini-3.8-flash-high`), so each word of a listed
 * name must be a word of the ID. The longest such name wins: "Gemini Flash Lite" before "Gemini Flash".
 */
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
