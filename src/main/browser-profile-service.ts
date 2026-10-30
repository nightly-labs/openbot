import { Effect, Schema, Semaphore } from "effect";
// Named browser profiles, and the profile of each agent, as this computer holds them. The local
// window uses this; the agent setting writes through `AgentService.updateAgent`, which closes the
// agent's tabs when its profile changes. A profile name is user data: it is never logged.

import {
  type AgentBrowserProfile,
  type AgentSummary,
  agentBrowserProfile,
  BROWSER_PROFILE_LIMIT,
  type BrowserProfileList,
  type BrowserProfileSummary,
  type BrowserTabProfile,
  type ClearBrowserDataInput,
  nextBrowserProfileHue,
  type UpdateAgentBrowserProfileInput,
  type UpdateBrowserProfileInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentService } from "../backend/agent-service";
import type { BrowserHost } from "../backend/browser-host";
import type { BrowserProfileRecord, BrowserProfileStore } from "../backend/browser-profiles/browser-profile-store";
import { agentBrowserSessionKey, type BrowserTabSession } from "../backend/browser-state";
import { causeHelpers } from "../backend/effect-boundary";
import { AgentNotFoundError } from "./agent-admin-settings";

export interface BrowserProfileServiceDependencies {
  store: Pick<BrowserProfileStore, "list" | "get" | "create" | "rename" | "setHue" | "delete">;
  agents: Pick<AgentService, "listAgents" | "updateAgent">;
  browser: Pick<BrowserHost, "tabIdsInSession" | "listTabSessions" | "close" | "clearTabSession">;
}

export interface BrowserProfileService {
  list(): BrowserProfileList;
  create(name: string): Effect.Effect<BrowserProfileSummary, BrowserProfileFailure>;
  /** Changes the name, the color, or both. Data and tabs stay. */
  update(input: UpdateBrowserProfileInput): Effect.Effect<BrowserProfileSummary, BrowserProfileFailure>;
  /** Closes the tabs of the profile or the agent session, then deletes its cookies, storage and cache. */
  clear(input: ClearBrowserDataInput): Effect.Effect<void, BrowserProfileFailure>;
  /** Moves the agents of the profile to the shared session, closes its tabs and deletes its data. */
  delete(profileId: string): Effect.Effect<void, BrowserProfileFailure>;
  readAgent(agentId: string): AgentBrowserProfile;
  updateAgent(input: UpdateAgentBrowserProfileInput): Effect.Effect<AgentBrowserProfile, BrowserProfileFailure>;
  /** The profile of each open tab that is not in the shared session. */
  tabProfiles(): BrowserTabProfile[];
}

export function createBrowserProfileService({
  store,
  agents,
  browser,
}: BrowserProfileServiceDependencies): BrowserProfileService {
  function requireAgent(agentId: string): AgentSummary {
    const agent = agents.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new AgentNotFoundError(sourceText("error.team.agentNotFound"));
    return agent;
  }
  function requireProfile(profileId: string): BrowserProfileRecord {
    const profile = store.get(profileId);
    if (!profile) throw new BrowserProfileRejectedError(sourceText("error.backend.browserProfileNotFound"));
    return profile;
  }
  function requireFreeName(name: string, profileId?: string): void {
    const taken = store
      .list()
      .some(
        (profile) =>
          profile.id !== profileId && profile.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0,
      );
    if (taken) throw new BrowserProfileRejectedError(sourceText("error.backend.browserProfileNameTaken"));
  }
  function summary(
    profile: BrowserProfileRecord,
    agentList: readonly AgentSummary[] = agents.listAgents(),
  ): BrowserProfileSummary {
    return {
      id: profile.id,
      name: profile.name,
      hue: profile.hue,
      agentIds: agentList.filter((agent) => agent.browserProfileId === profile.id).map((agent) => agent.id),
      tabCount: browser.tabIdsInSession({ kind: "profile", profileId: profile.id }).length,
    };
  }
  // One change at a time, so an agent cannot move into a profile while a delete moves its agents out.
  const changes = Semaphore.makeUnsafe(1);
  const serialized = <A>(change: Effect.Effect<A, BrowserProfileFailure>) =>
    changes.withPermits(1)(change).pipe(Effect.uninterruptible);
  const check = <T>(run: () => T) => Effect.try({ try: run, catch: (cause) => new BrowserProfileFailure({ cause }) });

  const closeAndClear = Effect.fn("BrowserProfiles.closeAndClear")(function* (tabSession: BrowserTabSession) {
    for (const tabId of browser.tabIdsInSession(tabSession)) yield* browser.close(tabId).pipe(toBrowserProfileFailure);
    yield* browser.clearTabSession(tabSession).pipe(toBrowserProfileFailure);
  });

  const create = Effect.fn("BrowserProfiles.create")(function* (name: string) {
    return yield* check(() => {
      const profiles = store.list();
      if (profiles.length >= BROWSER_PROFILE_LIMIT)
        throw new BrowserProfileRejectedError(
          sourceText("error.backend.browserProfileLimit", { limit: BROWSER_PROFILE_LIMIT }),
        );
      requireFreeName(name);
      return summary(store.create(name, nextBrowserProfileHue(profiles.map((profile) => profile.hue))));
    });
  });

  const update = Effect.fn("BrowserProfiles.update")(function* ({ profileId, name, hue }: UpdateBrowserProfileInput) {
    return yield* check(() => {
      const profile = requireProfile(profileId);
      if (name !== undefined) {
        requireFreeName(name, profileId);
        store.rename(profileId, name);
      }
      if (hue !== undefined) store.setHue(profileId, hue);
      return summary({ ...profile, name: name ?? profile.name, hue: hue ?? profile.hue });
    });
  });

  const clear = Effect.fn("BrowserProfiles.clear")(function* (input: ClearBrowserDataInput) {
    const tabSession = yield* check((): BrowserTabSession => {
      if ("profileId" in input) {
        requireProfile(input.profileId);
        return { kind: "profile", profileId: input.profileId };
      }
      requireAgent(input.agentId);
      return { kind: "agent", key: agentBrowserSessionKey(input.agentId) };
    });
    yield* closeAndClear(tabSession);
  });

  const remove = Effect.fn("BrowserProfiles.delete")(function* (profileId: string) {
    yield* check(() => requireProfile(profileId));
    // The agents move first, so none of them opens a new tab in the profile while it goes.
    for (const agent of agents.listAgents().filter((candidate) => candidate.browserProfileId === profileId))
      yield* agents.updateAgent({ agentId: agent.id, ownBrowserSession: false }).pipe(toBrowserProfileFailure);
    yield* closeAndClear({ kind: "profile", profileId });
    yield* check(() => store.delete(profileId));
  });

  const updateAgent = Effect.fn("BrowserProfiles.updateAgent")(function* ({
    agentId,
    profile,
  }: UpdateAgentBrowserProfileInput) {
    yield* check(() => {
      requireAgent(agentId);
      if (profile.kind === "profile") requireProfile(profile.profileId);
    });
    const agent = yield* agents
      .updateAgent(
        profile.kind === "profile"
          ? { agentId, browserProfileId: profile.profileId }
          : { agentId, ownBrowserSession: profile.kind === "agent" },
      )
      .pipe(toBrowserProfileFailure);
    return agentBrowserProfile(agent);
  });

  return {
    list: () => {
      const agentList = agents.listAgents();
      return {
        profiles: store.list().map((profile) => summary(profile, agentList)),
        sharedAgentIds: agentList
          .filter((agent) => agentBrowserProfile(agent).kind === "shared")
          .map((agent) => agent.id),
      };
    },
    create: (name) => serialized(create(name)),
    update: (input) => serialized(update(input)),
    clear: (input) => serialized(clear(input)),
    delete: (profileId) => serialized(remove(profileId)),
    readAgent: (agentId) => agentBrowserProfile(requireAgent(agentId)),
    updateAgent: (input) => serialized(updateAgent(input)),
    tabProfiles: () => {
      const profiles = new Map(store.list().map((profile) => [profile.id, profile]));
      return browser.listTabSessions().flatMap(({ tabId, tabSession }): BrowserTabProfile[] => {
        if (tabSession.kind === "agent") return [{ tabId, name: null, hue: null }];
        const profile = profiles.get(tabSession.profileId);
        return profile === undefined ? [] : [{ tabId, name: profile.name, hue: profile.hue }];
      });
    },
  };
}

/** A change that the person who manages the profiles can correct: its message is catalog text for them. */
export class BrowserProfileRejectedError extends Error {}

class BrowserProfileFailure extends Schema.TaggedError<BrowserProfileFailure>()("BrowserProfileFailure", {
  cause: Schema.Defect(),
}) {}

const { rewrap: toBrowserProfileFailure } = causeHelpers(BrowserProfileFailure);
