import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { createInviteUrl, selfHostedApiOrigin } from "@openbot/contracts/invite-links";
import type {
  AvatarImageInput,
  CentralAuthUser,
  ConfigureHostInput,
  ConversationMessageSender,
  ConversationPageAnchor,
  CreateTeamInviteInput,
  DirectConversationPage,
  DirectConversationPageAnchor,
  DirectConversationSnapshot,
  DirectMessageRealtimeEvent,
  DirectThreadSummary,
  DirectTypingInput,
  DirectTypingRealtimeEvent,
  HostStatus,
  InviteSummary,
  MarkConversationReadInput,
  MarkDirectReadInput,
  RemoteDesktopDisplay,
  RemoteDesktopIceServer,
  RemoteDesktopSetupAction,
  SendDirectMessageInput,
  SetTeamTypingInput,
  TeamMemberSummary,
  TeamPresenceSnapshot,
  TeamSessionSummary,
  UpdateHostIdentityInput,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import { conversationMessageSender, SIGNED_OUT_CHANNEL_MEMBER_ID } from "@openbot/contracts/ipc";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import type { HostRestartState } from "@openbot/contracts/team-protocol/host-update-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Cause, Context, Deferred, Effect, Fiber, Layer, ManagedRuntime, Result } from "effect";
import type { AgentService } from "../backend/agent-service";
import type { ChannelService } from "../backend/channel-service";
import type { TeamChatStore } from "../backend/team-chat-store";
import { BrowserViewGateway } from "./browser-view-gateway";
import type { VerifiedRemoteSessionTicket } from "./central-auth-manager";
import { LiveActivityPushService, LiveActivitySendFailure } from "./live-activity-push";
import type { RemoteDesktopRuntimePaths } from "./remote-desktop-runtime-artifact";
import { appendRemoteDiagnosticLog } from "./remote-diagnostics";
import { RemoteScreenGateway, type RemoteScreenGatewayCreateRuntime } from "./remote-screen-gateway";
import { RemoteWorkflowError, remoteDecode } from "./remote-service-effects";
import type { TailscaleDirectService } from "./tailscale-direct-service";
import type { TailscaleHostSetup } from "./tailscale-host-setup";
import { TeamApiServer } from "./team-api-server";
import type { RemoteDirectoryMember, TeamIdentity, TeamStore } from "./team-store";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { TeamWebRtcHostGateway } from "./team-webrtc-host-gateway";

export const DEVELOPMENT_REMOTE_CLIENT_USERNAME = "openbot-dev-client";

const logger = createOpenBotLogger("host-service");

interface HostEvents {
  changed: [status: HostStatus];
  presence: [snapshot: TeamPresenceSnapshot];
  directMessage: [event: DirectMessageRealtimeEvent];
  directTyping: [event: DirectTypingRealtimeEvent];
}

/**
 * The collaborators this service only forwards to the Team API, typed by the narrow
 * shapes that server already declares rather than by the concrete stores. Nothing here
 * changes at the call site - `index.ts` still passes the real services - but it lets an
 * account switch be tested without standing up a database and a browser host.
 */
type ForwardedApiOptions = ConstructorParameters<typeof TeamApiServer>[0];

interface HostServiceOptions {
  channels?: ChannelService;
  mcpServers?: ForwardedApiOptions["mcpServers"];
  mcpToolRuntimePreparation?: ForwardedApiOptions["mcpToolRuntimePreparation"];
  storage?: ForwardedApiOptions["storage"];
  hostedSites?: ForwardedApiOptions["hostedSites"];
  events?: ForwardedApiOptions["events"];
  agentImport?: ForwardedApiOptions["agentImport"];
  admin?: ForwardedApiOptions["admin"];
  appVersion: string;
  store: TeamStore;
  agents: ForwardedApiOptions["agents"] & Pick<AgentService, "adoptConversationReads" | "searchConversationFiles">;
  skills: NonNullable<ForwardedApiOptions["skills"]>;
  sidebarLayout: NonNullable<ForwardedApiOptions["sidebarLayout"]>;
  mailbox: ForwardedApiOptions["mailbox"];
  browser: ForwardedApiOptions["browser"];
  chat?: TeamChatStore;
  /**
   * A local development host keeps its members and invitations in its own team file and never reads
   * or writes them in the account directory.
   */
  localDevelopmentHost?: boolean;
  logDirectory?: string;
  removeLegacyRemoteDesktopCredential?: () => Effect.Effect<void, RemoteWorkflowError>;
  getSignedInUser: () => CentralAuthUser;
  redeemCentralTicket: (ticket: string, serverId: string) => Effect.Effect<CentralAuthUser | null, RemoteWorkflowError>;
  sendTeamInviteEmail: (input: {
    email: string;
    serverName: string;
    inviteUrl: string;
    role: "admin" | "member";
  }) => Effect.Effect<void, RemoteWorkflowError>;
  openRemoteDesktopSetup?: (
    action: RemoteDesktopSetupAction,
    appPath: string,
  ) => Effect.Effect<void, RemoteWorkflowError>;
  remoteDesktopRuntimePaths?: RemoteDesktopRuntimePaths | null;
  remoteDesktopStateDirectory?: string;
  /** Only a test supplies this. The gateway builds the real Sunshine and Moonlight runtime itself. */
  createRemoteDesktopRuntime?: RemoteScreenGatewayCreateRuntime;
  getRemoteDesktopRuntimeCredentials?: () => Effect.Effect<{ username: string; password: string }, RemoteWorkflowError>;
  getRemoteDesktopDisplays?: () => RemoteDesktopDisplay[];
  getRemoteDesktopIceServers?: () => Effect.Effect<RemoteDesktopIceServer[], RemoteWorkflowError>;
  platform?: "darwin" | "win32" | "linux";
  unattended?: boolean;
  teamWebRtcBridge?: TeamWebRtcBridge;
  registerRemoteHost?: (input: {
    hostId: string;
    name: string;
    ownerMembershipId: string;
    devicePublicKey?: string | null;
  }) => Effect.Effect<unknown, RemoteWorkflowError>;
  issueRemoteHostTicket?: (
    hostId: string,
  ) => Effect.Effect<{ ticket: string; signalUrl: string; expiresAt: number }, RemoteWorkflowError>;
  /** Sends one sealed Live Activity update through the account service. `gone` means Apple refused the token. */
  sendLiveActivityPush?: (
    hostId: string,
    push: LiveActivityRelayPush,
  ) => Effect.Effect<"sent" | "gone", RemoteWorkflowError>;
  verifyRemoteSessionTicket?: (ticket: string) => Effect.Effect<VerifiedRemoteSessionTicket, RemoteWorkflowError>;
  /** The direct Tailscale path. Absent where this host does not offer it. */
  tailscaleDirect?: TailscaleDirectService;
  /** The owner's Tailscale setup of this host from a joined client. Absent where the host does not offer it. */
  tailscaleSetup?: TailscaleHostSetup;
  /** Opens the Tailscale app when it is installed, and its download page when it is not. */
  openTailscale?: (installed: boolean) => Effect.Effect<void, RemoteWorkflowError>;
  endRemoteSession?: (sessionId: string) => Effect.Effect<void, RemoteWorkflowError>;
  remoteControlPlaneUrl?: string;
  createRemoteInvite?: (
    hostId: string,
    input: { role: "admin" | "member"; email?: string; permanent?: boolean },
  ) => Effect.Effect<
    { inviteId: string; token: string; expiresAt: number; permanent: boolean; useCount: number },
    RemoteWorkflowError
  >;
  listRemoteInvites?: (hostId: string) => Effect.Effect<
    Array<{
      inviteId: string;
      role: "admin" | "member";
      email: string | null;
      expiresAt: number;
      usedAt: number | null;
      revokedAt: number | null;
      permanent: boolean;
      useCount: number;
    }>,
    RemoteWorkflowError
  >;
  revokeRemoteInvite?: (inviteId: string) => Effect.Effect<void, RemoteWorkflowError>;
  listRemoteMembers?: (hostId: string) => Effect.Effect<RemoteDirectoryMember[], RemoteWorkflowError>;
  updateRemoteMember?: (
    hostId: string,
    membershipId: string,
    role: "admin" | "member",
    reactivate?: boolean,
  ) => Effect.Effect<void, RemoteWorkflowError>;
  removeRemoteMember?: (hostId: string, membershipId: string) => Effect.Effect<void, RemoteWorkflowError>;
  updateRemoteHostLogo?: (
    hostId: string,
    image: AvatarImageInput | null,
    version?: string | null,
  ) => Effect.Effect<string | null, RemoteWorkflowError>;
}

class HostApiRuntime extends Context.Service<
  HostApiRuntime,
  {
    start(): Effect.Effect<number, RemoteWorkflowError>;
  }
>()("openbot/main/HostApiRuntime") {}

export class HostService extends EventEmitter<HostEvents> {
  readonly #options: Required<Pick<HostServiceOptions, "localDevelopmentHost">> &
    Omit<HostServiceOptions, "localDevelopmentHost">;
  readonly #api: TeamApiServer;
  readonly #runtime: ManagedRuntime.ManagedRuntime<HostApiRuntime, never>;
  readonly #operations = new Set<Deferred.Deferred<void>>();
  #shutdown: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  readonly #remoteScreen: RemoteScreenGateway;
  readonly #browserView: BrowserViewGateway;
  #lastBrowserViewInputAt: number | null = null;
  readonly #webrtcGateway: TeamWebRtcHostGateway | null;
  readonly #liveActivityPush: LiveActivityPushService | undefined;
  #status: HostStatus;
  #runtimeGeneration = 0;
  #startOperation: Fiber.Fiber<HostStatus, RemoteWorkflowError> | null = null;
  #webRtcOnline = false;
  /** `undefined` until the account service first reports, so the first report always binds. */
  #boundAccountId: string | null | undefined = undefined;
  #legacyCredentialRemoved = false;

  constructor(options: HostServiceOptions) {
    super();
    this.#options = {
      ...options,
      localDevelopmentHost: options.localDevelopmentHost ?? false,
    };
    this.#status = initialHostStatus(options.store.getIdentity(), options.unattended ?? false);
    const logDirectory = options.logDirectory;
    this.#remoteScreen = new RemoteScreenGateway({
      platform: options.platform ?? normalizeRemoteDesktopPlatform(process.platform),
      unattended: options.unattended ?? false,
      runtimePaths: options.remoteDesktopRuntimePaths ?? null,
      runtimeStateDirectory: options.remoteDesktopStateDirectory ?? ".openbot-remote-desktop",
      getRuntimeCredentials:
        options.getRemoteDesktopRuntimeCredentials ??
        (() => Effect.succeed({ username: "openbot", password: "development-runtime-not-for-release" })),
      getDisplays: options.getRemoteDesktopDisplays,
      getIceServers:
        options.getRemoteDesktopIceServers ??
        (() => Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.host.iceServersMissing")) }))),
      ...(options.createRemoteDesktopRuntime ? { createRuntime: options.createRemoteDesktopRuntime } : {}),
      ...(logDirectory
        ? {
            onDiagnostic: (source: "sunshine" | "moonlight", message: string) => {
              Effect.runFork(appendRemoteDiagnosticLog(logDirectory, `remote-screen-${source}`, message));
            },
          }
        : {}),
      // The gateway owns the answer -- `getStatus` reads it there. This only says it changed, which is
      // what a member's failed attempt has to do to reach the host owner's open settings panel.
      onScreenRecordingDenied: () => this.emit("changed", this.getStatus()),
      audit: (event) => {
        if (options.logDirectory) {
          Effect.runFork(
            appendRemoteDiagnosticLog(options.logDirectory, "remote-screen", `${JSON.stringify(event)}\n`),
          );
        }
        if (
          event.event === "started" &&
          !this.#legacyCredentialRemoved &&
          options.removeLegacyRemoteDesktopCredential
        ) {
          this.#legacyCredentialRemoved = true;
          const remove = options.removeLegacyRemoteDesktopCredential;
          this.#dispatch(
            remove().pipe(
              Effect.catch(() =>
                Effect.sync(() => {
                  this.#legacyCredentialRemoved = false;
                }),
              ),
            ),
          );
        }
      },
    });
    this.#browserView = new BrowserViewGateway({
      browser: options.browser,
      authenticate: (token) => options.store.authenticate(token),
      onInput: () => {
        this.#lastBrowserViewInputAt = Date.now();
      },
    });
    const sendLiveActivityPush = options.sendLiveActivityPush;
    this.#liveActivityPush = sendLiveActivityPush
      ? new LiveActivityPushService({
          agents: options.agents,
          send: (push) => {
            const hostId = options.store.getIdentity()?.serverId;
            if (!hostId)
              return Effect.fail(
                new LiveActivitySendFailure({ cause: new Error(sourceText("error.auth.hostCredentialUnavailable")) }),
              );
            return sendLiveActivityPush(hostId, push).pipe(
              Effect.mapError(({ cause }) => new LiveActivitySendFailure({ cause })),
            );
          },
          randomBytes: (size) => new Uint8Array(randomBytes(size)),
          memberActive: (memberId) => {
            const member = options.store.getMember(memberId);
            return member !== null && !member.disabled;
          },
          logger,
        })
      : undefined;
    const tailscaleSetup = options.tailscaleSetup;
    this.#api = new TeamApiServer({
      appVersion: options.appVersion,
      store: options.store,
      agents: options.agents,
      channels: options.channels,
      mcpServers: options.mcpServers,
      mcpToolRuntimePreparation: options.mcpToolRuntimePreparation,
      storage: options.storage,
      hostedSites: options.hostedSites,
      events: options.events,
      agentImport: options.agentImport,
      // The identity route changes this host's name and logo through `updateIdentity`, so a change
      // from a joined admin runs every step a local one does.
      admin: {
        ...options.admin,
        identity: { updateIdentity: (input) => this.updateIdentity(input).pipe(Effect.asVoid) },
        tailscale: tailscaleSetup
          ? {
              status: () => tailscaleSetup.status(),
              setEnabled: (enabled) => tailscaleSetup.setEnabled(enabled),
              signIn: () => tailscaleSetup.signIn(),
            }
          : undefined,
      },
      skills: options.skills,
      sidebarLayout: options.sidebarLayout,
      mailbox: options.mailbox,
      browser: options.browser,
      browserView: this.#browserView,
      remoteScreen: this.#remoteScreen,
      redeemCentralTicket: options.redeemCentralTicket,
      chat: options.chat,
      onPresence: (snapshot) => this.emit("presence", snapshot),
      onDirectMessage: (event) => this.emit("directMessage", event),
      onDirectTyping: (event) => this.emit("directTyping", event),
      createInvite: (input) => this.createInvite(input),
      onSessionRevoked: (sessionId) => this.#revokeWebRtcSession(sessionId),
      liveActivityPush: this.#liveActivityPush,
      directEndpoint: options.tailscaleDirect
        ? {
            url: () => options.tailscaleDirect?.url() ?? null,
            refreshMembers: () => this.#refreshDirectMembers(),
          }
        : undefined,
    });
    options.tailscaleDirect?.attach({
      start: () => this.#api.startDirectListener(),
      stop: () => this.#api.stopDirectListener(),
    });
    this.#runtime = ManagedRuntime.make(
      Layer.succeed(
        HostApiRuntime,
        HostApiRuntime.of({
          start: () => this.#api.start(),
        }),
      ),
    );
    this.#webrtcGateway = options.teamWebRtcBridge
      ? new TeamWebRtcHostGateway({
          bridge: options.teamWebRtcBridge,
          store: options.store,
          appVersion: options.appVersion,
          transferDirectory: join(options.logDirectory ?? ".openbot-remote", "transfers"),
          renewSignal: (hostId) =>
            Effect.gen(function* () {
              const issueTicket = options.issueRemoteHostTicket;
              if (!issueTicket)
                return yield* new RemoteWorkflowError({
                  cause: new Error(sourceText("error.host.webRtcNotConfigured")),
                });
              return yield* issueTicket(hostId);
            }),
          onSignalRecoveryFailure: (error) => {
            this.#setStatus({
              phase: "error",
              apiOnline: false,
              message: error.message,
            });
          },
          closeSession: (sessionId) =>
            Effect.gen({ self: this }, function* () {
              this.#liveActivityPush?.remove(sessionId);
              yield* this.#remoteScreen.revokeTeamSession(sessionId);
              yield* this.#browserView.revokeTeamSession(sessionId);
            }),
          verifyClientTicket: options.verifyRemoteSessionTicket,
        })
      : null;
  }

  getStatus(): HostStatus {
    const capabilities = this.#remoteScreen.capabilities();
    return {
      ...this.#status,
      remoteDesktopReady: capabilities.ready,
      remoteDesktopScreenRecordingDenied: this.#remoteScreen.screenRecordingDenied(),
      remoteDesktopUnattended: capabilities.unattended,
      remoteDesktopActiveSessions: capabilities.activeSessions,
      remoteDesktopMaxSessions: capabilities.maxSessions,
    };
  }

  /**
   * Asks the screen sharing runtime again whether this computer lets it record the screen.
   *
   * The host owner is the only one who can give that grant, and until they can check it here the
   * warning they are shown outlives the repair that answered it.
   */
  checkRemoteDesktopSetup() {
    return this.#remoteScreen.checkSetup();
  }

  createLocalRemoteDesktopTestSession() {
    return this.#remoteScreen.createLocalTestSession();
  }

  testLocalRemoteDesktop(sessionId: string, action: "start" | "status" | "stop") {
    return this.#remoteScreen.testLocalSession(sessionId, action);
  }

  closeLocalRemoteDesktopTestSession(sessionId: string) {
    return this.#remoteScreen.closeLocalTestSession(sessionId);
  }

  readonly openRemoteDesktopSetup = Effect.fn("HostService.openRemoteDesktopSetup")(
    function* (this: HostService, action: RemoteDesktopSetupAction): Effect.fn.Return<void, RemoteWorkflowError> {
      const optionalOpenRemoteDesktopSetup = this.#options.openRemoteDesktopSetup;
      if (process.platform !== "darwin")
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("status.remote.setupMacOnly")) });
      const executable = this.#options.remoteDesktopRuntimePaths?.sunshine;
      if (!executable)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.runtimeNotInstalled")) });
      const appPath = dirname(dirname(dirname(executable)));
      if (!optionalOpenRemoteDesktopSetup)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.setupUnavailable")) });
      yield* optionalOpenRemoteDesktopSetup(action, appPath);
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly recheckScreenRecording = Effect.fn("HostService.recheckScreenRecording")(
    function* (this: HostService): Effect.fn.Return<HostStatus, RemoteWorkflowError> {
      yield* this.#remoteScreen.recheckScreenRecording();
      return this.getStatus();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  /**
   * Why the Team host half of this instance must not restart right now. A session still
   * connecting never blocks: only a connected stream, a live browser view, or a moving file
   * transfer holds the restart. Agent work is reported by AgentService, not here.
   */
  describeRestartBlockers(): string[] {
    const reasons: string[] = [];
    if (this.#remoteScreen.list().some((session) => session.phase === "connected")) {
      reasons.push("remote-desktop");
    }
    if (this.#browserView.activeViewCount() > 0) reasons.push("browser-view");
    if (this.#webrtcGateway?.hasActiveTransfers()) reasons.push("file-transfer");
    return reasons;
  }

  /**
   * Binds the host to the signed-in account, or unbinds it on sign-out. The status is
   * rebuilt from the newly active identity rather than patched, so a second account can
   * never inherit the first one's server name, id or launch preference.
   */
  /**
   * The synchronous half of an account change, for callers that announce the new account
   * before `applySignedInAccount` can finish: it stops this host answering for the previous
   * one right away. A process that has not applied an account yet is left alone - that is
   * startup reporting the account the file was already loaded for.
   */
  unbindChangedAccount(user: CentralAuthUser | null): void {
    const nextAccountId = user?.id ?? null;
    if (this.#boundAccountId === undefined || this.#boundAccountId === nextAccountId) return;
    if (!this.#options.store.configured) return;
    // A start still in flight belongs to the account on its way out. Bumping here rather
    // than waiting for the queued `applySignedInAccount` is what stops it reporting the
    // previous host online - or its failure as an error - on the new account's status.
    this.#runtimeGeneration += 1;
    this.#options.store.unbindActiveHost();
    this.#status = initialHostStatus(null, this.#options.unattended ?? false);
    this.emit("changed", this.getStatus());
  }

  readonly applySignedInAccount = Effect.fn("HostService.applySignedInAccount")(
    function* (this: HostService, user: CentralAuthUser | null): Effect.fn.Return<void, RemoteWorkflowError> {
      const nextAccountId = user?.id ?? null;
      // `unbindChangedAccount` may have cleared the store since this account was bound, to
      // stop it answering for an account that was on its way out. Reporting the same account
      // again then has to activate it, not take it for the host that is already running.
      const stillBound = this.#options.store.configured || nextAccountId === null;
      if (this.#boundAccountId === nextAccountId && stillBound) {
        // The same account, reported again - a renamed profile or a new avatar. Rebinding
        // here would stop a host that is happily online.
        if (user && this.#options.store.configured && (yield* this.#options.store.syncAccount(user))) {
          this.#api.refreshPresence();
        }
        return;
      }
      const previousServerId = this.#status.serverId;
      if (this.#boundAccountId !== undefined) {
        this.#runtimeGeneration += 1;
        // The same three steps as `stop`, and for the same reason: a start still in flight
        // belongs to the previous account. The bumped generation makes it abort at its next
        // checkpoint, and draining it here is what stops `start()` from handing the new
        // account that superseded operation instead of starting its own host. Each step is
        // attempted on its own, so a gateway that will not come down cannot skip the drain.
        yield* this.#attemptTeardown(this.#stopRuntime());
        yield* this.#attemptTeardown(this.#startOperation ? Fiber.join(this.#startOperation) : Effect.void);
        yield* this.#attemptTeardown(this.#stopRuntime());
      }
      let activated = false;
      return yield* Effect.gen({ self: this }, function* () {
        if (user && this.#signedInAccountId() !== user.id) {
          // Another account was announced while the runtime was being torn down. Binding this
          // one now would hand its host, members and invitations to whoever is signed in
          // instead - and the switch queued for them is what binds theirs.
          return;
        }
        if (user) yield* this.#options.store.activateAccount(user);
        else yield* this.#options.store.deactivate();
        activated = true;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            // Publish even when activation failed. The previous account is gone either way, and a
            // status still naming its host would offer the rail a server this process can no
            // longer answer for - the store has already unbound it.
            //
            // A failure leaves the binding unknown rather than recorded, so the next report of the
            // same account runs activation again instead of short-circuiting into an unconfigured
            // store the user cannot get out of without restarting.
            this.#boundAccountId = activated ? nextAccountId : undefined;
            this.#publishActiveHost(previousServerId);
          }),
        ),
      );
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  #publishActiveHost(previousServerId: string | null): void {
    const identity = this.#options.store.getIdentity();
    if (identity && identity.serverId === previousServerId) {
      // The host this process started with, now confirmed as this account's. Keep the
      // status the constructor already published rather than resetting a live runtime.
      this.#setStatus({
        configured: true,
        serverName: identity.serverName,
        logoUrl: identity.logoVersion ? serverLogoUrl(identity.logoVersion) : null,
        enabledOnLaunch: identity.enabledOnLaunch,
      });
    } else {
      this.#status = initialHostStatus(identity, this.#options.unattended ?? false);
      this.emit("changed", this.getStatus());
    }
    if (identity) {
      this.#api.refreshPresence();
      this.#api.refreshIdentity();
    }
  }

  getMobileConnectHost(): { hostId: string; fingerprint: string } | null {
    const identity = this.#options.store.getIdentity();
    return identity ? { hostId: identity.serverId, fingerprint: identity.fingerprint } : null;
  }

  readonly configure = Effect.fn("HostService.configure")(
    function* (this: HostService, input: ConfigureHostInput): Effect.fn.Return<HostStatus, RemoteWorkflowError> {
      const optionalRegisterRemoteHost = this.#options.registerRemoteHost;
      const optionalUpdateRemoteHostLogo = this.#options.updateRemoteHostLogo;
      const account = yield* remoteDecode(() => this.#options.getSignedInUser());
      const identity = yield* this.#options.store.configureWithAccount(input.serverName, account, input.logo);
      // Nothing is bound while the first host is being written, so neither the store's
      // `activeAccountId` nor `unbindChangedAccount` can see a switch announced during the
      // write. Central authentication has the new account the moment it is announced, which
      // is what the renderer was told, so that is what this is checked against.
      if (this.#signedInAccountId() !== account.id) {
        // The store bound the host as it created it, and refusing the call is not enough on
        // its own: the members and identity behind it would still answer the new account.
        this.#options.store.unbindActiveHost();
        this.#status = initialHostStatus(null, this.#options.unattended ?? false);
        this.emit("changed", this.getStatus());
        return yield* new RemoteWorkflowError({
          cause: new Error(sourceText("error.team.accountChangedDuringCreate")),
        });
      }
      // The store checked the account before it resolved; the switch can still land between
      // there and here, and publishing then would show A's server to B.
      if (!this.#isActiveHost(identity.serverId)) return this.getStatus();
      this.#setStatus({
        phase: "idle",
        configured: true,
        serverId: identity.serverId,
        serverName: identity.serverName,
        logoUrl: identity.logoVersion ? serverLogoUrl(identity.logoVersion) : null,
        enabledOnLaunch: false,
        message: null,
      });
      this.#api.refreshPresence();
      this.#api.refreshIdentity();
      const ownerMembershipId = yield* remoteDecode(() => this.#requiredOwnerMemberId());
      const attempt0 = yield* Effect.gen({ self: this }, function* () {
        if (!this.#isActiveHost(identity.serverId)) return this.getStatus();
        yield* optionalRegisterRemoteHost?.({
          hostId: identity.serverId,
          name: identity.serverName,
          ownerMembershipId,
          devicePublicKey: identity.publicKey,
        }) ?? Effect.succeed(undefined);
        if (input.logo !== undefined && this.#isActiveHost(identity.serverId)) {
          yield* optionalUpdateRemoteHostLogo?.(identity.serverId, input.logo ?? null, identity.logoVersion) ??
            Effect.succeed(undefined);
        }
        if (!this.#isActiveHost(identity.serverId)) return this.getStatus();
        this.#setStatus({
          apiUrl: null,
          message: sourceText("status.host.registered"),
        });
      }).pipe(Effect.result);
      if (Result.isFailure(attempt0)) {
        const error = attempt0.failure.cause;
        // A failure that arrives after another account signed in belongs to the host that is
        // gone, so it must not overwrite the status the new account is looking at.
        if (this.#isActiveHost(identity.serverId)) {
          this.#setStatus({
            phase: "error",
            message: error instanceof Error ? error.message : sourceText("error.host.reserveAddressFailed"),
          });
        }
      } else if (attempt0.success !== undefined) return attempt0.success;
      return this.getStatus();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly updateIdentity = Effect.fn("HostService.updateIdentity")(
    function* (this: HostService, input: UpdateHostIdentityInput): Effect.fn.Return<HostStatus, RemoteWorkflowError> {
      const optionalRegisterRemoteHost = this.#options.registerRemoteHost;
      const optionalUpdateRemoteHostLogo = this.#options.updateRemoteHostLogo;
      yield* remoteDecode(() => this.#options.store.assertOwnerAccount(this.#options.getSignedInUser()));
      const identity = yield* this.#options.store.updateIdentity(input);
      // Before anything is published: the store checked the account before it resolved, and a
      // switch landing in this gap would show the previous account's name and logo.
      if (!this.#isActiveHost(identity.serverId)) return this.getStatus();
      this.#setStatus({
        serverName: identity.serverName,
        logoUrl: identity.logoVersion ? serverLogoUrl(identity.logoVersion) : null,
        message: sourceText("status.host.identityUpdated"),
      });
      this.#api.refreshIdentity();
      const ownerMembershipId = yield* remoteDecode(() => this.#requiredOwnerMemberId());
      yield* optionalRegisterRemoteHost?.({
        hostId: identity.serverId,
        name: identity.serverName,
        ownerMembershipId,
        devicePublicKey: identity.publicKey,
      }) ?? Effect.succeed(undefined);
      if (input.logo !== undefined && this.#isActiveHost(identity.serverId)) {
        yield* optionalUpdateRemoteHostLogo?.(identity.serverId, input.logo ?? null, identity.logoVersion) ??
          Effect.succeed(undefined);
      }
      return this.getStatus();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  /**
   * Every remote step runs under the signed-in account's authentication, so one that started
   * for a host the account no longer has would register or upload on the wrong account's
   * behalf. The store's own guards stop the local half; this stops the network half.
   */
  /** The account central authentication has announced, or none while signed out. */
  #signedInAccountId(): string | null {
    try {
      return this.#options.getSignedInUser().id;
    } catch {
      return null;
    }
  }

  #assertStillActiveHost(serverId: string): void {
    if (!this.#isActiveHost(serverId)) {
      throw new Error(sourceText("error.host.accountChangedDuringUpdate"));
    }
  }

  #isActiveHost(serverId: string): boolean {
    return this.#options.store.getIdentity()?.serverId === serverId;
  }

  readonly start = Effect.fn("HostService.start")(function* (this: HostService) {
    if (this.#startOperation) return yield* Fiber.join(this.#startOperation);
    const operation = yield* Effect.forkIn(this.#provide(this.#startRuntimeOperation()), this.#runtime.scope, {
      startImmediately: false,
    });
    this.#startOperation = operation;
    operation.addObserver(() => {
      if (this.#startOperation === operation) this.#startOperation = null;
    });
    return yield* Fiber.join(operation);
  }).bind(this);

  readonly #startRuntimeOperation = Effect.fn("HostService.startRuntimeOperation")(function* (
    this: HostService,
  ): Effect.fn.Return<HostStatus, RemoteWorkflowError, HostApiRuntime> {
    const gateway = this.#webrtcGateway;
    const optionalRegisterRemoteHost = this.#options.registerRemoteHost;
    const optionalIssueRemoteHostTicket = this.#options.issueRemoteHostTicket;
    const optionalListRemoteMembers = this.#options.listRemoteMembers;
    if (!this.#options.store.configured)
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.nameBeforePublish")) });
    if ((this.#status.phase === "online" && this.#webRtcOnline) || this.#status.phase === "starting") {
      return this.getStatus();
    }
    if (this.#status.phase === "stopping") return this.getStatus();
    const generation = ++this.#runtimeGeneration;
    const signedInUser = yield* remoteDecode(() => this.#options.getSignedInUser());
    yield* remoteDecode(() => this.#options.store.assertOwnerAccount(signedInUser));
    if (yield* this.#options.store.syncAccount(signedInUser)) this.#api.refreshPresence();
    this.#setStatus({ phase: "starting", message: sourceText("status.host.starting") });

    const attempt1 = yield* Effect.gen({ self: this }, function* () {
      const apiPort = yield* HostApiRuntime.use((api) => api.start());
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      const identity = this.#options.store.getIdentity();
      if (!identity)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.nameBeforePublish")) });
      if (!gateway || !optionalRegisterRemoteHost || !optionalIssueRemoteHostTicket) {
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.webRtcNotConfigured")) });
      }
      yield* optionalRegisterRemoteHost({
        hostId: identity.serverId,
        name: identity.serverName,
        ownerMembershipId: yield* remoteDecode(() => this.#requiredOwnerMemberId()),
        devicePublicKey: identity.publicKey,
      });
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      if (this.#usesAccountDirectory() && optionalListRemoteMembers) {
        const members = yield* optionalListRemoteMembers(identity.serverId);
        yield* this.#options.store.syncRemoteDirectory(identity.serverId, members);
        if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      }
      const bootstrap = yield* optionalIssueRemoteHostTicket(identity.serverId);
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      yield* gateway.start({
        hostId: identity.serverId,
        signalUrl: bootstrap.signalUrl,
        ticket: bootstrap.ticket,
        localApiPort: apiPort,
      });
      this.#webRtcOnline = true;
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      this.#setStatus({
        apiUrl: bootstrap.signalUrl,
        apiOnline: true,
        message: sourceText("status.host.ready"),
      });
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      yield* this.#options.store.setEnabledOnLaunch(identity.serverId, true);
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      this.#setStatus({ phase: "online", enabledOnLaunch: true });
      // Not awaited: `tailscale serve` can take seconds, and the host is online without it.
      const tailscaleDirect = this.#options.tailscaleDirect;
      if (tailscaleDirect) this.#dispatch(tailscaleDirect.hostOnline());
    }).pipe(Effect.result);
    if (Result.isFailure(attempt1)) {
      const error = attempt1.failure.cause;
      if (generation !== this.#runtimeGeneration) {
        yield* this.#stopRuntime();
        return this.getStatus();
      }
      yield* this.#stopRuntime();
      this.#setStatus({
        phase: "error",
        apiOnline: false,
        apiUrl: null,
        message: error instanceof Error ? error.message : sourceText("error.host.publishFailed"),
      });
    } else if (attempt1.success !== undefined) return attempt1.success;
    return this.getStatus();
  });

  readonly startDevelopmentLocal = Effect.fn("HostService.startDevelopmentLocal")(
    function* (this: HostService): Effect.fn.Return<HostStatus, RemoteWorkflowError, HostApiRuntime> {
      if (!this.#options.store.configured)
        return yield* new RemoteWorkflowError({
          cause: new Error("Name this OpenBot before starting local development."),
        });
      if (this.#status.phase === "online") return this.getStatus();
      const apiPort = yield* HostApiRuntime.use((api) => api.start());
      this.#setStatus({
        phase: "online",
        apiUrl: `http://localhost:${apiPort}`,
        apiOnline: true,
        message: "Local development host is ready.",
      });
      return this.getStatus();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  // Where this host's Team API listens on this machine, which is not what `#status.apiUrl` reports:
  // that is how a member reaches the host, and for a published one it is the Signal service.
  #localApiUrl(): string | null {
    return this.#api.port === null ? null : `http://localhost:${this.#api.port}`;
  }

  readonly createDevelopmentConnection = Effect.fn("HostService.createDevelopmentConnection")(
    function* (this: HostService): Effect.fn.Return<
      {
        serverId: string;
        serverName: string;
        apiUrl: string;
        fingerprint: string;
        publicKey: string;
        username: string;
        sessionToken: string;
      },
      RemoteWorkflowError,
      HostApiRuntime
    > {
      const identity = this.#options.store.getIdentity();
      const apiUrl = this.#localApiUrl();
      if (!identity || !apiUrl)
        return yield* new RemoteWorkflowError({ cause: new Error("The local development host is not ready.") });
      const username = DEVELOPMENT_REMOTE_CLIENT_USERNAME;
      const password = "openbot-local-development-client";
      const authenticated = yield* this.#options.store.login(username, password).pipe(
        Effect.catch(() =>
          Effect.gen({ self: this }, function* () {
            // Before a development host kept its members in its own team file, publishing reconciled them
            // against the control plane, and that disabled the technical client -- it is password-only,
            // owned by no account. `login` skips a disabled member and `acceptInvite` refuses a username
            // that already exists, so a profile published then fails here. Replacing the member lets such
            // a profile recover: it is a fixture, and nothing outside this file reads it.
            const existing = this.#options.store.listMembers().find((member) => member.username === username);
            if (existing && existing.role !== "owner") yield* this.#options.store.removeMember(existing.id);
            const invite = yield* this.#options.store.createInvite("member");
            return yield* this.#options.store.acceptInvite(invite.token, username, password);
          }),
        ),
      );
      this.#api.refreshPresence();
      return {
        serverId: identity.serverId,
        serverName: identity.serverName,
        apiUrl,
        fingerprint: identity.fingerprint,
        publicKey: identity.publicKey,
        username,
        sessionToken: authenticated.sessionToken,
      };
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly stop = Effect.fn("HostService.stop")(
    function* (this: HostService, persistPreference = true): Effect.fn.Return<HostStatus, RemoteWorkflowError> {
      if (this.#status.phase === "unconfigured") return this.getStatus();
      const serverId = this.#options.store.getIdentity()?.serverId;
      this.#runtimeGeneration += 1;
      if (persistPreference)
        yield* remoteDecode(() => this.#options.store.assertOwnerAccount(this.#options.getSignedInUser()));
      this.#setStatus({ phase: "stopping", message: sourceText("status.host.stopping") });
      yield* this.#stopRuntime();
      if (this.#startOperation) yield* Fiber.join(this.#startOperation);
      yield* this.#stopRuntime();
      // The awaits above can outlive this host. An account switch in between makes both the
      // preference and the status below the previous account's, and the account that just
      // became active already has its own status from `applySignedInAccount`.
      if (this.#options.store.getIdentity()?.serverId !== serverId) return this.getStatus();
      if (persistPreference && serverId) yield* this.#options.store.setEnabledOnLaunch(serverId, false);
      this.#setStatus({
        phase: "idle",
        enabledOnLaunch: persistPreference ? false : this.#status.enabledOnLaunch,
        apiUrl: null,
        apiOnline: false,
        message: sourceText("status.host.private"),
      });
      return this.getStatus();
    },
    (operation, _persistPreference?: boolean) => this.#provide(operation),
  ).bind(this);

  readonly listMembers = Effect.fn("HostService.listMembers")(
    function* (this: HostService) {
      const hostId = this.#options.store.getIdentity()?.serverId;
      if (hostId && this.#usesAccountDirectory() && this.#options.listRemoteMembers) {
        const list = this.#options.listRemoteMembers;

        const members = yield* list(hostId);
        // An account switch while the directory loaded makes this list the previous
        // account's. Answer with the now-active host's own members rather than failing a
        // read with the store's cross-account guard.
        if (!this.#isActiveHost(hostId)) return this.#options.store.listMembers();
        yield* this.#options.store.syncRemoteDirectory(hostId, members);
        // Recording the directory is a write, and the switch can land during it. The names,
        // addresses and roles below are the previous account's if it did.
        if (!this.#isActiveHost(hostId)) return this.#options.store.listMembers();
        return members.map((member) => ({
          id: member.membershipId,
          username: member.email,
          email: member.email,
          name: member.name,
          avatarUrl: member.avatarUrl,
          role: member.role,
          createdAt: new Date(member.createdAt).toISOString(),
          disabled: member.status !== "active",
        }));
      }
      return this.#options.store.listMembers();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  getPresence(): TeamPresenceSnapshot {
    return this.#api.getPresence();
  }

  connectedClientCount(): number {
    return this.#api.connectedClientCount();
  }

  /** The last request that changed data, typing, or input in a browser view. */
  lastClientUseAt(): number | null {
    const request = this.#api.lastClientUseAt();
    const view = this.#lastBrowserViewInputAt;
    if (request === null || view === null) return request ?? view;
    return Math.max(request, view);
  }

  announceRestart(state: HostRestartState, version: string | null): void {
    this.#api.announceHostRestart(state, version);
  }

  setTyping(input: SetTeamTypingInput): void {
    this.#api.setLocalTyping(input.agentId, input.typing);
  }

  readAgentConversation(agentId: string) {
    return remoteDecode(() => this.#currentAgentReaderId()).pipe(
      Effect.flatMap((readerId) => this.#options.agents.readConversationFor(agentId, readerId)),
    );
  }

  readAgentConversationPage(agentId: string, anchor: ConversationPageAnchor = { type: "latest" }, limit = 50) {
    return remoteDecode(() => this.#currentAgentReaderId()).pipe(
      Effect.flatMap((readerId) => this.#options.agents.readConversationPageFor(agentId, readerId, anchor, limit)),
    );
  }

  searchAgentConversationMessages(query: string, agentId?: string, cursor?: string, limit = 100) {
    return this.#options.agents.searchConversationMessages(query, agentId, cursor, limit);
  }

  searchAgentConversationFiles(query: string, cursor?: string, limit = 50) {
    return this.#options.agents.searchConversationFiles(query, cursor, limit);
  }

  listAgentConversationReads() {
    return this.#options.agents.listConversationReads(this.#currentAgentReaderId());
  }

  markAgentConversationRead(input: MarkConversationReadInput) {
    return remoteDecode(() => this.#currentAgentReaderId()).pipe(
      Effect.flatMap((readerId) =>
        this.#options.agents.markConversationRead(input.agentId, readerId, input.throughMessageId),
      ),
    );
  }

  listDirectThreads(): DirectThreadSummary[] {
    if (!this.#options.store.configured) return [];
    const memberId = this.#findCurrentMemberId();
    return memberId ? this.#api.listDirectThreads(memberId) : [];
  }

  readDirectConversation(memberId: string): DirectConversationSnapshot {
    return this.#api.readDirectConversation(this.#currentMemberId(), memberId);
  }

  readDirectConversationPage(
    memberId: string,
    anchor: DirectConversationPageAnchor = { type: "latest" },
    limit = 50,
  ): DirectConversationPage {
    return this.#api.readDirectConversationPage(this.#currentMemberId(), memberId, anchor, limit);
  }

  sendDirectMessage(input: SendDirectMessageInput) {
    return this.#api.sendDirectMessage(this.#currentMemberId(), input);
  }

  markDirectRead(input: MarkDirectReadInput) {
    return this.#api.markDirectRead(this.#currentMemberId(), input.memberId, input.throughSequence);
  }

  setDirectTyping(input: DirectTypingInput): void {
    this.#api.setLocalDirectTyping(this.#currentMemberId(), input.memberId, input.typing);
  }

  readonly listInvites = Effect.fn("HostService.listInvites")(
    function* (this: HostService) {
      const hostId = this.#options.store.getIdentity()?.serverId;
      if (hostId && this.#remoteInviteApiUrl() && this.#options.listRemoteInvites) {
        const list = this.#options.listRemoteInvites;

        const invites = yield* list(hostId);
        // As in `listMembers`: a switch while the directory loaded makes these the previous
        // account's invitations, their email addresses included. Answer with the now-active
        // host's own rather than handing them to whoever is signed in.
        if (!this.#isActiveHost(hostId)) return this.#options.store.listInvites();
        return invites
          .filter((invite) => invite.revokedAt === null)
          .map((invite) => ({
            id: invite.inviteId,
            role: invite.role,
            email: invite.email,
            expiresAt: new Date(invite.expiresAt).toISOString(),
            usedAt: invite.usedAt === null ? null : new Date(invite.usedAt).toISOString(),
            permanent: invite.permanent,
            useCount: invite.useCount,
          }));
      }
      return this.#options.store.listInvites();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  listSessions(): TeamSessionSummary[] {
    return this.#options.store.listSessions();
  }

  readonly updateMember = Effect.fn("HostService.updateMember")(
    function* (
      this: HostService,
      input: UpdateTeamMemberInput,
    ): Effect.fn.Return<TeamMemberSummary, RemoteWorkflowError> {
      const optionalListRemoteMembers = this.#options.listRemoteMembers;
      const optionalUpdateRemoteMember = this.#options.updateRemoteMember;
      const optionalRemoveRemoteMember = this.#options.removeRemoteMember;
      const hostId = this.#options.store.getIdentity()?.serverId;
      if (
        hostId &&
        this.#usesAccountDirectory() &&
        optionalUpdateRemoteMember &&
        optionalRemoveRemoteMember &&
        optionalListRemoteMembers
      ) {
        const current = (yield* optionalListRemoteMembers(hostId)).find(
          (member) => member.membershipId === input.memberId,
        );
        if (!current || current.role === "owner")
          return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.memberNotFound")) });
        // The directory read is a round trip, and the account can change during it. Mutating
        // the previous account's host with the new account's authorization is what this guard
        // stops; the same check runs again before the result is written back.
        yield* remoteDecode(() => this.#assertStillActiveHost(hostId));
        const role = input.role ?? current.role;
        if (input.disabled) yield* optionalRemoveRemoteMember(hostId, input.memberId);
        else yield* optionalUpdateRemoteMember(hostId, input.memberId, role, input.disabled === false);
        yield* remoteDecode(() => this.#assertStillActiveHost(hostId));
        const members = yield* optionalListRemoteMembers(hostId);
        const updated = members.find((member) => member.membershipId === input.memberId);
        if (!updated)
          return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.memberNotFound")) });
        yield* this.#options.store.syncRemoteDirectory(hostId, members);
        // Recording the directory is a write too, so the switch can land inside it and the
        // member below would be the previous account's.
        yield* remoteDecode(() => this.#assertStillActiveHost(hostId));
        return {
          id: updated.membershipId,
          username: updated.email,
          email: updated.email,
          name: updated.name,
          avatarUrl: updated.avatarUrl,
          role: updated.role,
          createdAt: new Date(updated.createdAt).toISOString(),
          disabled: updated.status !== "active",
        };
      }
      const member = yield* this.#options.store.updateMember(input.memberId, {
        ...(input.role ? { role: input.role } : {}),
        ...(input.disabled === undefined ? {} : { disabled: input.disabled }),
      });
      if (member.disabled) yield* this.#remoteScreen.revokeMember(member.id);
      this.#api.refreshPresence();
      return member;
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly removeMember = Effect.fn("HostService.removeMember")(
    function* (this: HostService, memberId: string): Effect.fn.Return<void, RemoteWorkflowError> {
      const optionalListRemoteMembers = this.#options.listRemoteMembers;
      const optionalRemoveRemoteMember = this.#options.removeRemoteMember;
      const hostId = this.#options.store.getIdentity()?.serverId;
      if (hostId && this.#usesAccountDirectory() && optionalRemoveRemoteMember) {
        yield* optionalRemoveRemoteMember(hostId, memberId);
        if (optionalListRemoteMembers) {
          const members = yield* optionalListRemoteMembers(hostId);
          yield* this.#options.store.syncRemoteDirectory(hostId, members);
        }
        return;
      }
      yield* this.#options.store.removeMember(memberId);
      yield* this.#remoteScreen.revokeMember(memberId);
      this.#api.refreshPresence();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly revokeSession = Effect.fn("HostService.revokeSession")(
    function* (this: HostService, sessionId: string): Effect.fn.Return<void, RemoteWorkflowError> {
      yield* this.#revokeWebRtcSession(sessionId);
      yield* this.#options.store.revokeSession(sessionId);
      yield* this.#remoteScreen.revokeTeamSession(sessionId);
      yield* this.#browserView.revokeTeamSession(sessionId);
      this.#api.refreshPresence();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly #revokeWebRtcSession = Effect.fn("HostService.revokeWebRtcSession")(function* (
    this: HostService,
    sessionId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    this.#liveActivityPush?.remove(sessionId);
    const end = this.#options.endRemoteSession;
    const gateway = this.#webrtcGateway;
    yield* Effect.all([end ? end(sessionId) : Effect.void, gateway ? gateway.revokeSession(sessionId) : Effect.void], {
      concurrency: "unbounded",
    });
  });

  /**
   * Whether members and invitations live in the account directory. A local development host keeps
   * them in its own team file, so every read and write of them goes where the others went.
   */
  readonly getTailscaleStatus = Effect.fn("HostService.getTailscaleStatus")(function* (this: HostService) {
    const tailscale = this.#options.tailscaleDirect;
    if (!tailscale)
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.tailscaleUnavailable")) });
    return yield* tailscale.status();
  });

  /** Only the owner account of this host turns the direct path on or off, as it starts and stops the host. */
  readonly setTailscaleDirect = Effect.fn("HostService.setTailscaleDirect")(function* (
    this: HostService,
    enabled: boolean,
  ) {
    const tailscale = this.#options.tailscaleDirect;
    if (!tailscale)
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.tailscaleUnavailable")) });
    yield* remoteDecode(() => this.#options.store.assertOwnerAccount(this.#options.getSignedInUser()));
    return yield* tailscale.setEnabled(enabled);
  });

  readonly openTailscale = Effect.fn("HostService.openTailscale")(function* (this: HostService) {
    const tailscale = this.#options.tailscaleDirect;
    const open = this.#options.openTailscale;
    if (!tailscale || !open) return;
    const status = yield* tailscale.status();
    yield* open(status.state !== "not-installed");
  });

  /**
   * Reads the account directory again before a direct Tailscale sign-in, so a member that the account
   * service removed is not signed in from the copy of the last start.
   */
  #refreshDirectMembers(): Effect.Effect<void, RemoteWorkflowError> {
    return Effect.gen({ self: this }, function* () {
      const hostId = this.#options.store.getIdentity()?.serverId;
      const list = this.#options.listRemoteMembers;
      if (!hostId || !this.#usesAccountDirectory() || !list) return;
      const members = yield* list(hostId);
      if (!this.#isActiveHost(hostId)) return yield* new RemoteWorkflowError({ cause: new Error("Host changed.") });
      yield* this.#options.store.syncRemoteDirectory(hostId, members);
    });
  }

  #usesAccountDirectory(): boolean {
    return !this.#options.localDevelopmentHost;
  }

  /** The account directory that holds invitations, or `null` for this machine's own team file. */
  #remoteInviteApiUrl(): string | null {
    return this.#usesAccountDirectory() ? this.#options.remoteControlPlaneUrl || null : null;
  }

  revokeInvite(inviteId: string) {
    if (this.#remoteInviteApiUrl() && this.#options.revokeRemoteInvite)
      return this.#options.revokeRemoteInvite(inviteId);
    return this.#options.store.revokeInvite(inviteId);
  }

  readonly createInvite = Effect.fn("HostService.createInvite")(
    function* (this: HostService, input: CreateTeamInviteInput): Effect.fn.Return<InviteSummary, RemoteWorkflowError> {
      const optionalCreateRemoteInvite = this.#options.createRemoteInvite;
      const optionalRevokeRemoteInvite = this.#options.revokeRemoteInvite;
      const identity = this.#options.store.getIdentity();
      if (!identity)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.nameBeforePublish")) });
      const remoteInviteApiUrl = this.#remoteInviteApiUrl();
      if (remoteInviteApiUrl && optionalCreateRemoteInvite) {
        // The account service cannot email links for a self-hosted service.
        if (input.email && selfHostedApiOrigin(remoteInviteApiUrl))
          return yield* new RemoteWorkflowError({
            cause: new Error(sourceText("error.remote.selfHostedInviteNoEmail")),
          });
        const invite = yield* optionalCreateRemoteInvite(identity.serverId, input);
        // The invitation belongs to the account that asked for it, so it stays on that host
        // and shows up in its invite list. What must not happen is emailing it under the new
        // account's authorization, or handing it back to the renderer the new account sees.
        yield* remoteDecode(() => this.#assertStillActiveHost(identity.serverId));
        const inviteUrl = yield* remoteDecode(() =>
          createInviteUrl(
            {
              apiUrl: remoteInviteApiUrl,
              serverId: identity.serverId,
              fingerprint: identity.fingerprint,
              token: invite.token,
            },
            { selfHostedApiOrigin: selfHostedApiOrigin(remoteInviteApiUrl) },
          ),
        );
        const result: InviteSummary = {
          id: invite.inviteId,
          role: input.role,
          expiresAt: new Date(invite.expiresAt).toISOString(),
          usedAt: null,
          inviteUrl,
          email: input.email ?? null,
          permanent: invite.permanent,
          useCount: invite.useCount,
        };
        if (input.email) {
          const email = input.email;
          const attempt4 = yield* Effect.gen({ self: this }, function* () {
            yield* this.#options.sendTeamInviteEmail({
              email,
              serverName: identity.serverName,
              inviteUrl,
              role: input.role,
            });
          }).pipe(Effect.result);
          if (Result.isFailure(attempt4)) {
            const error = attempt4.failure.cause;
            // Revoking spends authorization on a host, so it only happens while that host is
            // still this account's. Otherwise the invitation stays for the account that owns it.
            if (this.#isActiveHost(identity.serverId))
              yield* optionalRevokeRemoteInvite?.(invite.inviteId) ?? Effect.succeed(undefined);
            return yield* new RemoteWorkflowError({ cause: error });
          }
        }
        // Sending is a round trip of its own, and the link must not come back to a renderer
        // that has meanwhile been told about another account.
        yield* remoteDecode(() => this.#assertStillActiveHost(identity.serverId));
        return result;
      }
      // This branch mints a link to this machine's own Team API, so it asks the server where it
      // listens rather than reading the status. They are the same URL for a host that is private or
      // local-development, and for a published one the status carries the Signal service's `ws://`
      // address -- which `createInviteUrl` rejects, so a developer who had published this host could
      // not create an invite at all.
      const localApiUrl = this.#localApiUrl();
      if (!localApiUrl)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.publishBeforeInvite")) });
      const invite = yield* this.#options.store.createInvite(input.role, input.email, { permanent: input.permanent });
      const inviteUrl = createInviteUrl(
        {
          apiUrl: localApiUrl,
          serverId: identity.serverId,
          fingerprint: identity.fingerprint,
          token: invite.token,
        },
        { allowLocalDevelopmentApiUrl: this.#options.localDevelopmentHost },
      );
      const result: InviteSummary = {
        id: invite.id,
        role: input.role,
        expiresAt: invite.expiresAt,
        usedAt: null,
        inviteUrl,
        email: invite.email,
        permanent: invite.permanent,
        useCount: invite.useCount,
      };
      if (invite.email) {
        const email = invite.email;
        const attempt3 = yield* Effect.gen({ self: this }, function* () {
          yield* this.#options.sendTeamInviteEmail({
            email,
            serverName: identity.serverName,
            inviteUrl: result.inviteUrl,
            role: input.role,
          });
        }).pipe(Effect.result);
        if (Result.isFailure(attempt3)) {
          const error = attempt3.failure.cause;
          yield* this.#options.store.revokeInvite(invite.id);
          return yield* new RemoteWorkflowError({ cause: error });
        }
      }
      return result;
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  #provide<A>(operation: Effect.Effect<A, RemoteWorkflowError, HostApiRuntime>): Effect.Effect<A, RemoteWorkflowError> {
    return Effect.suspend(() => {
      const completed = Deferred.makeUnsafe<void>();
      this.#operations.add(completed);
      return Effect.flatMap(this.#runtime.contextEffect, (context) =>
        operation.pipe(Effect.provideContext(context)),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#operations.delete(completed);
            Deferred.doneUnsafe(completed, Effect.void);
          }),
        ),
      );
    });
  }

  // Native audit callbacks own these background operations; shutdown drains them.
  #dispatch(operation: Effect.Effect<void, RemoteWorkflowError>): void {
    this.#runtime.runFork(this.#provide(operation));
  }

  readonly shutdown = Effect.fn("HostService.shutdown")(function* (this: HostService) {
    if (this.#shutdown) return yield* Deferred.await(this.#shutdown);
    const stopped = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#shutdown = stopped;
    return yield* Effect.acquireUseRelease(
      Effect.void,
      () => this.stop(false).pipe(Effect.asVoid),
      () =>
        Effect.acquireUseRelease(
          Effect.void,
          () => this.#webrtcGateway?.dispose() ?? Effect.void,
          () =>
            Effect.gen({ self: this }, function* () {
              while (this.#operations.size > 0) {
                yield* Effect.all([...this.#operations].map(Deferred.await), { concurrency: "unbounded" });
              }
              yield* this.#runtime.disposeEffect;
            }),
        ),
    ).pipe(Effect.onExit((exit) => Effect.sync(() => Deferred.doneUnsafe(stopped, exit))));
  }, Effect.uninterruptible).bind(this);

  /** Keep later teardown steps running so an account switch cannot retain the old listener. */
  #attemptTeardown<A>(step: Effect.Effect<A, RemoteWorkflowError>): Effect.Effect<void> {
    return step.pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          logger.error("Unable to stop the host runtime while switching accounts:", toLogValue(Cause.squash(cause)));
        }),
      ),
    );
  }

  readonly #stopRuntime = Effect.fn("HostService.stopRuntime")(function* (this: HostService) {
    this.#webRtcOnline = false;
    if (this.#options.tailscaleDirect) yield* this.#options.tailscaleDirect.hostOffline();
    // The phones register again when they connect to the next runtime.
    const pendingPushes = yield* Effect.forkChild(this.#liveActivityPush?.dispose() ?? Effect.void);
    return yield* Effect.acquireUseRelease(
      Effect.void,
      () => this.#webrtcGateway?.stop() ?? Effect.void,
      () => this.#api.stop().pipe(Effect.ensuring(Fiber.await(pendingPushes))),
    );
  }, Effect.uninterruptible);

  readonly #cancelSupersededStartEffect = Effect.fn("HostService.cancelSupersededStart")(function* (
    this: HostService,
    generation: number,
  ): Effect.fn.Return<boolean, RemoteWorkflowError> {
    if (generation === this.#runtimeGeneration) return false;
    yield* this.#stopRuntime();
    return true;
  });

  #setStatus(patch: Partial<HostStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.emit("changed", this.getStatus());
  }

  #currentMemberId(): string {
    const memberId = this.#findCurrentMemberId();
    if (!memberId) throw new Error(sourceText("error.host.teamAccessUnavailable"));
    return memberId;
  }

  channelActor(): { id: string; name: string } {
    let user: CentralAuthUser;
    try {
      user = this.#options.getSignedInUser();
    } catch {
      return { id: SIGNED_OUT_CHANNEL_MEMBER_ID, name: "You" };
    }
    return { id: this.#currentAgentReaderId(), name: user.name ?? "You" };
  }

  /**
   * The host user as the sender of an agent message. Signed out there is none: a message with no
   * sender is the reader's own, and the signed-out id would name this person as someone else to the
   * members of a team they host later.
   */
  conversationSender(): ConversationMessageSender | undefined {
    let user: CentralAuthUser;
    try {
      user = this.#options.getSignedInUser();
    } catch {
      return undefined;
    }
    return conversationMessageSender(this.#currentAgentReaderId(), user.name?.trim() || user.email);
  }

  #currentAgentReaderId(): string {
    const accountReaderId = `local-user:${this.#options.getSignedInUser().id}`;
    const memberId = this.#findCurrentMemberId();
    // Channel reads are keyed by the reader id this method answers, so they adopt with it.
    if (!memberId) {
      this.#options.channels?.store.adoptReads(SIGNED_OUT_CHANNEL_MEMBER_ID, accountReaderId);
      return accountReaderId;
    }
    this.#options.agents.adoptConversationReads(accountReaderId, memberId);
    this.#options.channels?.store.adoptReads(accountReaderId, memberId);
    this.#options.channels?.store.adoptReads(SIGNED_OUT_CHANNEL_MEMBER_ID, memberId);
    return memberId;
  }

  #findCurrentMemberId(): string | null {
    try {
      const email = this.#options.getSignedInUser().email.trim().toLowerCase();
      const member = this.#options.store
        .listMembers()
        .find(
          (candidate) =>
            candidate.email?.trim().toLowerCase() === email || candidate.username.trim().toLowerCase() === email,
        );
      return member && !member.disabled ? member.id : null;
    } catch {
      return null;
    }
  }

  #requiredOwnerMemberId(): string {
    const memberId = this.#options.store.getOwnerMemberId();
    if (!memberId) throw new Error(sourceText("error.host.ownerIdentityUnavailable"));
    return memberId;
  }
}

function initialHostStatus(identity: TeamIdentity | null, unattended: boolean): HostStatus {
  return {
    phase: identity ? "idle" : "unconfigured",
    configured: Boolean(identity),
    enabledOnLaunch: identity?.enabledOnLaunch ?? false,
    serverId: identity?.serverId ?? null,
    serverName: identity?.serverName ?? null,
    logoUrl: identity?.logoVersion ? serverLogoUrl(identity.logoVersion) : null,
    apiUrl: null,
    apiOnline: false,
    remoteDesktopReady: false,
    remoteDesktopScreenRecordingDenied: false,
    remoteDesktopUnattended: unattended,
    remoteDesktopActiveSessions: 0,
    remoteDesktopMaxSessions: 4,
    message: null,
  };
}

function serverLogoUrl(version: string): string {
  return `openbot-server-logo://local/logo?v=${encodeURIComponent(version)}`;
}

function normalizeRemoteDesktopPlatform(platform: NodeJS.Platform): "darwin" | "win32" | "linux" {
  if (platform === "darwin" || platform === "win32") return platform;
  return "linux";
}
