import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { avatarFileExtension, isAvatarMimeType, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { type HostKeyHandover, hostKeyHandoverStatement } from "@openbot/contracts/host-key-handover";
import { DEFAULT_TEAM_MEMBER_LIMIT, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { permanentInviteExpiresAt } from "@openbot/contracts/invite-links";
import {
  type AvatarColor,
  type AvatarImageInput,
  type CentralAuthUser,
  isAvatarColor,
  type TeamInviteSummary,
  type TeamMemberSummary,
  type TeamRole,
  type TeamSessionSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type ServerAppearance, serverAppearanceOrNull } from "@openbot/contracts/team-protocol/host-appearance-v1";
import { normalizeEmailAddress, slugifyTeamServerName } from "@openbot/contracts/validation";
import { sourceText } from "@openbot/i18n/source";
import { Context, Deferred, Effect, Layer, Result, Schema } from "effect";
import {
  isEmptyStoredFile,
  parseStoredJson,
  setAsideDamagedFile,
  type WriteJsonFileOptions,
  writeFileAtomically,
} from "../backend/atomic-json-file";
import { RemoteWorkflowError, remoteCall, remoteDecode } from "./remote-service-effects";

class TeamStoreFiles extends Context.Service<
  TeamStoreFiles,
  {
    readText(path: string): Effect.Effect<string, RemoteWorkflowError>;
    mkdir(path: string): Effect.Effect<void, RemoteWorkflowError>;
    copyExclusive(from: string, to: string): Effect.Effect<void, RemoteWorkflowError>;
    remove(path: string): Effect.Effect<void, RemoteWorkflowError>;
    setAside(path: string): Effect.Effect<void>;
    write(
      path: string,
      content: string | Uint8Array,
      options?: WriteJsonFileOptions,
    ): Effect.Effect<void, RemoteWorkflowError>;
  }
>()("openbot/main/TeamStoreFiles") {
  static readonly layer = Layer.succeed(
    TeamStoreFiles,
    TeamStoreFiles.of({
      readText: (path) => remoteCall(() => readFile(path, "utf8")),
      mkdir: (path) => remoteCall(() => mkdir(path, { recursive: true, mode: 0o700 })).pipe(Effect.asVoid),
      copyExclusive: (from, to) => remoteCall(() => copyFile(from, to, constants.COPYFILE_EXCL)),
      remove: (path) => remoteCall(() => rm(path, { force: true })),
      setAside: setAsideDamagedFile,
      write: (path, content, options) =>
        writeFileAtomically(path, content, options).pipe(
          Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
        ),
    }),
  );
}

const scrypt = promisify(scryptCallback);
export const TEAM_STORE_FILE = "openbot-team-server-v2.json";
export const LEGACY_TEAM_STORE_FILE = "openbot-team-server-v1.json";
const INVITE_TTL_MS = 24 * 60 * 60 * 1_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export class TeamStoreError extends Schema.TaggedError<TeamStoreError>()("TeamStoreError", { message: Schema.String }) {
  constructor(message = "") {
    super({ message });
  }
}

interface StoredMember extends TeamMemberSummary {
  accountId?: string;
  passwordSalt?: string;
  passwordHash?: string;
}

interface StoredInvite {
  id: string;
  tokenHash: string;
  role: Exclude<TeamRole, "owner">;
  expiresAt: string;
  usedAt: string | null;
  email?: string | null;
  permanent?: boolean;
  useCount?: number;
}

interface StoredSession {
  id: string;
  memberId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

interface StoredTeam {
  version: 1;
  serverId: string;
  serverName: string;
  enabledOnLaunch: boolean;
  publicKey: string;
  privateKey: string;
  serverLogo?:
    | {
        version: string;
        mimeType: AvatarImageInput["mimeType"];
      }
    | undefined;
  serverAppearance?: ServerAppearance | undefined;
  members: StoredMember[];
  invites: StoredInvite[];
  sessions: StoredSession[];
  pendingKeyRotation?: StoredKeyRotation | undefined;
}

interface StoredKeyRotation {
  publicKey: string;
  privateKey: string;
  handover: HostKeyHandover;
}

interface StoredTeamFile {
  version: 2;
  activeAccountId: string | null;
  hosts: StoredTeam[];
  legacyImport?: { fingerprint: string; record: StoredTeam };
  replacedHosts?: StoredTeam[];
}

export interface TeamIdentity {
  serverId: string;
  serverName: string;
  fingerprint: string;
  publicKey: string;
  enabledOnLaunch: boolean;
  logoVersion: string | null;
  appearance: ServerAppearance | null;
}

export interface CreatedInvite {
  id: string;
  role: Exclude<TeamRole, "owner">;
  token: string;
  expiresAt: string;
  email: string | null;
  permanent: boolean;
  useCount: number;
}

export interface TeamInvitePreview {
  role: Exclude<TeamRole, "owner">;
  expiresAt: string;
  emailBound: boolean;
  permanent: boolean;
}

export interface AuthenticatedMember {
  member: TeamMemberSummary;
  sessionToken: string;
  sessionExpiresAt: string;
}

export interface RemoteDirectoryMember {
  membershipId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  chatColor?: AvatarColor | null;
  role: TeamRole;
  status: "active" | "revoked";
  createdAt: number;
}

export class TeamStore {
  readonly #path: string;
  readonly #legacyPath: string | null;
  readonly #logoRoot: string;
  readonly #legacyLogoRoot: string | null;
  #file: StoredTeamFile = { version: 2, activeAccountId: null, hosts: [] };
  #state: StoredTeam | null = null;
  readonly #remoteSessions = new Map<
    string,
    { member: TeamMemberSummary; sessionId: string; createdAt: string; sessionExpiresAt: string }
  >();
  #writeChain: Deferred.Deferred<void> | null = null;
  #unreadableFile = false;
  #readOnly = false;

  constructor(path: string, legacyPath: string | null = null) {
    this.#path = path;
    this.#legacyPath = legacyPath;
    this.#logoRoot = join(dirname(path), `${basename(path)}.assets`, "logo");
    this.#legacyLogoRoot = legacyPath ? join(dirname(legacyPath), `${basename(legacyPath)}.assets`, "logo") : null;
  }

  readonly loadReadOnly = Effect.fn("TeamStore.loadReadOnly")(function* (
    this: TeamStore,
  ): Effect.fn.Return<void, never, TeamStoreFiles> {
    this.#readOnly = true;
    const contents = yield* TeamStoreFiles.use((files) => files.readText(this.#path)).pipe(
      Effect.orElseSucceed(() => null),
    );
    if (contents === null || isEmptyStoredFile(contents)) return;
    let parsed: StoredTeamFile | null = null;
    try {
      parsed = parseStoredJson(this.#path, contents, (value) => (isStoredTeamFile(value) ? value : null));
    } catch {
      return;
    }
    if (!parsed) return;
    this.#file = parsed;
    const activeAccountId = parsed.activeAccountId;
    this.#state =
      (activeAccountId === null
        ? parsed.hosts.find((host) => ownerAccountId(host) === null)
        : parsed.hosts.find((host) => ownerAccountId(host) === activeAccountId)) ?? null;
  }, Effect.provide(TeamStoreFiles.layer)).bind(this);

  readonly initialize = Effect.fn("TeamStore.initialize")(
    function* (this: TeamStore): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
      let migrated = false;
      let found = false;
      const attempt0 = yield* Effect.gen({ self: this }, function* () {
        const contents = yield* TeamStoreFiles.use((files) => files.readText(this.#path));
        if (isEmptyStoredFile(contents)) return yield* TeamStoreFiles.use((files) => files.setAside(this.#path));
        const parsed = yield* remoteDecode(() =>
          parseStoredJson(this.#path, contents, (value) =>
            isStoredTeamFile(value) || isStoredTeam(value) ? value : null,
          ),
        );
        found = true;
        if (isStoredTeamFile(parsed)) {
          this.#file = parsed;
        } else if (isStoredTeam(parsed)) {
          this.#file = { version: 2, activeAccountId: ownerAccountId(parsed), hosts: [parsed] };
          migrated = true;
        } else {
          this.#unreadableFile = true;
        }
      }).pipe(Effect.result);
      if (Result.isFailure(attempt0)) {
        const error = attempt0.failure.cause;
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
          return yield* new RemoteWorkflowError({ cause: error });
      }
      const legacy = this.#unreadableFile ? null : yield* this.#readLegacyRecordEffect();
      if (legacy && !found) {
        this.#file = {
          version: 2,
          activeAccountId: ownerAccountId(legacy.record),
          hosts: [legacy.record],
          legacyImport: { fingerprint: legacy.fingerprint, record: structuredClone(legacy.record) },
        };
        migrated = true;
      } else if (legacy && legacy.fingerprint !== this.#file.legacyImport?.fingerprint) {
        const baseline = this.#file.legacyImport?.record;
        const index = this.#file.hosts.findIndex((host) => host.serverId === legacy.record.serverId);
        const mine = index < 0 ? undefined : this.#file.hosts[index];
        if (mine && baseline && baseline.serverId === legacy.record.serverId) {
          this.#file.hosts[index] = reconcileHost(baseline, mine, legacy.record);
        } else if (mine) {
          this.#file.replacedHosts = [legacy.record];
        } else {
          this.#file.hosts.push(legacy.record);
        }
        this.#file.legacyImport = { fingerprint: legacy.fingerprint, record: structuredClone(legacy.record) };
        migrated = true;
      }
      const imported = this.#file.legacyImport?.record.serverId;
      const importedHost = imported === undefined ? undefined : this.#file.hosts.find((h) => h.serverId === imported);
      if (importedHost) yield* this.#adoptLegacyLogoEffect(importedHost);
      const activeAccountId = this.#file.activeAccountId;
      this.#state =
        (activeAccountId === null
          ? // A host that predates accounts, or one upgraded from a file where the owner
            this.#file.hosts.find((host) => ownerAccountId(host) === null)
          : this.#file.hosts.find((host) => ownerAccountId(host) === activeAccountId)) ?? null;
      if (migrated) yield* this.#persistFileEffect();
      if (this.#state) yield* this.#pruneEffect();
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly activateAccount = Effect.fn("TeamStore.activateAccount")(
    function* (this: TeamStore, user: CentralAuthUser): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
      const email = yield* remoteDecode(() => normalizeEmail(user.email));
      const hosts = this.#file.hosts;
      const unbound = hosts.find((host) => {
        const owner = hostOwner(host);
        return owner !== undefined && !owner.accountId && !owner.email;
      });
      const rollback = structuredClone(this.#file);
      this.#state =
        hosts.find((host) => ownerAccountId(host) === user.id) ??
        hosts.find((host) => {
          const owner = hostOwner(host);
          if (!owner || owner.accountId) return false;
          return owner.email ? normalizeEmail(owner.email) === email : false;
        }) ??
        unbound ??
        null;
      this.#file.activeAccountId = user.id;
      if (this.#state && this.#state === unbound) {
        const owner = hostOwner(this.#state);
        if (owner) {
          owner.accountId = user.id;
          owner.email = email;
        }
      }
      if (this.#state) {
        yield* remoteDecode(() => this.#applyAccount(user));
        this.#dropExpired(this.#state);
      }
      return yield* Effect.gen({ self: this }, function* () {
        yield* this.#recordActiveAccountEffect();
      }).pipe(
        Effect.catch(({ cause: error }) =>
          Effect.gen({ self: this }, function* () {
            this.#file = rollback;
            this.#state = null;
            return yield* new RemoteWorkflowError({ cause: error });
          }),
        ),
      );
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  unbindActiveHost(): void {
    this.#state = null;
  }

  readonly deactivate = Effect.fn("TeamStore.deactivate")(
    function* (this: TeamStore): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
      const previousState = this.#state;
      const previousAccountId = this.#file.activeAccountId;
      this.#state = null;
      this.#file.activeAccountId = null;
      return yield* Effect.gen({ self: this }, function* () {
        yield* this.#recordActiveAccountEffect();
      }).pipe(
        Effect.catch(({ cause: error }) =>
          Effect.gen({ self: this }, function* () {
            this.#state = previousState;
            this.#file.activeAccountId = previousAccountId;
            return yield* new RemoteWorkflowError({ cause: error });
          }),
        ),
      );
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly #recordActiveAccountEffect = Effect.fn("TeamStore.recordActiveAccount")(function* (
    this: TeamStore,
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
    if (this.#file.hosts.length === 0) return;
    yield* this.#persistFileEffect();
  });

  get configured(): boolean {
    return this.#state !== null;
  }

  getIdentity(): TeamIdentity | null {
    return this.#state ? identityOf(this.#state) : null;
  }

  getOwnerEmail(): string | null {
    return this.#state?.members.find((member) => member.role === "owner")?.email ?? null;
  }

  getOwnerMemberId(): string | null {
    return this.#state?.members.find((member) => member.role === "owner")?.id ?? null;
  }

  getOwnerAnalyticsIdentity(): Pick<CentralAuthUser, "id" | "email"> | null {
    const owner = this.#state?.members.find((member) => member.role === "owner");
    return owner?.accountId && owner.email ? { id: owner.accountId, email: owner.email } : null;
  }

  assertOwnerAccount(user: CentralAuthUser): void {
    const owner = this.#state?.members.find((member) => member.role === "owner");
    if (!owner?.email) {
      throw new TeamStoreError(sourceText("error.team.ownerNotLinked"));
    }
    const matches = owner.accountId
      ? owner.accountId === user.id
      : normalizeEmail(user.email) === normalizeEmail(owner.email);
    if (!matches) {
      throw new TeamStoreError(sourceText("error.team.ownerEmailRequired"));
    }
  }

  getIdentityProof(challenge: string): (TeamIdentity & { challenge: string; signature: string }) | null {
    const identity = this.getIdentity();
    if (!identity || !this.#state || !/^[A-Za-z0-9_-]{16,128}$/.test(challenge)) return null;
    const signature = sign(null, Buffer.from(challenge), this.#state.privateKey).toString("base64url");
    return { ...identity, challenge, signature };
  }

  signRemoteAuthentication(transcript: string): string {
    if (!this.#state) throw new TeamStoreError(sourceText("error.team.hostNotConfigured"));
    return sign(null, Buffer.from(transcript), this.#state.privateKey).toString("base64url");
  }

  readonly configure = Effect.fn("TeamStore.configure")(
    function* (
      this: TeamStore,
      serverName: string,
      username: string,
      password: string,
    ): Effect.fn.Return<TeamIdentity, RemoteWorkflowError, TeamStoreFiles> {
      if (this.#state)
        return yield* new RemoteWorkflowError({
          cause: new TeamStoreError(sourceText("error.team.alreadyConfigured")),
        });
      yield* remoteDecode(() => validateServerName(serverName));
      yield* remoteDecode(() => validateUsername(username));
      yield* remoteDecode(() => validatePassword(password));
      const { publicKey, privateKey } = yield* remoteDecode(() =>
        generateKeyPairSync("ed25519", {
          publicKeyEncoding: { type: "spki", format: "pem" },
          privateKeyEncoding: { type: "pkcs8", format: "pem" },
        }),
      );
      const credentials = yield* hashPasswordEffect(password);
      if (this.#state)
        return yield* new RemoteWorkflowError({
          cause: new TeamStoreError(sourceText("error.team.alreadyConfigured")),
        });
      this.#state = {
        version: 1,
        serverId: randomUUID(),
        serverName: serverName.trim(),
        enabledOnLaunch: false,
        publicKey,
        privateKey,
        members: [
          {
            id: randomUUID(),
            username: username.trim().toLowerCase(),
            email: null,
            name: null,
            avatarUrl: null,
            role: "owner",
            disabled: false,
            createdAt: new Date().toISOString(),
            ...credentials,
          },
        ],
        invites: [],
        sessions: [],
      };
      this.#file.hosts.push(this.#state);
      const attempt3 = yield* Effect.gen({ self: this }, function* () {
        yield* this.#persistFileEffect();
      }).pipe(Effect.result);
      if (Result.isFailure(attempt3)) {
        const error = attempt3.failure.cause;
        this.#file.hosts.pop();
        this.#state = null;
        return yield* new RemoteWorkflowError({ cause: error });
      }
      const identity = this.getIdentity();
      if (!identity)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.team.identityCreateFailed")) });
      return identity;
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly configureWithAccount = Effect.fn("TeamStore.configureWithAccount")(
    function* (
      this: TeamStore,
      serverName: string,
      user: CentralAuthUser,
      logo?: AvatarImageInput | null,
      options: { serverId?: string } = {},
    ): Effect.fn.Return<TeamIdentity, RemoteWorkflowError, TeamStoreFiles> {
      const email = yield* remoteDecode(() => normalizeEmail(user.email));
      yield* remoteDecode(() => this.#assertNoHostFor(user.id, email));
      yield* remoteDecode(() => validateServerName(serverName));
      const activeAccountBefore = this.#file.activeAccountId;
      const { publicKey, privateKey } = yield* remoteDecode(() =>
        generateKeyPairSync("ed25519", {
          publicKeyEncoding: { type: "spki", format: "pem" },
          privateKeyEncoding: { type: "pkcs8", format: "pem" },
        }),
      );
      const serverLogo = logo ? yield* this.#writeLogoEffect(logo) : undefined;
      const attempt5 = yield* Effect.gen({ self: this }, function* () {
        yield* remoteDecode(() => this.#assertNoHostFor(user.id, email));
        if (this.#file.activeAccountId !== activeAccountBefore) {
          return yield* new RemoteWorkflowError({
            cause: new TeamStoreError(sourceText("error.team.accountChangedDuringCreate")),
          });
        }
      }).pipe(Effect.result);
      if (Result.isFailure(attempt5)) {
        const error = attempt5.failure.cause;
        if (serverLogo) yield* this.#removeLogoEffect(serverLogo).pipe(Effect.catch(() => Effect.void));
        return yield* new RemoteWorkflowError({ cause: error });
      }
      const created: StoredTeam = {
        version: 1,
        serverId: options.serverId ?? randomUUID(),
        serverName: serverName.trim(),
        enabledOnLaunch: false,
        publicKey,
        privateKey,
        ...(serverLogo ? { serverLogo } : {}),
        members: [
          {
            id: randomUUID(),
            accountId: user.id,
            username: email,
            email,
            name: yield* remoteDecode(() => normalizeName(user.name)),
            avatarUrl: yield* remoteDecode(() => normalizeAvatarUrl(user.avatarUrl)),
            ...(isAvatarColor(user.chatColor) ? { chatColor: user.chatColor } : {}),
            role: "owner",
            disabled: false,
            createdAt: new Date().toISOString(),
          },
        ],
        invites: [],
        sessions: [],
      };
      this.#file.hosts.push(created);
      const previousState = this.#state;
      const previousAccountId = this.#file.activeAccountId;
      this.#state = created;
      this.#file.activeAccountId = user.id;
      const attempt4 = yield* Effect.gen({ self: this }, function* () {
        yield* this.#persistFileEffect();
      }).pipe(Effect.result);
      if (Result.isFailure(attempt4)) {
        const error = attempt4.failure.cause;
        this.#file.hosts = this.#file.hosts.filter((host) => host !== created);
        if (this.#state === created) {
          this.#state = previousState;
          this.#file.activeAccountId = previousAccountId;
        }
        if (serverLogo) yield* this.#removeLogoEffect(serverLogo).pipe(Effect.catch(() => Effect.void));
        return yield* new RemoteWorkflowError({ cause: error });
      }
      if (this.#state !== created) {
        return yield* new RemoteWorkflowError({
          cause: new TeamStoreError(sourceText("error.team.accountChangedDuringCreate")),
        });
      }
      return identityOf(created);
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly updateIdentity = Effect.fn("TeamStore.updateIdentity")(
    function* (
      this: TeamStore,
      input: { serverName?: string; logo?: AvatarImageInput | null; appearance?: ServerAppearance | null },
    ): Effect.fn.Return<TeamIdentity, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      const serverName = input.serverName;
      if (serverName !== undefined) yield* remoteDecode(() => validateServerName(serverName));
      if (input.serverName === undefined && input.logo === undefined && input.appearance === undefined) {
        const identity = this.getIdentity();
        if (!identity)
          return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.notConfigured")) });
        return identity;
      }

      const previousName = state.serverName;
      const previousLogo = state.serverLogo;
      const previousAppearance = state.serverAppearance;
      const nextLogo =
        input.logo === undefined
          ? previousLogo
          : input.logo === null
            ? undefined
            : yield* this.#writeLogoEffect(input.logo);
      if (this.#state !== state) {
        if (nextLogo && nextLogo.version !== previousLogo?.version) {
          yield* this.#removeLogoEffect(nextLogo).pipe(Effect.catch(() => Effect.void));
        }
        return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.serverNotActive")) });
      }
      if (input.serverName !== undefined) state.serverName = input.serverName.trim();
      if (nextLogo === undefined) delete state.serverLogo;
      else state.serverLogo = nextLogo;
      if (input.appearance === null) delete state.serverAppearance;
      else if (input.appearance !== undefined) state.serverAppearance = { ...input.appearance };
      const attempt6 = yield* Effect.gen({ self: this }, function* () {
        yield* this.#persistEffect();
      }).pipe(Effect.result);
      if (Result.isFailure(attempt6)) {
        const error = attempt6.failure.cause;
        state.serverName = previousName;
        if (previousLogo === undefined) delete state.serverLogo;
        else state.serverLogo = previousLogo;
        if (previousAppearance === undefined) delete state.serverAppearance;
        else state.serverAppearance = previousAppearance;
        if (nextLogo && nextLogo.version !== previousLogo?.version) {
          yield* this.#removeLogoEffect(nextLogo).pipe(Effect.catch(() => Effect.void));
        }
        return yield* new RemoteWorkflowError({ cause: error });
      }
      if (previousLogo && previousLogo.version !== nextLogo?.version) {
        yield* this.#removeLogoEffect(previousLogo).pipe(Effect.catch(() => Effect.void));
      }
      if (this.#state !== state) {
        return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.serverNotActive")) });
      }
      return identityOf(state);
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  getPendingKeyHandover(): HostKeyHandover | null {
    return this.#state?.pendingKeyRotation?.handover ?? null;
  }

  readonly beginKeyRotation = Effect.fn("TeamStore.beginKeyRotation")(
    function* (this: TeamStore): Effect.fn.Return<HostKeyHandover, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      if (state.pendingKeyRotation) return state.pendingKeyRotation.handover;
      const { publicKey, privateKey } = yield* remoteDecode(() =>
        generateKeyPairSync("ed25519", {
          publicKeyEncoding: { type: "spki", format: "pem" },
          privateKeyEncoding: { type: "pkcs8", format: "pem" },
        }),
      );
      const statement = {
        hostId: state.serverId,
        issuedAt: Date.now(),
        previousPublicKey: state.publicKey,
        publicKey,
      };
      const message = Buffer.from(hostKeyHandoverStatement(statement));
      const handover: HostKeyHandover = {
        ...statement,
        previousSignature: sign(null, message, state.privateKey).toString("base64url"),
        signature: sign(null, message, privateKey).toString("base64url"),
      };
      state.pendingKeyRotation = { publicKey, privateKey, handover };
      const attempt = yield* this.#persistStateEffect(state).pipe(Effect.result);
      if (Result.isFailure(attempt)) {
        delete state.pendingKeyRotation;
        return yield* attempt.failure;
      }
      return handover;
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly completeKeyRotation = Effect.fn("TeamStore.completeKeyRotation")(
    function* (
      this: TeamStore,
      handover: HostKeyHandover,
    ): Effect.fn.Return<TeamIdentity, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      const pending = state.pendingKeyRotation;
      if (!pending || pending.handover.publicKey !== handover.publicKey)
        return yield* new RemoteWorkflowError({
          cause: new TeamStoreError(sourceText("error.team.keyRotationMissing")),
        });
      const previous = { publicKey: state.publicKey, privateKey: state.privateKey };
      state.publicKey = pending.publicKey;
      state.privateKey = pending.privateKey;
      delete state.pendingKeyRotation;
      const attempt = yield* this.#persistStateEffect(state).pipe(Effect.result);
      if (Result.isFailure(attempt)) {
        state.publicKey = previous.publicKey;
        state.privateKey = previous.privateKey;
        state.pendingKeyRotation = pending;
        return yield* attempt.failure;
      }
      return identityOf(state);
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly discardKeyRotation = Effect.fn("TeamStore.discardKeyRotation")(
    function* (
      this: TeamStore,
      handover: HostKeyHandover,
    ): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      const pending = state.pendingKeyRotation;
      if (!pending || pending.handover.publicKey !== handover.publicKey) return;
      delete state.pendingKeyRotation;
      const attempt = yield* this.#persistStateEffect(state).pipe(Effect.result);
      if (Result.isFailure(attempt)) {
        state.pendingKeyRotation = pending;
        return yield* attempt.failure;
      }
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly #persistStateEffect = Effect.fn("TeamStore.persistState")(function* (
    this: TeamStore,
    state: StoredTeam,
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
    if (this.#state !== state)
      return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.serverNotActive")) });
    yield* this.#persistFileEffect();
  });

  readonly #readLegacyRecordEffect = Effect.fn("TeamStore.readLegacyRecord")(function* (
    this: TeamStore,
  ): Effect.fn.Return<{ record: StoredTeam; fingerprint: string } | null, RemoteWorkflowError, TeamStoreFiles> {
    const path = this.#legacyPath;
    if (!path) return null;
    const loaded = yield* TeamStoreFiles.use((files) => files.readText(path)).pipe(Effect.result);
    if (Result.isFailure(loaded)) {
      const error = loaded.failure.cause;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      return yield* loaded.failure;
    }
    const raw = loaded.success;
    const decoded = yield* remoteDecode(() => JSON.parse(raw)).pipe(Effect.result);
    if (Result.isFailure(decoded) || !isStoredTeam(decoded.success)) return null;
    return { record: decoded.success, fingerprint: createHash("sha256").update(raw).digest("hex") };
  });

  readonly #adoptLegacyLogoEffect = Effect.fn("TeamStore.adoptLegacyLogo")(function* (
    this: TeamStore,
    record: StoredTeam,
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
    const logo = record.serverLogo;
    const legacyLogoRoot = this.#legacyLogoRoot;
    if (!logo || !legacyLogoRoot) return;
    const name = `${logo.version}.${avatarFileExtension(logo.mimeType)}`;
    yield* TeamStoreFiles.use((files) => files.mkdir(this.#logoRoot));
    yield* TeamStoreFiles.use((files) =>
      files.copyExclusive(join(legacyLogoRoot, name), join(this.#logoRoot, name)),
    ).pipe(Effect.catch(() => Effect.void));
  });

  resolveLogo(): { path: string; mimeType: AvatarImageInput["mimeType"]; version: string } | null {
    const logo = this.#state?.serverLogo;
    if (!logo) return null;
    return {
      path: join(this.#logoRoot, `${logo.version}.${avatarFileExtension(logo.mimeType)}`),
      mimeType: logo.mimeType,
      version: logo.version,
    };
  }

  readonly #writeLogoEffect = Effect.fn("TeamStore.writeLogo")(function* (
    this: TeamStore,
    image: AvatarImageInput,
  ): Effect.fn.Return<NonNullable<StoredTeam["serverLogo"]>, RemoteWorkflowError, TeamStoreFiles> {
    if (!isValidAvatarImage(image.mimeType, image.bytes)) {
      return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.logoInvalid")) });
    }
    const version = randomUUID();
    const target = join(this.#logoRoot, `${version}.${avatarFileExtension(image.mimeType)}`);
    yield* TeamStoreFiles.use((files) => files.write(target, image.bytes, { createDirectory: true }));
    return { version, mimeType: image.mimeType };
  });

  readonly #removeLogoEffect = Effect.fn("TeamStore.removeLogo")(function* (
    this: TeamStore,
    logo: NonNullable<StoredTeam["serverLogo"]>,
  ) {
    yield* TeamStoreFiles.use((files) =>
      files.remove(join(this.#logoRoot, `${logo.version}.${avatarFileExtension(logo.mimeType)}`)),
    );
  });

  readonly setEnabledOnLaunch = Effect.fn("TeamStore.setEnabledOnLaunch")(
    function* (
      this: TeamStore,
      serverId: string,
      enabled: boolean,
    ): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      if (state.serverId !== serverId) {
        return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.serverNotActive")) });
      }
      state.enabledOnLaunch = enabled;
      yield* this.#persistEffect();
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  listStoredMembers(): TeamMemberSummary[] {
    return this.#state?.members.map(publicMember) ?? [];
  }

  memberAccounts(): { memberId: string; accountId: string; owner: boolean }[] {
    return this.#requireState().members.flatMap((member) =>
      member.accountId ? [{ memberId: member.id, accountId: member.accountId, owner: member.role === "owner" }] : [],
    );
  }

  listMembers(): TeamMemberSummary[] {
    const members = this.#requireState().members.map(publicMember);
    const known = new Set(members.map((member) => member.id));
    for (const remote of this.#remoteSessions.values()) {
      if (!known.has(remote.member.id) && Date.parse(remote.sessionExpiresAt) > Date.now()) {
        members.push(structuredClone(remote.member));
        known.add(remote.member.id);
      }
    }
    return members;
  }

  readonly syncRemoteDirectory = Effect.fn("TeamStore.syncRemoteDirectory")(
    function* (
      this: TeamStore,
      serverId: string,
      remoteMembers: RemoteDirectoryMember[],
      options: { keepOwner?: boolean } = {},
    ): Effect.fn.Return<string[], RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      if (state.serverId !== serverId) {
        return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.serverNotActive")) });
      }
      const remoteOwner = remoteMembers.find((member) => member.role === "owner");
      const localOwner = state.members.find((member) => member.role === "owner");
      if (!options.keepOwner && remoteOwner && localOwner && remoteOwner.membershipId !== localOwner.id) {
        if (state.members.some((member) => member.id === remoteOwner.membershipId)) {
          return yield* new RemoteWorkflowError({
            cause: new TeamStoreError(sourceText("error.team.ownerMembershipConflict")),
          });
        }
        const previousOwnerId = localOwner.id;
        localOwner.id = remoteOwner.membershipId;
        for (const session of state.sessions) {
          if (session.memberId === previousOwnerId) session.memberId = remoteOwner.membershipId;
        }
      }
      const remoteIds = new Set(remoteMembers.map((member) => member.membershipId));
      for (const remote of remoteMembers) {
        if (options.keepOwner && remote.role === "owner") continue;
        const member = state.members.find((candidate) => candidate.id === remote.membershipId);
        if (!member) {
          if (remote.role === "owner")
            return yield* new RemoteWorkflowError({
              cause: new TeamStoreError(sourceText("error.team.ownerIdentityMismatch")),
            });
          state.members.push({
            id: remote.membershipId,
            username: yield* remoteDecode(() => normalizeEmail(remote.email)),
            email: yield* remoteDecode(() => normalizeEmail(remote.email)),
            name: yield* remoteDecode(() => normalizeName(remote.name)),
            avatarUrl: yield* remoteDecode(() => normalizeAvatarUrl(remote.avatarUrl)),
            ...(isAvatarColor(remote.chatColor) ? { chatColor: remote.chatColor } : {}),
            role: remote.role,
            disabled: remote.status !== "active",
            createdAt: new Date(remote.createdAt).toISOString(),
          });
          continue;
        }
        member.username = yield* remoteDecode(() => normalizeEmail(remote.email));
        member.email = yield* remoteDecode(() => normalizeEmail(remote.email));
        member.name = yield* remoteDecode(() => normalizeName(remote.name));
        member.avatarUrl = yield* remoteDecode(() => normalizeAvatarUrl(remote.avatarUrl));
        applyChatColor(member, remote.chatColor);
        member.role = remote.role;
        member.disabled = remote.status !== "active";
      }
      for (const member of state.members) {
        if (member.role !== "owner" && !remoteIds.has(member.id)) member.disabled = true;
      }
      const activeRoles = new Map(
        remoteMembers
          .filter((member) => member.status === "active")
          .map((member) => [member.membershipId, member.role]),
      );
      const closed: string[] = [];
      for (const [tokenHash, session] of this.#remoteSessions) {
        if (activeRoles.get(session.member.id) === session.member.role) {
          const stored = state.members.find((member) => member.id === session.member.id);
          if (stored) session.member = { ...publicMember(stored), role: session.member.role, disabled: false };
          continue;
        }
        this.#remoteSessions.delete(tokenHash);
        closed.push(session.sessionId);
      }
      yield* this.#persistEffect();
      return closed;
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  openRemoteSession(input: {
    sessionId: string;
    membershipId: string;
    userId: string;
    role: TeamRole;
    expiresAt?: number;
  }): AuthenticatedMember {
    const sessionToken = randomBytes(32).toString("base64url");
    const sessionExpiresAt = new Date(input.expiresAt ?? Date.now() + SESSION_TTL_MS).toISOString();
    const stored = this.#requireState().members.find((member) => member.id === input.membershipId);
    const member: TeamMemberSummary = stored
      ? { ...publicMember(stored), role: input.role, disabled: false }
      : {
          id: input.membershipId,
          username: input.userId,
          email: null,
          name: null,
          role: input.role,
          createdAt: new Date().toISOString(),
          disabled: false,
        };
    this.#remoteSessions.set(hashToken(sessionToken), {
      member,
      sessionId: input.sessionId,
      createdAt: new Date().toISOString(),
      sessionExpiresAt,
    });
    return { member: structuredClone(member), sessionToken, sessionExpiresAt };
  }

  closeRemoteSession(sessionId: string): void {
    for (const [tokenHash, session] of this.#remoteSessions) {
      if (session.sessionId === sessionId) this.#remoteSessions.delete(tokenHash);
    }
  }

  isStoredOwnerSession(sessionId: string): boolean {
    const ownerId = this.getOwnerMemberId();
    return (
      ownerId !== null &&
      (this.#state?.sessions.some((session) => session.id === sessionId && session.memberId === ownerId) ?? false)
    );
  }

  getMember(memberId: string): TeamMemberSummary | null {
    const member = this.#state?.members.find((candidate) => candidate.id === memberId);
    return member ? publicMember(member) : null;
  }

  listInvites(): TeamInviteSummary[] {
    return this.#requireState().invites.map((invite) => ({
      id: invite.id,
      role: invite.role,
      expiresAt: invite.expiresAt,
      usedAt: invite.usedAt,
      email: invite.email ?? null,
      permanent: invite.permanent ?? false,
      useCount: invite.useCount ?? 0,
    }));
  }

  listSessions(): TeamSessionSummary[] {
    const state = this.#requireState();
    const persisted = state.sessions.map((session) => ({
      id: session.id,
      memberId: session.memberId,
      username: state.members.find((member) => member.id === session.memberId)?.username ?? "unknown",
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    }));
    const now = Date.now();
    const remote: TeamSessionSummary[] = [];
    for (const [tokenHash, session] of this.#remoteSessions) {
      if (Date.parse(session.sessionExpiresAt) <= now) {
        this.#remoteSessions.delete(tokenHash);
        continue;
      }
      remote.push({
        id: session.sessionId,
        memberId: session.member.id,
        username: session.member.username,
        createdAt: session.createdAt,
        expiresAt: session.sessionExpiresAt,
      });
    }
    return [...persisted, ...remote];
  }

  readonly createInvite = Effect.fn("TeamStore.createInvite")(
    function* (
      this: TeamStore,
      role: Exclude<TeamRole, "owner">,
      emailInput?: string,
      options?: { permanent?: boolean | undefined },
    ): Effect.fn.Return<CreatedInvite, RemoteWorkflowError, TeamStoreFiles> {
      if (role !== "admin" && role !== "member")
        return yield* new RemoteWorkflowError({ cause: new TeamStoreError("Invalid invite role.") });
      const permanent = options?.permanent ?? false;
      const email = emailInput?.trim() ? yield* remoteDecode(() => normalizeEmail(emailInput)) : null;
      if (permanent && email)
        return yield* new RemoteWorkflowError({
          cause: new TeamStoreError(sourceText("error.team.permanentInviteEmail")),
        });
      const state = yield* remoteDecode(() => this.#requireState());
      if (permanent) {
        const permanentInvites = state.invites.filter((invite) => invite.permanent === true).length;
        if (permanentInvites >= INPUT_LIMITS.maxPermanentInvites) {
          return yield* new RemoteWorkflowError({
            cause: new TeamStoreError(
              sourceText("error.team.permanentInviteLimit", { limit: INPUT_LIMITS.maxPermanentInvites }),
            ),
          });
        }
      } else {
        const activeInvites = state.invites.filter(
          (invite) => invite.permanent !== true && invite.usedAt === null && Date.parse(invite.expiresAt) > Date.now(),
        ).length;
        if (activeInvites >= INPUT_LIMITS.activeInvites) {
          return yield* new RemoteWorkflowError({
            cause: new TeamStoreError(
              sourceText("error.team.activeInviteLimit", { limit: INPUT_LIMITS.activeInvites }),
            ),
          });
        }
      }
      const token = randomBytes(32).toString("base64url");
      const invite: StoredInvite = {
        id: randomUUID(),
        tokenHash: hashToken(token),
        role,
        expiresAt: permanent ? permanentInviteExpiresAt() : new Date(Date.now() + INVITE_TTL_MS).toISOString(),
        usedAt: null,
        email,
        permanent,
        useCount: 0,
      };
      state.invites.push(invite);
      yield* this.#persistEffect();
      return { id: invite.id, role, token, expiresAt: invite.expiresAt, email, permanent, useCount: 0 };
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  previewInvite(token: string): TeamInvitePreview {
    const invite = this.#findUsableInvite(token);
    if (!invite) throw new TeamStoreError(sourceText("error.team.inviteInvalid"));
    return {
      role: invite.role,
      expiresAt: invite.expiresAt,
      emailBound: Boolean(invite.email),
      permanent: invite.permanent ?? false,
    };
  }

  readonly acceptInviteWithAccount = Effect.fn("TeamStore.acceptInviteWithAccount")(
    function* (
      this: TeamStore,
      token: string,
      user: CentralAuthUser,
    ): Effect.fn.Return<AuthenticatedMember, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      const email = yield* remoteDecode(() => normalizeEmail(user.email));
      const invite = yield* remoteDecode(() => this.#findUsableInvite(token));
      if (!invite)
        return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.inviteInvalid")) });
      if (invite.email && invite.email !== email) {
        return yield* new RemoteWorkflowError({
          cause: new TeamStoreError(sourceText("error.team.inviteEmailMismatch")),
        });
      }
      const existingMember = state.members.find((member) => member.email === email || member.username === email);
      if (existingMember) {
        if (existingMember.disabled)
          return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.memberDisabled")) });
        existingMember.email = email;
        existingMember.accountId = user.id;
        existingMember.username = email;
        existingMember.name = yield* remoteDecode(() => normalizeName(user.name));
        existingMember.avatarUrl = yield* remoteDecode(() => normalizeAvatarUrl(user.avatarUrl));
        applyChatColor(existingMember, user.chatColor);
        this.#consumeInvite(invite);
        const result = yield* remoteDecode(() => this.#createSession(existingMember));
        yield* this.#persistEffect();
        return result;
      }
      yield* remoteDecode(() => requireNewMemberSeat(state));
      const member: StoredMember = {
        id: randomUUID(),
        accountId: user.id,
        username: email,
        email,
        name: yield* remoteDecode(() => normalizeName(user.name)),
        avatarUrl: yield* remoteDecode(() => normalizeAvatarUrl(user.avatarUrl)),
        ...(isAvatarColor(user.chatColor) ? { chatColor: user.chatColor } : {}),
        role: invite.role,
        disabled: false,
        createdAt: new Date().toISOString(),
      };
      this.#consumeInvite(invite);
      state.members.push(member);
      const result = yield* remoteDecode(() => this.#createSession(member));
      yield* this.#persistEffect();
      return result;
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly loginWithAccount = Effect.fn("TeamStore.loginWithAccount")(
    function* (
      this: TeamStore,
      user: CentralAuthUser,
    ): Effect.fn.Return<AuthenticatedMember, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      const email = yield* remoteDecode(() => normalizeEmail(user.email));
      const member = state.members.find(
        (candidate) => (candidate.email === email || candidate.username === email) && !candidate.disabled,
      );
      if (!member)
        return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.accountNotMember")) });
      member.email = email;
      member.accountId = user.id;
      member.username = email;
      member.name = yield* remoteDecode(() => normalizeName(user.name));
      member.avatarUrl = yield* remoteDecode(() => normalizeAvatarUrl(user.avatarUrl));
      applyChatColor(member, user.chatColor);
      const result = yield* remoteDecode(() => this.#createSession(member));
      yield* this.#persistEffect();
      return result;
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly acceptInvite = Effect.fn("TeamStore.acceptInvite")(
    function* (
      this: TeamStore,
      token: string,
      username: string,
      password: string,
    ): Effect.fn.Return<AuthenticatedMember, RemoteWorkflowError, TeamStoreFiles> {
      yield* remoteDecode(() => validateUsername(username));
      yield* remoteDecode(() => validatePassword(password));
      const state = yield* remoteDecode(() => this.#requireState());
      const normalizedUsername = username.trim().toLowerCase();
      const requireJoin = () => {
        if (state.members.some((member) => member.username === normalizedUsername)) {
          throw new TeamStoreError(sourceText("error.team.usernameTaken"));
        }
        const invite = this.#findUsableInvite(token);
        if (!invite) throw new TeamStoreError(sourceText("error.team.inviteInvalid"));
        if (invite.email) throw new TeamStoreError(sourceText("error.team.inviteRequiresAccount"));
        requireNewMemberSeat(state);
        return invite;
      };
      requireJoin();
      const credentials = yield* hashPasswordEffect(password);
      yield* remoteDecode(() => this.#requireUnchangedState(state));
      const invite = requireJoin();
      const member: StoredMember = {
        id: randomUUID(),
        username: normalizedUsername,
        email: null,
        name: null,
        avatarUrl: null,
        role: invite.role,
        disabled: false,
        createdAt: new Date().toISOString(),
        ...credentials,
      };
      this.#consumeInvite(invite);
      state.members.push(member);
      const result = yield* remoteDecode(() => this.#createSession(member));
      yield* this.#persistEffect();
      return result;
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly login = Effect.fn("TeamStore.login")(
    function* (
      this: TeamStore,
      username: string,
      password: string,
    ): Effect.fn.Return<AuthenticatedMember, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      const member = state.members.find(
        (candidate) => candidate.username === username.trim().toLowerCase() && !candidate.disabled,
      );
      if (!member || !(yield* verifyPasswordEffect(password, member))) {
        return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.loginIncorrect")) });
      }
      yield* remoteDecode(() => this.#requireUnchangedState(state));
      const result = yield* remoteDecode(() => this.#createSession(member));
      yield* this.#persistEffect();
      return result;
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  authenticate(token: string): TeamMemberSummary | null {
    return this.authenticateSession(token)?.member ?? null;
  }

  authenticateSession(
    token: string,
  ): { member: TeamMemberSummary; sessionId: string; sessionExpiresAt: string } | null {
    if (!this.#state || !token) return null;
    const tokenHash = hashToken(token);
    const remote = this.#remoteSessions.get(tokenHash);
    if (remote) {
      if (Date.parse(remote.sessionExpiresAt) > Date.now()) return structuredClone(remote);
      this.#remoteSessions.delete(tokenHash);
    }
    const session = this.#state.sessions.find(
      (candidate) => Date.parse(candidate.expiresAt) > Date.now() && safeTextEqual(candidate.tokenHash, tokenHash),
    );
    if (!session) return null;
    const member = this.#state.members.find((candidate) => candidate.id === session.memberId && !candidate.disabled);
    return member ? { member: publicMember(member), sessionId: session.id, sessionExpiresAt: session.expiresAt } : null;
  }

  readonly logout = Effect.fn("TeamStore.logout")(
    function* (this: TeamStore, token: string): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      const tokenHash = hashToken(token);
      state.sessions = state.sessions.filter((candidate) => !safeTextEqual(candidate.tokenHash, tokenHash));
      yield* this.#persistEffect();
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly changePassword = Effect.fn("TeamStore.changePassword")(
    function* (this: TeamStore, memberId: string, currentPassword: string, nextPassword: string) {
      yield* remoteDecode(() => validatePassword(nextPassword));
      const state = yield* remoteDecode(() => this.#requireState());
      const member = state.members.find((candidate) => candidate.id === memberId);
      if (!member || !(yield* verifyPasswordEffect(currentPassword, member))) {
        return yield* new RemoteWorkflowError({
          cause: new TeamStoreError(sourceText("error.team.currentPasswordIncorrect")),
        });
      }
      const credentials = yield* hashPasswordEffect(nextPassword);
      yield* remoteDecode(() => this.#requireUnchangedState(state));
      Object.assign(member, credentials);
      state.sessions = state.sessions.filter((session) => session.memberId !== memberId);
      yield* this.#persistEffect();
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly updateMember = Effect.fn("TeamStore.updateMember")(
    function* (
      this: TeamStore,
      memberId: string,
      patch: { role?: Exclude<TeamRole, "owner">; disabled?: boolean },
    ): Effect.fn.Return<TeamMemberSummary, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      const member = state.members.find((candidate) => candidate.id === memberId);
      if (!member)
        return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.memberNotFound")) });
      if (member.role === "owner")
        return yield* new RemoteWorkflowError({
          cause: new TeamStoreError(sourceText("error.team.ownerCannotChange")),
        });
      if (patch.disabled === false && member.disabled) yield* remoteDecode(() => requireMemberSeat(state));
      if (patch.role !== undefined) {
        if (patch.role !== "admin" && patch.role !== "member")
          return yield* new RemoteWorkflowError({ cause: new TeamStoreError("Invalid role.") });
        member.role = patch.role;
      }
      if (patch.disabled !== undefined) member.disabled = patch.disabled;
      if (member.disabled) {
        state.sessions = state.sessions.filter((session) => session.memberId !== member.id);
      }
      yield* this.#persistEffect();
      return publicMember(member);
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly removeMember = Effect.fn("TeamStore.removeMember")(
    function* (this: TeamStore, memberId: string): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      const member = state.members.find((candidate) => candidate.id === memberId);
      if (!member)
        return yield* new RemoteWorkflowError({ cause: new TeamStoreError(sourceText("error.team.memberNotFound")) });
      if (member.role === "owner")
        return yield* new RemoteWorkflowError({
          cause: new TeamStoreError(sourceText("error.team.ownerCannotRemove")),
        });
      state.members = state.members.filter((candidate) => candidate.id !== memberId);
      state.sessions = state.sessions.filter((session) => session.memberId !== memberId);
      yield* this.#persistEffect();
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly revokeSession = Effect.fn("TeamStore.revokeSession")(
    function* (this: TeamStore, sessionId: string): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      state.sessions = state.sessions.filter((session) => session.id !== sessionId);
      this.closeRemoteSession(sessionId);
      yield* this.#persistEffect();
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly revokeInvite = Effect.fn("TeamStore.revokeInvite")(
    function* (this: TeamStore, inviteId: string): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
      const state = yield* remoteDecode(() => this.#requireState());
      state.invites = state.invites.filter((invite) => invite.id !== inviteId);
      yield* this.#persistEffect();
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  readonly syncAccount = Effect.fn("TeamStore.syncAccount")(
    function* (this: TeamStore, user: CentralAuthUser): Effect.fn.Return<boolean, RemoteWorkflowError, TeamStoreFiles> {
      yield* remoteDecode(() => this.#requireState());
      if (!(yield* remoteDecode(() => this.#applyAccount(user)))) return false;
      yield* this.#persistEffect();
      return true;
    },
    Effect.provide(TeamStoreFiles.layer),
    Effect.uninterruptible,
  ).bind(this);

  #applyAccount(user: CentralAuthUser): boolean {
    const state = this.#requireState();
    const email = normalizeEmail(user.email);
    const member =
      state.members.find((candidate) => candidate.accountId === user.id) ??
      state.members.find((candidate) => candidate.email === email || candidate.username === email);
    if (!member) return false;
    const name = normalizeName(user.name);
    const avatarUrl = normalizeAvatarUrl(user.avatarUrl);
    const chatColor = user.chatColor === undefined ? member.chatColor : user.chatColor;
    if (
      member.email === email &&
      member.accountId === user.id &&
      member.username === email &&
      member.name === name &&
      (member.avatarUrl ?? null) === avatarUrl &&
      (member.chatColor ?? null) === (chatColor ?? null)
    ) {
      return false;
    }
    member.email = email;
    member.accountId = user.id;
    member.username = email;
    member.name = name;
    member.avatarUrl = avatarUrl;
    applyChatColor(member, user.chatColor);
    return true;
  }

  #createSession(member: StoredMember): AuthenticatedMember {
    const state = this.#requireState();
    const memberSessions = state.sessions
      .filter((session) => session.memberId === member.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const excess = memberSessions.length - INPUT_LIMITS.sessionsPerMember + 1;
    if (excess > 0) {
      const removedIds = new Set(memberSessions.slice(0, excess).map((session) => session.id));
      state.sessions = state.sessions.filter((session) => !removedIds.has(session.id));
    }
    const sessionToken = randomBytes(32).toString("base64url");
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    state.sessions.push({
      id: randomUUID(),
      memberId: member.id,
      tokenHash: hashToken(sessionToken),
      expiresAt: sessionExpiresAt,
      createdAt: new Date().toISOString(),
    });
    return { member: publicMember(member), sessionToken, sessionExpiresAt };
  }

  #findUsableInvite(token: string): StoredInvite | undefined {
    return this.#requireState().invites.find(
      (candidate) =>
        (candidate.permanent === true || candidate.usedAt === null) &&
        Date.parse(candidate.expiresAt) > Date.now() &&
        safeTextEqual(candidate.tokenHash, hashToken(token)),
    );
  }

  #consumeInvite(invite: StoredInvite): void {
    if (invite.permanent === true) {
      invite.useCount = (invite.useCount ?? 0) + 1;
      return;
    }
    invite.usedAt = new Date().toISOString();
  }

  #requireState(): StoredTeam {
    if (!this.#state) throw new TeamStoreError(sourceText("error.team.serverNotConfigured"));
    return this.#state;
  }

  #requireUnchangedState(state: StoredTeam): void {
    if (this.#state !== state) {
      throw new TeamStoreError(sourceText("error.team.accountChangedDuringRequest"));
    }
  }

  #assertNoHostFor(accountId: string, email: string): void {
    const ownerless = this.#file.hosts.some((host) => {
      const owner = hostOwner(host);
      return owner !== undefined && !owner.accountId && !owner.email;
    });
    if (this.#hostFor(accountId, email) || ownerless) {
      throw new TeamStoreError(sourceText("error.team.alreadyConfigured"));
    }
  }

  #hostFor(accountId: string, email: string): StoredTeam | undefined {
    return this.#file.hosts.find((host) => {
      const owner = hostOwner(host);
      if (!owner) return false;
      if (owner.accountId) return owner.accountId === accountId;
      return owner.email ? normalizeEmail(owner.email) === email : false;
    });
  }

  readonly #pruneEffect = Effect.fn("TeamStore.prune")(function* (
    this: TeamStore,
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
    if (!this.#state) return;
    this.#dropExpired(this.#state);
    yield* this.#persistEffect();
  });

  #dropExpired(host: StoredTeam): void {
    const now = Date.now();
    host.sessions = host.sessions.filter((session) => Date.parse(session.expiresAt) > now);
    host.invites = host.invites.filter((invite) => invite.usedAt !== null || Date.parse(invite.expiresAt) > now);
  }

  readonly #persistEffect = Effect.fn("TeamStore.persist")(function* (
    this: TeamStore,
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
    yield* remoteDecode(() => this.#requireState());
    yield* this.#persistFileEffect();
  });

  readonly #persistFileEffect = Effect.fn("TeamStore.persistFile")(function* (
    this: TeamStore,
  ): Effect.fn.Return<void, RemoteWorkflowError, TeamStoreFiles> {
    if (this.#unreadableFile || this.#readOnly) {
      return yield* new RemoteWorkflowError({
        cause: new TeamStoreError(sourceText("error.team.serverFileUnreadable")),
      });
    }
    const snapshot = structuredClone(this.#file);
    const previous = this.#writeChain;
    const pending = Deferred.makeUnsafe<void>();
    this.#writeChain = pending;
    yield* Effect.gen({ self: this }, function* () {
      if (previous) yield* Deferred.await(previous);
      const content = yield* remoteDecode(() => `${JSON.stringify(snapshot)}\n`);
      yield* TeamStoreFiles.use((files) => files.write(this.#path, content));
    }).pipe(
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          if (this.#writeChain === pending) this.#writeChain = null;
          yield* Deferred.succeed(pending, undefined);
        }),
      ),
    );
  });
}

export function fingerprint(publicKey: string): string {
  return createHash("sha256").update(publicKey).digest("base64url");
}

const hashPasswordEffect = Effect.fn("TeamStore.hashPassword")(function* (password: string) {
  const passwordSalt = yield* remoteDecode(() => randomBytes(16).toString("base64url"));
  const bytes = yield* derivePasswordBytesEffect(password, passwordSalt);
  return { passwordSalt, passwordHash: Buffer.from(bytes).toString("base64url") };
});
const verifyPasswordEffect = Effect.fn("TeamStore.verifyPassword")(function* (password: string, member: StoredMember) {
  if (!member.passwordSalt || !member.passwordHash) return false;
  const bytes = yield* derivePasswordBytesEffect(password, member.passwordSalt);
  const candidate = Buffer.from(bytes);
  const expected = Buffer.from(member.passwordHash, "base64url");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
});
const derivePasswordBytesEffect = Effect.fn("TeamStore.derivePasswordBytes")(function* (
  password: string,
  salt: string,
) {
  const result = yield* remoteCall(() => scrypt(password, salt, 64));
  if (!(result instanceof Uint8Array))
    return yield* new RemoteWorkflowError({ cause: new Error("Password hashing returned invalid data.") });
  return result;
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function safeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function applyChatColor(member: StoredMember, chatColor: AvatarColor | null | undefined): void {
  if (chatColor === undefined) return;
  if (isAvatarColor(chatColor)) member.chatColor = chatColor;
  else delete member.chatColor;
}

function publicMember(member: StoredMember): TeamMemberSummary {
  return {
    id: member.id,
    username: member.username,
    email: member.email ?? null,
    name: member.name ?? null,
    avatarUrl: member.avatarUrl ?? null,
    ...(isAvatarColor(member.chatColor) ? { chatColor: member.chatColor } : {}),
    role: member.role,
    createdAt: member.createdAt,
    disabled: member.disabled,
  };
}

function normalizeEmail(value: string): string {
  const normalized = normalizeEmailAddress(value);
  if (!normalized) throw new TeamStoreError(sourceText("error.team.emailInvalid"));
  return normalized;
}

function normalizeName(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized.length > INPUT_LIMITS.accountName)
    throw new TeamStoreError(sourceText("error.team.accountNameTooLong"));
  return normalized || null;
}

function normalizeAvatarUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.length > INPUT_LIMITS.avatarUrl) throw new TeamStoreError(sourceText("error.team.avatarUrlTooLong"));
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TeamStoreError(sourceText("error.team.avatarUrlInvalid"));
  }
  return url.toString();
}

export function validateServerName(value: string): void {
  const normalized = value.trim();
  if (normalized.length < INPUT_LIMITS.serverNameMin || normalized.length > INPUT_LIMITS.serverName) {
    throw new TeamStoreError(
      sourceText("error.team.serverNameLength", { min: INPUT_LIMITS.serverNameMin, max: INPUT_LIMITS.serverName }),
    );
  }
  if (slugifyTeamServerName(normalized).length < INPUT_LIMITS.serverNameMin) {
    throw new TeamStoreError(sourceText("error.team.serverNameHostname"));
  }
}

function validateUsername(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(value.trim())) {
    throw new TeamStoreError(sourceText("error.team.usernameInvalid"));
  }
}

function validatePassword(value: string): void {
  if (value.length < 12 || value.length > 256) {
    throw new TeamStoreError(sourceText("error.team.passwordLength"));
  }
}

function identityOf(host: StoredTeam): TeamIdentity {
  return {
    serverId: host.serverId,
    serverName: host.serverName,
    fingerprint: fingerprint(host.publicKey),
    publicKey: host.publicKey,
    enabledOnLaunch: host.enabledOnLaunch,
    logoVersion: host.serverLogo?.version ?? null,
    appearance: serverAppearanceOrNull(host.serverAppearance),
  };
}

function requireNewMemberSeat(host: StoredTeam): void {
  if (host.members.length >= INPUT_LIMITS.teamMembers) {
    throw new TeamStoreError(sourceText("error.team.memberLimit", { limit: INPUT_LIMITS.teamMembers }));
  }
  requireMemberSeat(host);
}

function requireMemberSeat(host: StoredTeam): void {
  if (host.members.filter((member) => !member.disabled).length >= DEFAULT_TEAM_MEMBER_LIMIT) {
    throw new TeamStoreError(sourceText("error.team.memberLimit", { limit: DEFAULT_TEAM_MEMBER_LIMIT }));
  }
}

function hostOwner(host: StoredTeam): StoredMember | undefined {
  return host.members.find((member) => member.role === "owner");
}

function ownerAccountId(host: StoredTeam): string | null {
  return hostOwner(host)?.accountId ?? null;
}

function reconcileHost(baseline: StoredTeam, mine: StoredTeam, theirs: StoredTeam): StoredTeam {
  const merged: StoredTeam = {
    ...mine,
    serverName: pickChanged(baseline.serverName, mine.serverName, theirs.serverName),
    enabledOnLaunch: pickChanged(baseline.enabledOnLaunch, mine.enabledOnLaunch, theirs.enabledOnLaunch),
    members: reconcileMembers(baseline.members, mine.members, theirs.members),
    invites: reconcileEntries(baseline.invites, mine.invites, theirs.invites),
    sessions: reconcileEntries(baseline.sessions, mine.sessions, theirs.sessions),
  };
  const serverLogo = pickChanged(baseline.serverLogo, mine.serverLogo, theirs.serverLogo);
  if (serverLogo === undefined) delete merged.serverLogo;
  else merged.serverLogo = serverLogo;
  const serverAppearance = pickChanged(baseline.serverAppearance, mine.serverAppearance, theirs.serverAppearance);
  if (serverAppearance === undefined) delete merged.serverAppearance;
  else merged.serverAppearance = serverAppearance;
  return merged;
}

function reconcileMembers(baseline: StoredMember[], mine: StoredMember[], theirs: StoredMember[]): StoredMember[] {
  return reconcileEntries(baseline, mine, theirs).map((member) => {
    const ours = mine.find((candidate) => candidate.id === member.id);
    return ours?.accountId ? { ...member, accountId: ours.accountId } : member;
  });
}

function pickChanged<T>(baseline: T, mine: T, theirs: T): T {
  return sameValue(theirs, baseline) ? mine : theirs;
}

function reconcileEntries<T extends { id: string }>(baseline: T[], mine: T[], theirs: T[]): T[] {
  const before = new Map(baseline.map((entry) => [entry.id, entry]));
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const entry of [...mine, ...theirs]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const ours = mine.find((candidate) => candidate.id === entry.id);
    const other = theirs.find((candidate) => candidate.id === entry.id);
    const known = before.get(entry.id);
    if (known && (!ours || !other)) continue;
    if (!ours || !other || !known) {
      merged.push(ours ?? other ?? entry);
      continue;
    }
    merged.push(reconcileFields(known, ours, other));
  }
  return merged;
}

function reconcileFields<T extends object>(baseline: T, mine: T, theirs: T): T {
  const merged = { ...mine };
  const before = new Map(Object.entries(baseline));
  const ours = new Map(Object.entries(mine));
  for (const [key, other] of Object.entries(theirs)) {
    Reflect.set(merged, key, sameValue(other, before.get(key)) ? ours.get(key) : other);
  }
  for (const key of ours.keys()) {
    if (!(key in theirs) && before.has(key) && sameValue(ours.get(key), before.get(key))) {
      Reflect.deleteProperty(merged, key);
    }
  }
  return merged;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function isStoredTeamFile(value: unknown): value is StoredTeamFile {
  if (!isDynamicRecord(value)) return false;
  return (
    value.version === 2 &&
    (value.activeAccountId === null || isString(value.activeAccountId)) &&
    Array.isArray(value.hosts) &&
    value.hosts.every((host) => isStoredTeam(host)) &&
    (value.legacyImport === undefined ||
      (isDynamicRecord(value.legacyImport) &&
        isString(value.legacyImport.fingerprint) &&
        isStoredTeam(value.legacyImport.record))) &&
    (value.replacedHosts === undefined ||
      (Array.isArray(value.replacedHosts) && value.replacedHosts.every((host) => isStoredTeam(host))))
  );
}

function isStoredTeam(value: unknown): value is StoredTeam {
  if (!isDynamicRecord(value)) return false;
  const record = value;
  const logo = record.serverLogo;
  const validLogo =
    logo === undefined ||
    (isDynamicRecord(logo) && isString(logo.version) && isString(logo.mimeType) && isAvatarMimeType(logo.mimeType));
  return (
    record.version === 1 &&
    isString(record.serverId) &&
    isString(record.serverName) &&
    isString(record.publicKey) &&
    isString(record.privateKey) &&
    Array.isArray(record.members) &&
    Array.isArray(record.invites) &&
    Array.isArray(record.sessions) &&
    validLogo &&
    (record.pendingKeyRotation === undefined ||
      (isDynamicRecord(record.pendingKeyRotation) &&
        isString(record.pendingKeyRotation.publicKey) &&
        isString(record.pendingKeyRotation.privateKey) &&
        isDynamicRecord(record.pendingKeyRotation.handover)))
  );
}
