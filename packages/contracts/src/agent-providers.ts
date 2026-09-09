import type { AgentModelId } from "./ipc-agent-identity";
import type { AgentAuthState } from "./ipc-agent-status";
import type { ExternalDestination } from "./ipc-app-auth";
import { isOneOf } from "./runtime-values";

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
export const AGENT_PROVIDERS = ["codex", "claude", "grok"] as const;
export type AgentProviderId = (typeof AGENT_PROVIDERS)[number];

export function isAgentProvider(value: unknown): value is AgentProviderId {
  return isOneOf(AGENT_PROVIDERS, value);
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
    defaultModel: "gpt-5.6-luna",
    legacyModelPrefix: null,
    authKind: "chatgpt",
    pickerOrder: 1,
  },
  claude: {
    id: "claude",
    displayName: "Claude",
    cliName: "Claude Code",
    onboardingDescription: "Included with OpenBot",
    signInMessage: "Connect Claude to continue.",
    installGuideLink: "claude-install",
    defaultModel: "claude-sonnet-5",
    legacyModelPrefix: "claude-",
    authKind: "claude",
    pickerOrder: 0,
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
  },
} as const satisfies Record<AgentProviderId, AgentProviderDescriptor>;

export const AGENT_PROVIDER_DESCRIPTORS: readonly AgentProviderDescriptor[] = AGENT_PROVIDERS.map(
  (provider) => AGENT_PROVIDER_DESCRIPTOR_TABLE[provider],
);

export function agentProviderDescriptor(provider: AgentProviderId): AgentProviderDescriptor {
  return AGENT_PROVIDER_DESCRIPTOR_TABLE[provider];
}

/** The provider name to put in front of a user. */
export function agentProviderName(provider: AgentProviderId): string {
  return AGENT_PROVIDER_DESCRIPTOR_TABLE[provider].displayName;
}

/** The name of the tool, for copy whose subject is the command line rather than the account. */
export function agentProviderCliName(provider: AgentProviderId): string {
  return AGENT_PROVIDER_DESCRIPTOR_TABLE[provider].cliName;
}

/** Picker and onboarding order, which is not `AGENT_PROVIDERS` order. */
export const PICKER_PROVIDERS: readonly AgentProviderId[] = AGENT_PROVIDER_DESCRIPTORS.slice()
  .sort((left, right) => left.pickerOrder - right.pickerOrder)
  .map((descriptor) => descriptor.id);

/**
 * The providers whose CLI OpenBot downloads and pins itself, as a literal tuple rather than a
 * filter over the descriptors: `ManagedProviderId` is what makes `ProviderRuntimeSnapshot.providers`
 * a total record, so every reader gets a status without a guard, and a managed provider that has no
 * runtime entry is a compile error instead of an empty download card.
 */
export const MANAGED_RUNTIME_PROVIDERS = ["codex", "claude", "grok"] as const satisfies readonly AgentProviderId[];
export type ManagedProviderId = (typeof MANAGED_RUNTIME_PROVIDERS)[number];

export function isManagedRuntimeProvider(provider: AgentProviderId): provider is ManagedProviderId {
  return isOneOf(MANAGED_RUNTIME_PROVIDERS, provider);
}
