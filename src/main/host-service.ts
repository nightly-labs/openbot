import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import type { HostKeyHandover } from "@openbot/contracts/host-key-handover";
import { createInviteUrl, selfHostedApiOrigin } from "@openbot/contracts/invite-links";
import type {
  AgentEvent,
  AgentTaskReadState,
  AvatarImageInput,
  CentralAuthUser,
  ChannelSummary,
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
  MarkAgentTaskReadInput,
  MarkConversationReadInput,
  MarkDirectReadInput,
  RemoteDesktopDisplay,
  RemoteDesktopIceServer,
  RemoteDesktopSetupAction,
  SendDirectMessageInput,
  SetTeamTypingInput,
  TeamMemberSummary,
  TeamPresenceSnapshot,
  TeamRole,
  TeamSessionSummary,
  UpdateHostIdentityInput,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import { type AgentAccessLevel, conversationMessageSender, SIGNED_OUT_CHANNEL_MEMBER_ID } from "@openbot/contracts/ipc";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import type { HostRestartState } from "@openbot/contracts/team-protocol/host-update-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Cause, Context, Deferred, Effect, Fiber, Layer, ManagedRuntime, Result, Semaphore } from "effect";
import type { AgentService } from "../backend/agent-service";
import type { ChannelService } from "../backend/channel-service";
import type { TeamChatStore } from "../backend/team-chat-store";
import type { AgentAccessStore } from "./agent-access-store";
import { BrowserViewGateway } from "./browser-view-gateway";
import type { VerifiedRemoteSessionTicket } from "./central-auth-manager";
import { LiveActivityPushService, LiveActivitySendFailure } from "./live-activity-push";
import type { PushNotificationStore } from "./push-notification-store";
import {
  type NotificationRelayRequest,
  PushNotificationSendFailure,
  PushNotificationService,
} from "./push-notifications";
import type { RemoteDesktopRuntimePaths } from "./remote-desktop-runtime-artifact";
import { appendRemoteDiagnosticLog } from "./remote-diagnostics";
import { RemoteScreenGateway, type RemoteScreenGatewayCreateRuntime } from "./remote-screen-gateway";
import { RemoteWorkflowError, remoteDecode } from "./remote-service-effects";
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
  mcpSignIns?: ForwardedApiOptions["mcpSignIns"];
  signInRelay?: ForwardedApiOptions["signInRelay"];
  connectors?: ForwardedApiOptions["connectors"];
  onePasswordConnector?: ForwardedApiOptions["onePasswordConnector"];
  bitwardenConnector?: ForwardedApiOptions["bitwardenConnector"];
  vault?: ForwardedApiOptions["vault"];
  providerHostSignIns?: ForwardedApiOptions["providerHostSignIns"];
  providerAccounts?: ForwardedApiOptions["providerAccounts"];
  providerUsageResets?: ForwardedApiOptions["providerUsageResets"];
  providerSignOut?: ForwardedApiOptions["providerSignOut"];
  mcpToolRuntimePreparation?: ForwardedApiOptions["mcpToolRuntimePreparation"];
  storage?: ForwardedApiOptions["storage"];
  machine?: ForwardedApiOptions["machine"];
  hostedSites?: ForwardedApiOptions["hostedSites"];
  events?: ForwardedApiOptions["events"];
  agentImport?: ForwardedApiOptions["agentImport"];
  instanceTransfer?: ForwardedApiOptions["instanceTransfer"];
  routineFlows?: ForwardedApiOptions["routineFlows"];
  workflows?: ForwardedApiOptions["workflows"];
  hiddenAgents?: ForwardedApiOptions["hiddenAgents"];
  agentAccess?: AgentAccessStore;
  agentTasks?: ForwardedApiOptions["agentTasks"];
  browserProfiles?: ForwardedApiOptions["browserProfiles"];
  admin?: ForwardedApiOptions["admin"];
  focusUse?: ForwardedApiOptions["focusUse"];
  appVersion: string;
  store: TeamStore;
  agents: ForwardedApiOptions["agents"] & Pick<AgentService, "adoptConversationReads" | "markTaskRead">;
  agentsReady: NonNullable<ForwardedApiOptions["agentsReady"]>;
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
  /** Puts a remote desktop member's pasted text on this computer's clipboard. */
  writeRemoteDesktopClipboard?: (text: string) => void;
  platform?: "darwin" | "win32" | "linux";
  unattended?: boolean;
  teamWebRtcBridge?: TeamWebRtcBridge;
  /** Whether devices may connect to this computer only over a private network, such as Tailscale. */
  privateNetwork?: () => boolean;
  registerRemoteHost?: (input: {
    hostId: string;
    name: string;
    ownerMembershipId: string;
    devicePublicKey?: string | null;
  }) => Effect.Effect<unknown, RemoteWorkflowError>;
  /**
   * Sends a signed key handover to the account service. `refused` means the account service has
   * another key for this host, so the handover can never apply.
   */
  handOverRemoteHostKey?: (
    hostId: string,
    handover: HostKeyHandover,
  ) => Effect.Effect<"accepted" | "refused", RemoteWorkflowError>;
  issueRemoteHostTicket?: (
    hostId: string,
  ) => Effect.Effect<{ ticket: string; signalUrl: string; expiresAt: number }, RemoteWorkflowError>;
  /** Sends one sealed Live Activity update through the account service. `gone` means Apple refused the token. */
  sendLiveActivityPush?: (
    hostId: string,
    push: LiveActivityRelayPush,
  ) => Effect.Effect<"sent" | "gone", RemoteWorkflowError>;
  /** Sends one sealed notification through the account service. `gone` means the phone gets no more. */
  sendPushNotification?: (
    hostId: string,
    request: NotificationRelayRequest,
  ) => Effect.Effect<"sent" | "gone", RemoteWorkflowError>;
  /** The phones that get notifications, kept for the next start. */
  pushNotificationStore?: PushNotificationStore;
  /** Whether the owner uses the desktop app on this computer now and sees the event there, so the owner's phone stays quiet. */
  hostComputerInUse?: (event: AgentEvent) => boolean;
  verifyRemoteSessionTicket?: (ticket: string) => Effect.Effect<VerifiedRemoteSessionTicket, RemoteWorkflowError>;
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
  readonly #pushNotifications: PushNotificationService | undefined;
  #status: HostStatus;
  #runtimeGeneration = 0;
  #startOperation: Fiber.Fiber<HostStatus, RemoteWorkflowError> | null = null;
  /** A registration and a key rotation each read the host key, so only one of them runs at a time. */
  readonly #hostKeyLock = Semaphore.makeUnsafe(1);
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
      ...(options.getRemoteDesktopDisplays ? { getDisplays: options.getRemoteDesktopDisplays } : {}),
      getIceServers:
        options.getRemoteDesktopIceServers ??
        (() => Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.host.iceServersMissing")) }))),
      ...(options.createRemoteDesktopRuntime ? { createRuntime: options.createRemoteDesktopRuntime } : {}),
      ...(options.writeRemoteDesktopClipboard ? { writeClipboard: options.writeRemoteDesktopClipboard } : {}),
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
    const sendPushNotification = options.sendPushNotification;
    const pushNotificationStore = options.pushNotificationStore;
    this.#pushNotifications =
      sendPushNotification && pushNotificationStore
        ? new PushNotificationService({
            agents: options.agents,
            store: pushNotificationStore,
            send: (request) => {
              const hostId = options.store.getIdentity()?.serverId;
              if (!hostId)
                return Effect.fail(
                  new PushNotificationSendFailure({
                    cause: new Error(sourceText("error.auth.hostCredentialUnavailable")),
                  }),
                );
              return sendPushNotification(hostId, request).pipe(
                Effect.mapError(({ cause }) => new PushNotificationSendFailure({ cause })),
              );
            },
            // The Team API server is made below. A notification reads it when it is sent.
            hiddenAgentIds: (protocol, capabilities, memberId) =>
              this.#api.hiddenAgentIds(protocol, capabilities, memberId),
            randomBytes: (size) => new Uint8Array(randomBytes(size)),
            memberActive: (memberId) => {
              const member = options.store.getMember(memberId);
              return member !== null && !member.disabled;
            },
            lastUseElsewhere: (memberId, sessionId) => this.#api.lastMemberUseElsewhere(memberId, sessionId),
            // The desktop app of this computer runs as the owner.
            atHostComputer: (memberId, event) =>
              memberId === options.store.getOwnerMemberId() && (options.hostComputerInUse?.(event) ?? false),
            liveActivityShows: (sessionId, alert, startedAt) =>
              this.#liveActivityPush?.showsEvent(sessionId, alert, startedAt) ?? false,
            channelForThread: (threadId) => this.channelForThread(threadId),
            logger,
          })
        : undefined;
    this.#api = new TeamApiServer({
      appVersion: options.appVersion,
      store: options.store,
      agents: options.agents,
      agentsReady: options.agentsReady,
      ...(options.channels === undefined ? {} : { channels: options.channels }),
      ...(options.mcpServers === undefined ? {} : { mcpServers: options.mcpServers }),
      ...(options.mcpSignIns === undefined ? {} : { mcpSignIns: options.mcpSignIns }),
      ...(options.signInRelay === undefined ? {} : { signInRelay: options.signInRelay }),
      ...(options.connectors === undefined ? {} : { connectors: options.connectors }),
      ...(options.onePasswordConnector === undefined ? {} : { onePasswordConnector: options.onePasswordConnector }),
      ...(options.bitwardenConnector === undefined ? {} : { bitwardenConnector: options.bitwardenConnector }),
      ...(options.vault === undefined ? {} : { vault: options.vault }),
      ...(options.providerHostSignIns === undefined ? {} : { providerHostSignIns: options.providerHostSignIns }),
      ...(options.providerAccounts === undefined ? {} : { providerAccounts: options.providerAccounts }),
      ...(options.providerUsageResets === undefined ? {} : { providerUsageResets: options.providerUsageResets }),
      ...(options.providerSignOut === undefined ? {} : { providerSignOut: options.providerSignOut }),
      ...(options.mcpToolRuntimePreparation === undefined
        ? {}
        : { mcpToolRuntimePreparation: options.mcpToolRuntimePreparation }),
      ...(options.storage === undefined ? {} : { storage: options.storage }),
      ...(options.machine === undefined ? {} : { machine: options.machine }),
      ...(options.hostedSites === undefined ? {} : { hostedSites: options.hostedSites }),
      ...(options.events === undefined ? {} : { events: options.events }),
      ...(options.agentImport === undefined ? {} : { agentImport: options.agentImport }),
      ...(options.instanceTransfer === undefined ? {} : { instanceTransfer: options.instanceTransfer }),
      ...(options.routineFlows === undefined ? {} : { routineFlows: options.routineFlows }),
      ...(options.workflows === undefined ? {} : { workflows: options.workflows }),
      ...(options.hiddenAgents === undefined ? {} : { hiddenAgents: options.hiddenAgents }),
      ...(options.agentAccess === undefined ? {} : { agentAccess: options.agentAccess }),
      ...(options.agentTasks === undefined ? {} : { agentTasks: options.agentTasks }),
      ...(options.browserProfiles === undefined ? {} : { browserProfiles: options.browserProfiles }),
      // The identity route changes this host's name and logo through `updateIdentity`, so a change
      // from a joined admin runs every step a local one does.
      admin: {
        ...options.admin,
        identity: { updateIdentity: (input) => this.updateIdentity(input).pipe(Effect.asVoid) },
      },
      skills: options.skills,
      sidebarLayout: options.sidebarLayout,
      mailbox: options.mailbox,
      browser: options.browser,
      browserView: this.#browserView,
      remoteScreen: this.#remoteScreen,
      redeemCentralTicket: options.redeemCentralTicket,
      ...(options.chat === undefined ? {} : { chat: options.chat }),
      onPresence: (snapshot) => this.emit("presence", snapshot),
      onDirectMessage: (event) => this.emit("directMessage", event),
      onDirectTyping: (event) => this.emit("directTyping", event),
      createInvite: (input) => this.createInvite(input),
      updateMember: (input) => this.updateMember(input),
      removeMember: (memberId) => this.removeMember(memberId),
      onSessionRevoked: (sessionId) => this.#revokeWebRtcSession(sessionId),
      ...(this.#liveActivityPush === undefined ? {} : { liveActivityPush: this.#liveActivityPush }),
      ...(this.#pushNotifications === undefined ? {} : { pushNotifications: this.#pushNotifications }),
      ...(options.focusUse === undefined ? {} : { focusUse: options.focusUse }),
    });
    this.#runtime = ManagedRuntime.make(
      Layer.succeed(
        HostApiRuntime,
        HostApiRuntime.of({
          // The saved phones get notifications again once the API runs, also before they connect.
          start: () => this.#api.start().pipe(Effect.tap(() => Effect.sync(() => this.#pushNotifications?.start()))),
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
          onSignalRecoveryFailure: (error, reason) => {
            logger.warn(`Host phase ${this.#status.phase} -> error: Signal ${reason}.`);
            this.#setStatus({
              phase: "error",
              apiOnline: false,
              message: error.message,
            });
          },
          closeSession: (sessionId) =>
            Effect.gen({ self: this }, function* () {
              this.#liveActivityPush?.remove(sessionId);
              this.#pushNotifications?.remove(sessionId);
              yield* this.#remoteScreen.revokeTeamSession(sessionId);
              yield* this.#browserView.revokeTeamSession(sessionId);
              this.#options.browser.releaseUserControlHeldBy({ kind: "session", sessionId });
            }),
          // iOS suspends the phone app before Signal reports the lost connection, about 150 s later.
          // The failed path tells it after about 30 s, so the host updates the phone sooner.
          pathChanged: (sessionId, lost) => {
            if (lost) {
              this.#liveActivityPush?.disconnected(sessionId);
              this.#pushNotifications?.disconnected(sessionId);
            } else {
              this.#liveActivityPush?.reconnected(sessionId);
              this.#pushNotifications?.reconnected(sessionId);
            }
          },
          ...(options.verifyRemoteSessionTicket ? { verifyClientTicket: options.verifyRemoteSessionTicket } : {}),
          ...(options.privateNetwork ? { privateNetwork: options.privateNetwork } : {}),
        })
      : null;
  }

  /** Applies a changed network route to the devices that are connected now. */
  readonly applyNetworkRoute = Effect.fn("HostService.applyNetworkRoute")(function* (this: HostService) {
    if (this.#webrtcGateway) yield* this.#webrtcGateway.applyNetworkRoute();
  }).bind(this);

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
        if (optionalRegisterRemoteHost) yield* this.#registerRemoteHost(optionalRegisterRemoteHost, ownerMembershipId);
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
      if (optionalRegisterRemoteHost) yield* this.#registerRemoteHost(optionalRegisterRemoteHost, ownerMembershipId);
      if (input.logo !== undefined && this.#isActiveHost(identity.serverId)) {
        yield* optionalUpdateRemoteHostLogo?.(identity.serverId, input.logo ?? null, identity.logoVersion) ??
          Effect.succeed(undefined);
      }
      return this.getStatus();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  /**
   * Changes the host's key without a new pairing. The current and the new key both sign a
   * handover, and every client that trusts the current key follows it to the new key. The host
   * uses the new key only after the account service accepts the handover.
   */
  readonly rotateIdentityKey = Effect.fn("HostService.rotateIdentityKey")(
    function* (this: HostService): Effect.fn.Return<HostStatus, RemoteWorkflowError> {
      if (!this.#options.handOverRemoteHostKey || !this.#options.registerRemoteHost)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.keyRotationUnavailable")) });
      yield* remoteDecode(() => this.#options.store.assertOwnerAccount(this.#options.getSignedInUser()));
      const { handover, result } = yield* this.#hostKeyLock.withPermit(
        Effect.gen({ self: this }, function* () {
          const handover = yield* this.#options.store.beginKeyRotation();
          return { handover, result: yield* this.#resolvePendingKeyRotation() };
        }),
      );
      if (result !== "accepted" || this.#options.store.getIdentity()?.publicKey !== handover.publicKey)
        return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.host.keyRotationRefused")) });
      if (this.#isActiveHost(handover.hostId)) {
        this.#setStatus({ message: sourceText("status.host.keyRotated") });
        this.#api.refreshIdentity();
      }
      return this.getStatus();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  /**
   * Sends a handover that is still pending, for example after a restart or a lost answer. This
   * runs before each registration: a registration with the previous key would change the account
   * service back to it after it accepted the handover.
   */
  readonly #resolvePendingKeyRotation = Effect.fn("HostService.resolvePendingKeyRotation")(function* (
    this: HostService,
  ): Effect.fn.Return<"accepted" | "refused" | "none", RemoteWorkflowError> {
    const handover = this.#options.store.getPendingKeyHandover();
    const handOver = this.#options.handOverRemoteHostKey;
    if (!handover || !handOver) return "none";
    const result = yield* handOver(handover.hostId, handover);
    if (result === "accepted") yield* this.#options.store.completeKeyRotation(handover);
    else yield* this.#options.store.discardKeyRotation(handover);
    return result;
  });

  /** Registers the active host with the key that it uses after any pending handover. */
  readonly #registerRemoteHost = Effect.fn("HostService.registerRemoteHost")(
    function* (
      this: HostService,
      register: NonNullable<HostServiceOptions["registerRemoteHost"]>,
      ownerMembershipId: string,
    ): Effect.fn.Return<void, RemoteWorkflowError> {
      yield* this.#resolvePendingKeyRotation();
      const identity = this.#options.store.getIdentity();
      if (!identity) return;
      yield* register({
        hostId: identity.serverId,
        name: identity.serverName,
        ownerMembershipId,
        devicePublicKey: identity.publicKey,
      });
    },
    (operation) => this.#hostKeyLock.withPermit(operation),
  );

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
      yield* this.#registerRemoteHost(
        optionalRegisterRemoteHost,
        yield* remoteDecode(() => this.#requiredOwnerMemberId()),
      );
      if (yield* this.#cancelSupersededStartEffect(generation)) return this.getStatus();
      if (this.#usesAccountDirectory() && optionalListRemoteMembers) {
        const members = yield* optionalListRemoteMembers(identity.serverId);
        yield* this.#syncRemoteDirectory(identity.serverId, members);
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

  /** Starts the Team API on loopback only, with no Signal: the development host and a local server. */
  readonly startLoopbackOnly = Effect.fn("HostService.startLoopbackOnly")(
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
        role: TeamRole;
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
        // An owner can promote the test client, so the client shows what the host allows it.
        role: authenticated.member.role,
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
        yield* this.#syncRemoteDirectory(hostId, members);
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

  searchAgentConversationMessages(
    query: string,
    agentId?: string,
    cursor?: string,
    limit = 100,
    includeSideThreads = false,
  ) {
    return this.#options.agents.searchConversationMessages(query, agentId, cursor, limit, includeSideThreads);
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

  /** Moves this computer's reader's mark of a side thread, the mark that the member's other devices read. */
  markAgentTaskRead(input: MarkAgentTaskReadInput): AgentTaskReadState {
    return this.#options.agents.markTaskRead(input, this.#currentAgentReaderId());
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
        yield* this.#syncRemoteDirectory(hostId, members);
        // Recording the directory is a write too, so the switch can land inside it and the
        // member below would be the previous account's.
        yield* remoteDecode(() => this.#assertStillActiveHost(hostId));
        if (updated.role !== current.role || updated.status !== current.status)
          yield* this.#revokeMemberSessions(input.memberId);
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
      if (member.disabled) {
        yield* this.#remoteScreen.revokeMember(member.id);
        this.#options.browser.releaseUserControlHeldBy({ kind: "member", memberId: member.id });
      }
      // Roles apply to members only, so a new team role changes which agents the member can use.
      if (input.role) this.#api.agentAccessChanged();
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
          yield* this.#syncRemoteDirectory(hostId, members);
        }
        yield* this.#revokeMemberSessions(memberId);
        yield* this.#forgetMemberRoles(hostId, memberId);
        return;
      }
      yield* this.#options.store.removeMember(memberId);
      if (hostId) yield* this.#forgetMemberRoles(hostId, memberId);
      yield* this.#remoteScreen.revokeMember(memberId);
      this.#options.browser.releaseUserControlHeldBy({ kind: "member", memberId });
      this.#api.refreshPresence();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  /** Gives a duplicated agent the levels of its source agent. */
  copyAgentAccess(sourceAgentId: string, agentId: string): Effect.Effect<void> {
    return this.#api.copyAgentAccess(sourceAgentId, agentId);
  }

  /** A removed member keeps no roles. The member is gone either way, so a failed write only logs. */
  #forgetMemberRoles(hostId: string, memberId: string): Effect.Effect<void> {
    const agentAccess = this.#options.agentAccess;
    if (!agentAccess) return Effect.void;
    return agentAccess
      .removeMember(hostId, memberId)
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("The removed member's roles did not save.", toLogValue(error))),
        ),
      );
  }

  readonly revokeSession = Effect.fn("HostService.revokeSession")(
    function* (this: HostService, sessionId: string): Effect.fn.Return<void, RemoteWorkflowError> {
      yield* this.#revokeWebRtcSession(sessionId);
      yield* this.#options.store.revokeSession(sessionId);
      yield* this.#remoteScreen.revokeTeamSession(sessionId);
      yield* this.#browserView.revokeTeamSession(sessionId);
      this.#options.browser.releaseUserControlHeldBy({ kind: "session", sessionId });
      this.#api.refreshPresence();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  /** Records the directory, and closes the sessions that it no longer allows. */
  readonly #syncRemoteDirectory = Effect.fn("HostService.syncRemoteDirectory")(function* (
    this: HostService,
    hostId: string,
    members: RemoteDirectoryMember[],
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const closed = yield* this.#options.store.syncRemoteDirectory(hostId, members);
    if (closed.length === 0) return;
    for (const sessionId of closed) yield* this.#closeLocalSession(sessionId);
    this.#api.refreshPresence();
  });

  /**
   * Ends every session of a member after the account directory changed the membership. A WebRTC
   * session keeps the role that the account service gave when it opened, so the change does not
   * reach a connected member until this closes the session. The member connects again with the new
   * role, or cannot connect. The account service already ended these sessions with the membership
   * change, so only the local parts close here: one failed account call cannot leave a session open.
   */
  readonly #revokeMemberSessions = Effect.fn("HostService.revokeMemberSessions")(function* (
    this: HostService,
    memberId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    for (const session of this.#options.store.listSessions()) {
      if (session.memberId !== memberId) continue;
      yield* this.#closeLocalSession(session.id);
      yield* this.#options.store.revokeSession(session.id);
    }
    yield* this.#remoteScreen.revokeMember(memberId);
    this.#options.browser.releaseUserControlHeldBy({ kind: "member", memberId });
    this.#api.refreshPresence();
  });

  /** Closes this computer's parts of one session. The account service ends the session itself. */
  readonly #closeLocalSession = Effect.fn("HostService.closeLocalSession")(function* (
    this: HostService,
    sessionId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    this.#liveActivityPush?.remove(sessionId);
    this.#pushNotifications?.remove(sessionId);
    if (this.#webrtcGateway) yield* this.#webrtcGateway.revokeSession(sessionId);
    yield* this.#remoteScreen.revokeTeamSession(sessionId);
    yield* this.#browserView.revokeTeamSession(sessionId);
    this.#options.browser.releaseUserControlHeldBy({ kind: "session", sessionId });
  });

  readonly #revokeWebRtcSession = Effect.fn("HostService.revokeWebRtcSession")(function* (
    this: HostService,
    sessionId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    this.#liveActivityPush?.remove(sessionId);
    this.#pushNotifications?.remove(sessionId);
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
      const invite = yield* this.#options.store.createInvite(
        input.role,
        input.email,
        input.permanent === undefined ? {} : { permanent: input.permanent },
      );
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
    // The phones register again when they connect to the next runtime. The saved notification
    // phones are read again when it starts.
    const pendingPushes = yield* Effect.forkChild(
      Effect.all([this.#liveActivityPush?.dispose() ?? Effect.void, this.#pushNotifications?.dispose() ?? Effect.void]),
    );
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
   * The level of `personId`, who asked a channel member to add or remove `agentId`, for that agent:
   * the level their own save through the Team API has. This computer's user manages every agent. A
   * person who is no longer an active member of the team has none.
   */
  channelPersonAgentLevel(personId: string, agentId: string): AgentAccessLevel {
    if (!this.channelPersonIsRemote(personId)) return "manage";
    const member = this.#options.store.getMember(personId);
    if (!member || member.disabled) return "none";
    return this.#api.agentLevel(member, agentId);
  }

  /**
   * Whether `personId`, who wrote a channel request, is someone other than this computer's user: a
   * team member, whose app has only what the Team API gives it.
   */
  channelPersonIsRemote(personId: string): boolean {
    if (personId === SIGNED_OUT_CHANNEL_MEMBER_ID || personId === this.#findCurrentMemberId()) return false;
    try {
      return personId !== `local-user:${this.#options.getSignedInUser().id}`;
    } catch {
      // Signed out: the person is a team member or nobody this computer knows.
      return true;
    }
  }

  /** The channel list as the host user reads it, as the IPC list does. Empty without channels. */
  listChannels(): ChannelSummary[] {
    return this.#options.channels?.store.list(this.channelActor().id, true) ?? [];
  }

  /** The channel whose execution thread `threadId` is, or null for an agent's own thread. */
  channelForThread(threadId: string): { id: string; name: string } | null {
    const store = this.#options.channels?.store;
    const channelId = store?.channelForThread(threadId);
    return store && channelId ? { id: channelId, name: store.get(channelId).name } : null;
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
