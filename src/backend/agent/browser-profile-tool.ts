import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentBrowserProfile,
  type AgentSummary,
  agentBrowserProfile,
  BROWSER_PROFILE_LIMIT,
  BROWSER_PROFILE_NAME_MAX,
  sameAgentBrowserProfile,
  type UpdateAgentBrowserProfileInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { z } from "zod";
import type { DynamicToolCallParams } from "../protocol";
import { profileToolErrorMessage } from "./profile-tools";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "./routine-tools";
import { ToolOperationFailed, toToolOperationFailed } from "./tool-operation";

const logger = createOpenBotLogger("browser-profile-tool");

/**
 * The named browser profiles of this computer, as the profile service in the main process holds
 * them. Its checks and its order of changes apply to a tool change too.
 */
export interface AgentBrowserProfiles {
  list(): { readonly profiles: readonly { readonly id: string; readonly name: string }[] };
  create(name: string): Effect.Effect<{ readonly id: string }, { readonly cause: unknown }>;
  updateAgent(input: UpdateAgentBrowserProfileInput): Effect.Effect<AgentBrowserProfile, { readonly cause: unknown }>;
}

/** One `set_browser_profile` call reaches at most this many agents. */
const SET_BROWSER_PROFILE_AGENTS_LIMIT = 100;

export const setBrowserProfileToolSchema = z.strictObject({
  agentIds: z
    .array(z.string().trim().min(1).max(INPUT_LIMITS.identifier))
    .min(1)
    .max(SET_BROWSER_PROFILE_AGENTS_LIMIT)
    .refine((ids) => new Set(ids).size === ids.length, "Pass each agent id once.")
    .describe("Ids from list_agents. Include yours to move yourself."),
  profile: z
    .enum(["shared", "own", "named"])
    .describe('"shared": of all agents with no other. "own": one for each agent. "named": the one in name.'),
  name: z
    .string()
    .trim()
    .min(1)
    .max(BROWSER_PROFILE_NAME_MAX)
    .optional()
    .describe("Only with named. A new name makes an empty profile."),
});

/** The browser profile of an agent as `read_agent` shows it. A profile name is user data. */
export function agentBrowserProfileView(
  agent: AgentSummary,
  profiles: readonly { readonly id: string; readonly name: string }[],
): { kind: "shared" } | { kind: "own" } | { kind: "named"; name: string } | { kind: "deleted" } {
  const profile = agentBrowserProfile(agent);
  if (profile.kind === "shared") return { kind: "shared" };
  if (profile.kind === "agent") return { kind: "own" };
  const named = profiles.find((candidate) => candidate.id === profile.profileId);
  return named ? { kind: "named", name: named.name } : { kind: "deleted" };
}

/** The same comparison as the profile service, so a name that differs only in case finds the profile. */
function sameName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

type Target =
  | { kind: "shared" | "own" }
  | { kind: "named"; profileId: string; name: string }
  | { kind: "new"; name: string };

function namedTarget(name: string, profiles: readonly { id: string; name: string }[]): Target {
  const named = profiles.find((candidate) => sameName(candidate.name, name));
  return named ? { kind: "named", profileId: named.id, name: named.name } : { kind: "new", name };
}

function approvalReason(target: Target, agents: string): string {
  switch (target.kind) {
    case "shared":
      return sourceText("status.agent.browserProfileShared", { agents });
    case "own":
      return sourceText("status.agent.browserProfileOwn", { agents });
    case "named":
      return sourceText("status.agent.browserProfileNamed", { agents, profile: target.name });
    case "new":
      return sourceText("status.agent.browserProfileNew", { agents, profile: target.name });
  }
}

export interface SetBrowserProfileToolOptions {
  listAgents(): AgentSummary[];
  /** Null where this process holds no browser profiles. */
  profiles: AgentBrowserProfiles | null;
  /** Whether a person's message in the agent's own chat, or a thread they opened, started the turn. */
  requestedByPerson: boolean;
  /** Waits for the owner's answer to a card with this text. */
  approve(reason: string): Effect.Effect<"accept" | "decline" | "cancel" | string, ToolOperationFailed>;
  redactMcp(text: string): string;
}

/**
 * `set_browser_profile`: moves agents to the shared profile, to a profile of their own, or to a named
 * profile, which it makes when no profile has the name. A profile holds sign-ins, so the move gives an
 * agent the accounts of other agents. Only the owner approves it, and only for a person's request.
 */
export const handleSetBrowserProfileTool = Effect.fn("SetBrowserProfileTool.handle")(
  function* (
    params: DynamicToolCallParams,
    options: SetBrowserProfileToolOptions,
  ): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
    const { agentIds, profile, name } = setBrowserProfileToolSchema.parse(params.arguments, { reportInput: true });
    if ((profile === "named") !== (name !== undefined))
      return openBotToolFailure("Pass name with profile named, and only then.");
    const profiles = options.profiles;
    if (!profiles) return openBotToolFailure("This OpenBot has no browser profiles.");
    // A routine, a channel task, an external chat, another agent or a web page must not move an agent
    // to the sign-ins of another profile.
    if (!options.requestedByPerson)
      return openBotToolFailure(
        "Only a person's message, in your OpenBot chat or a thread they opened, can change a browser profile. Tell the user that they can change it in the agent's settings, Advanced, Browser profile.",
      );
    const agents = options.listAgents();
    const targets = agentIds.map((agentId) => {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error(sourceText("error.agent.unknown", { id: agentId }));
      return agent;
    });
    const named = profiles.list().profiles;
    const target: Target =
      name === undefined ? { kind: profile === "own" ? "own" : "shared" } : namedTarget(name, named);
    // Before the card, so that the owner does not approve a change that cannot happen.
    if (target.kind === "new" && named.length >= BROWSER_PROFILE_LIMIT)
      return openBotToolFailure(sourceText("error.backend.browserProfileLimit", { limit: BROWSER_PROFILE_LIMIT }));
    const wanted = (agent: AgentSummary): boolean => {
      const current = agentBrowserProfile(agent);
      if (target.kind === "new") return true;
      const next: AgentBrowserProfile =
        target.kind === "named"
          ? { kind: "profile", profileId: target.profileId }
          : { kind: target.kind === "own" ? "agent" : "shared" };
      return !sameAgentBrowserProfile(current, next);
    };
    const moving = targets.filter(wanted);
    const unchanged = targets
      .filter((agent) => !moving.includes(agent))
      .map((agent) => ({ agentId: agent.id, ok: true as const, unchanged: true as const }));
    if (moving.length === 0) return openBotToolResult({ status: "unchanged", results: unchanged });

    const decision = yield* options.approve(approvalReason(target, moving.map((agent) => agent.name).join(", ")));
    if (decision === "cancel")
      return openBotToolResult({
        status: "cancelled",
        next: "Nobody answered the card, so no browser profile changed.",
      });
    if (decision !== "accept")
      return openBotToolResult({
        status: "declined",
        next: "The user selected Deny, so no browser profile changed. Do not change it another way, and do not ask again for this request.",
      });

    const profileId =
      target.kind === "new"
        ? (yield* profiles.create(target.name).pipe(toToolOperationFailed)).id
        : target.kind === "named"
          ? target.profileId
          : null;
    const next: AgentBrowserProfile =
      profileId !== null ? { kind: "profile", profileId } : { kind: target.kind === "own" ? "agent" : "shared" };
    const results = yield* Effect.forEach(moving, (agent) =>
      profiles.updateAgent({ agentId: agent.id, profile: next }).pipe(
        Effect.as({ agentId: agent.id, ok: true as const }),
        Effect.catch((failure) =>
          Effect.sync(() => {
            const error = options.redactMcp(profileToolErrorMessage(failure.cause));
            logger.warn("An agent in set_browser_profile was not moved.", { agentId: agent.id, error });
            return { agentId: agent.id, ok: false as const, error };
          }),
        ),
      ),
    );
    const moved = results.filter((result) => result.ok).length;
    return openBotToolResult({
      status: "changed",
      ...(target.kind === "new" ? { created: true } : {}),
      moved,
      failed: results.length - moved,
      results: [...results, ...unchanged],
      next: "The moved agents start with no open tabs. A new profile has no sign-ins: the user signs in once in it, and request_takeover can hand them the page.",
    });
  },
  Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
);
