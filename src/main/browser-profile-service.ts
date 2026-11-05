import { Effect, Schema, Semaphore } from "effect";
// Named browser profiles, and the profile of each agent, as this computer holds them. The local
// window uses this; the agent setting writes through `AgentService.updateAgent`, which closes the
// agent's tabs when its profile changes. A profile name is user data: it is never logged.

import {
  type AgentBrowserProfile,
  type AgentSummary,
  agentBrowserProfile,
  BROWSER_PROFILE_LIMIT,
  BROWSER_PROXY_LIMIT,
  type BrowserProfileList,
  type BrowserProfileSummary,
  type BrowserProxyComputer,
  type BrowserProxyList,
  type BrowserProxySummary,
  type BrowserTabProfile,
  browserProxyAddressText,
  type ClearBrowserDataInput,
  type DeleteBrowserProxyInput,
  nextBrowserProfileHue,
  parseBrowserProxyAddress,
  type SaveBrowserProxyInput,
  type SetBrowserProfileProxyInput,
  type UpdateAgentBrowserProfileInput,
  type UpdateBrowserProfileInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentService } from "../backend/agent-service";
import type { BrowserHost } from "../backend/browser-host";
import type { BrowserProfileRecord, BrowserProfileStore } from "../backend/browser-profiles/browser-profile-store";
import type {
  BrowserProxyAddressRecord,
  BrowserProxyComputerRecord,
  BrowserProxyConnection,
  BrowserProxyRecord,
  BrowserProxyStore,
} from "../backend/browser-profiles/browser-proxy-store";
import { agentBrowserSessionKey, type BrowserTabSession } from "../backend/browser-state";
import { causeHelpers } from "../backend/effect-boundary";
import { AgentNotFoundError } from "./agent-admin-settings";
import type { SecretStorageCipher } from "./secret-storage-cipher";

export interface BrowserProfileServiceDependencies {
  store: Pick<BrowserProfileStore, "list" | "get" | "create" | "rename" | "setHue" | "delete">;
  proxies: Pick<
    BrowserProxyStore,
    | "list"
    | "get"
    | "password"
    | "assignments"
    | "proxyOfProfile"
    | "create"
    | "update"
    | "delete"
    | "assign"
    | "ensureComputer"
  >;
  /** Encrypts a proxy password. The password is never logged and never sent back. */
  cipher: Pick<SecretStorageCipher, "canPersist" | "encrypt">;
  agents: Pick<AgentService, "listAgents" | "updateAgent">;
  browser: Pick<
    BrowserHost,
    | "tabIdsInSession"
    | "listTabSessions"
    | "close"
    | "clearTabSession"
    | "proxyFailure"
    | "forgetProxyFailure"
    | "releaseProfileProxy"
  >;
  /** The name of a member of this server, or null when it is not a member now. Never logged. */
  memberName?: (memberId: string) => string | null;
  /** Whether the computer of a member shares its connection with this server now. */
  computerOnline?: (memberId: string) => boolean;
  /** Runs after each change that succeeds, so every open profile list reads them again. */
  onChanged?: () => void;
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
  /** `memberId` is the member who asks, so the list can mark that member's own computer. */
  listProxies(memberId?: string): BrowserProxyList;
  /** Adds the computer of the member who asks. Its connection is used only while that member shares it. */
  saveOwnComputer(memberId: string): Effect.Effect<BrowserProxyComputer, BrowserProfileFailure>;
  /** Adds a proxy, or changes one and closes the tabs of the profiles that use it. */
  saveProxy(input: SaveBrowserProxyInput): Effect.Effect<BrowserProxySummary, BrowserProfileFailure>;
  /** Moves the profiles of the proxy to the proxy settings of the computer and closes their tabs. */
  deleteProxy(input: DeleteBrowserProxyInput): Effect.Effect<void, BrowserProfileFailure>;
  /** Sets the proxy of one profile, or none, and closes its tabs when it changes. */
  setProfileProxy(input: SetBrowserProfileProxyInput): Effect.Effect<void, BrowserProfileFailure>;
}

/**
 * The proxy of a named profile as the browser connects to it, with the password decrypted, or null
 * for the proxy settings of the computer. It throws when the password cannot be read.
 */
export function browserProxyConnection(
  proxies: Pick<BrowserProxyStore, "proxyOfProfile" | "get" | "password">,
  cipher: Pick<SecretStorageCipher, "decrypt">,
  profileId: string,
): BrowserProxyConnection | null {
  const proxyId = proxies.proxyOfProfile(profileId);
  const proxy = proxyId === undefined ? undefined : proxies.get(proxyId);
  if (proxy === undefined) return null;
  if (proxy.kind === "computer") return { kind: "computer", proxyId: proxy.id, memberId: proxy.memberId };
  const password = proxies.password(proxy.id);
  return {
    kind: "address",
    proxyId: proxy.id,
    scheme: proxy.scheme,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: password === null ? null : cipher.decrypt(Buffer.from(password)),
  };
}

export function createBrowserProfileService({
  store,
  proxies,
  cipher,
  agents,
  browser,
  memberName = () => null,
  computerOnline = () => false,
  onChanged,
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
    changes
      .withPermits(1)(change)
      .pipe(
        Effect.tap(() => Effect.sync(() => onChanged?.())),
        Effect.uninterruptible,
      );
  const check = <T>(run: () => T) => Effect.try({ try: run, catch: (cause) => new BrowserProfileFailure({ cause }) });

  const closeAndClear = Effect.fn("BrowserProfiles.closeAndClear")(function* (tabSession: BrowserTabSession) {
    for (const tabId of browser.tabIdsInSession(tabSession)) yield* browser.close(tabId).pipe(toBrowserProfileFailure);
    yield* browser.clearTabSession(tabSession).pipe(toBrowserProfileFailure);
  });

  function requireProxy(proxyId: string): BrowserProxyRecord {
    const proxy = proxies.get(proxyId);
    if (!proxy) throw new BrowserProfileRejectedError(sourceText("error.backend.browserProxyNotFound"));
    return proxy;
  }
  function profilesOf(proxyId: string, assignments: ReadonlyMap<string, string>): string[] {
    return [...assignments].filter(([, id]) => id === proxyId).map(([profileId]) => profileId);
  }
  function proxySummary(
    proxy: BrowserProxyAddressRecord,
    assignments: ReadonlyMap<string, string> = proxies.assignments(),
  ): BrowserProxySummary {
    return {
      id: proxy.id,
      scheme: proxy.scheme,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      hasPassword: proxy.hasPassword,
      profileIds: profilesOf(proxy.id, assignments),
      failure: browser.proxyFailure(proxy.id),
    };
  }
  function computerSummary(
    proxy: BrowserProxyComputerRecord,
    requester: string | undefined,
    assignments: ReadonlyMap<string, string> = proxies.assignments(),
  ): BrowserProxyComputer {
    return {
      id: proxy.id,
      memberId: proxy.memberId,
      name: memberName(proxy.memberId),
      online: computerOnline(proxy.memberId),
      mine: proxy.memberId === requester,
      profileIds: profilesOf(proxy.id, assignments),
      failure: browser.proxyFailure(proxy.id),
    };
  }
  function requireAddress(proxyId: string): BrowserProxyAddressRecord {
    const proxy = requireProxy(proxyId);
    if (proxy.kind !== "address")
      throw new BrowserProfileRejectedError(sourceText("error.backend.browserProxyNotFound"));
    return proxy;
  }
  const closeProfileTabs = Effect.fn("BrowserProfiles.closeProfileTabs")(function* (profileIds: readonly string[]) {
    for (const profileId of profileIds) {
      for (const tabId of browser.tabIdsInSession({ kind: "profile", profileId }))
        yield* browser.close(tabId).pipe(toBrowserProfileFailure);
      // The relay of the old proxy stops with the tabs, not at the next tab.
      yield* browser.releaseProfileProxy(profileId).pipe(toBrowserProfileFailure);
    }
  });

  const saveProxy = Effect.fn("BrowserProfiles.saveProxy")(function* ({
    proxyId,
    previousAddress,
    keepPassword,
    address,
  }: SaveBrowserProxyInput) {
    const saved = yield* check(() => {
      const parsed = parseBrowserProxyAddress(address);
      if (parsed === null)
        throw new BrowserProfileRejectedError(sourceText("error.backend.browserProxyAddressInvalid"));
      const { scheme, host, port, username, password } = parsed;
      const existing = proxyId === undefined ? undefined : requireAddress(proxyId);
      // A different admin changed the proxy after this one opened it: the save would undo that change.
      if (existing !== undefined && browserProxyAddressText(existing) !== previousAddress)
        throw new BrowserProfileRejectedError(sourceText("error.backend.browserProxyChanged"));
      const all = proxies.list().filter((proxy) => proxy.kind === "address");
      if (existing === undefined && all.length >= BROWSER_PROXY_LIMIT)
        throw new BrowserProfileRejectedError(
          sourceText("error.backend.browserProxyLimit", { limit: BROWSER_PROXY_LIMIT }),
        );
      const taken = all.some(
        (proxy) =>
          proxy.id !== proxyId &&
          proxy.scheme === scheme &&
          proxy.host === host &&
          proxy.port === port &&
          proxy.username === username,
      );
      if (taken) throw new BrowserProfileRejectedError(sourceText("error.backend.browserProxyTaken"));
      if (password !== null && !cipher.canPersist())
        throw new BrowserProfileRejectedError(sourceText("error.app.secretStorageUnavailable"));
      // The edit field shows a mask in place of the saved password; a kept mask keeps the password.
      // A password needs a user name, so an address without one keeps no password.
      const keptPassword =
        existing !== undefined && keepPassword === true && username !== null ? proxies.password(existing.id) : null;
      const row = {
        scheme,
        host,
        port,
        username,
        password: password === null ? keptPassword : cipher.encrypt(password),
      };
      if (existing === undefined) return { id: proxies.create(row), changed: false };
      proxies.update(existing.id, row);
      return { id: existing.id, changed: true };
    });
    if (saved.changed) {
      browser.forgetProxyFailure(saved.id);
      const profileIds = yield* check(() =>
        [...proxies.assignments()].filter(([, id]) => id === saved.id).map(([profileId]) => profileId),
      );
      yield* closeProfileTabs(profileIds);
    }
    return yield* check(() => proxySummary(requireAddress(saved.id)));
  });

  const saveOwnComputer = Effect.fn("BrowserProfiles.saveOwnComputer")(function* (memberId: string) {
    return yield* check(() => {
      const computers = proxies.list().filter((proxy) => proxy.kind === "computer");
      if (!computers.some((proxy) => proxy.memberId === memberId) && computers.length >= BROWSER_PROXY_LIMIT)
        throw new BrowserProfileRejectedError(
          sourceText("error.backend.browserProxyLimit", { limit: BROWSER_PROXY_LIMIT }),
        );
      return computerSummary(proxies.ensureComputer(memberId), memberId);
    });
  });

  const deleteProxy = Effect.fn("BrowserProfiles.deleteProxy")(function* ({
    proxyId,
    profileIds: seen,
  }: DeleteBrowserProxyInput) {
    const profileIds = yield* check(() => {
      requireProxy(proxyId);
      const users = profilesOf(proxyId, proxies.assignments());
      // Its profiles change to Automatic. Only the profiles that the admin saw can change so: a profile
      // that a different admin moved to the proxy since then must not send its pages directly.
      if (users.length !== seen.length || users.some((profileId) => !seen.includes(profileId)))
        throw new BrowserProfileRejectedError(sourceText("error.backend.browserProxyChanged"));
      proxies.delete(proxyId);
      return users;
    });
    browser.forgetProxyFailure(proxyId);
    yield* closeProfileTabs(profileIds);
  });

  const setProfileProxy = Effect.fn("BrowserProfiles.setProfileProxy")(function* ({
    profileId,
    proxyId,
  }: SetBrowserProfileProxyInput) {
    const changed = yield* check(() => {
      requireProfile(profileId);
      if (proxyId !== null) requireProxy(proxyId);
      if ((proxies.proxyOfProfile(profileId) ?? null) === proxyId) return false;
      proxies.assign(profileId, proxyId);
      return true;
    });
    if (changed) yield* closeProfileTabs([profileId]);
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
    listProxies: (memberId) => {
      const assignments = proxies.assignments();
      const all = proxies.list();
      return {
        proxies: all.flatMap((proxy) => (proxy.kind === "address" ? [proxySummary(proxy, assignments)] : [])),
        computers: all.flatMap((proxy) =>
          proxy.kind === "computer" ? [computerSummary(proxy, memberId, assignments)] : [],
        ),
      };
    },
    saveOwnComputer: (memberId) => serialized(saveOwnComputer(memberId)),
    saveProxy: (input) => serialized(saveProxy(input)),
    deleteProxy: (input) => serialized(deleteProxy(input)),
    setProfileProxy: (input) => serialized(setProfileProxy(input)),
  };
}

/** A change that the person who manages the profiles can correct: its message is catalog text for them. */
export class BrowserProfileRejectedError extends Error {}

class BrowserProfileFailure extends Schema.TaggedError<BrowserProfileFailure>()("BrowserProfileFailure", {
  cause: Schema.Defect(),
}) {}

const { rewrap: toBrowserProfileFailure } = causeHelpers(BrowserProfileFailure);
