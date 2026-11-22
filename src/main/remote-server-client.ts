import { randomBytes, verify } from "node:crypto";
import type { RemoteDesktopCapabilities, ServerCompatibility } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  decodeTeamProtocolSupportExpanded,
  isAgentCreateRoute,
  supportsTeamSemanticTags,
  TEAM_AGENT_CREATE_MODEL_CAPABILITY,
  TEAM_BOOTSTRAP_CAPABILITIES,
  type TeamCurrentCapability,
  teamCapabilitiesForProtocol,
  teamCapabilityHeaders,
} from "@openbot/contracts/team-protocol/current";
import {
  decodeServerSafeModeReason,
  SERVER_SAFE_MODE_CAPABILITY,
  SERVER_SAFE_MODE_ROUTES,
} from "@openbot/contracts/team-protocol/server-safe-mode-v1";
import {
  highestCommonTeamProtocol,
  TEAM_APP_VERSION_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamProtocolUpdateDirection,
} from "@openbot/contracts/team-protocol/v1";
import type { TeamProtocolSupportV9 } from "@openbot/contracts/team-protocol/v9";
import { hasTeamProtocolV10Lists, TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Option, Result } from "effect";
import { decodeRemoteDesktopCapabilities } from "./remote-device-decoding";
import type { ResponseDecoder } from "./remote-host-decoding";
import {
  assumedCompatibility,
  LOCAL_TEAM_PROTOCOL,
  negotiatedCompatibility,
  webRtcCompatibility,
} from "./remote-server-connection-status";
import { RemoteProtocolError, RemoteRequestError } from "./remote-server-errors";
import { remoteFetch, requestJson, throwRemoteResponseError, webRtcRequestBody } from "./remote-server-http";
import type { StoredRemoteServerView } from "./remote-server-store";
import { addRemotePreviewUrls } from "./remote-server-urls";
import { type RemoteFileProgress, RemoteWorkflowError, remoteDecode } from "./remote-service-effects";
import { decodeIdentityProof } from "./remote-team-decoding";
import { fingerprint } from "./team-store";
import { TeamWebRtcRequestError } from "./team-webrtc-client-transport";

export interface RemoteHostRequestTransport {
  request: (
    hostId: string,
    path: string,
    init?: {
      method?: string | undefined;
      body?: unknown;
      preserveSemanticTags?: boolean | undefined;
      agentCreateModel?: boolean | undefined;
      timeoutMs?: number | undefined;
    },
  ) => Effect.Effect<unknown, RemoteWorkflowError>;
  requestResponse: (
    hostId: string,
    path: string,
    init?: {
      method?: string | undefined;
      body?: unknown;
      contentType?: string | undefined;
      preserveSemanticTags?: boolean | undefined;
      timeoutMs?: number | undefined;
      fileProgress?: RemoteFileProgress | undefined;
      uploadProgress?: ((sent: number, total: number) => void) | undefined;
    },
  ) => Effect.Effect<
    {
      status: number;
      body: unknown;
      file?: { bytes: Uint8Array; name: string; mimeType: string };
    },
    RemoteWorkflowError
  >;
}

export interface RemoteServerLookup {
  require: (serverId: string) => StoredRemoteServerView;
  token: (server: StoredRemoteServerView) => string;
}

export interface RemoteConnectionSink {
  compatibilityFor: (serverId: string) => ServerCompatibility | null;
  issueFor: (serverId: string) => { code: string; message: string } | null;
  setCompatibility: (serverId: string, compatibility: ServerCompatibility) => void;
  clearStaleIssue: (serverId: string, issue: { code: string; message: string } | null) => void;
  reportError: (serverId: string, error: unknown) => void;
}

export interface RemoteServerClientOptions {
  appVersion: string | null;
  servers: RemoteServerLookup;
  connections: RemoteConnectionSink;
  transport: RemoteHostRequestTransport | null;
}

export interface RemoteRequestInit {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
}

export type RemoteRequestFn = <T>(
  serverId: string,
  path: string,
  decoder: ResponseDecoder<T>,
  init?: RemoteRequestInit,
) => Effect.Effect<T, RemoteWorkflowError>;

export class RemoteServerClient {
  readonly #appVersion: string | null;
  readonly #servers: RemoteServerLookup;
  readonly #connections: RemoteConnectionSink;
  readonly #transport: RemoteHostRequestTransport | null;
  readonly #compatibilityRequests = new Map<string, Deferred.Deferred<ServerCompatibility, RemoteWorkflowError>>();

  constructor(options: RemoteServerClientOptions) {
    this.#appVersion = options.appVersion;
    this.#servers = options.servers;
    this.#connections = options.connections;
    this.#transport = options.transport;
  }

  readonly request = Effect.fn("RemoteClient.request")(function* <T>(
    this: RemoteServerClient,
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init: RemoteRequestInit = {},
  ): Effect.fn.Return<T, RemoteWorkflowError> {
    const server = yield* remoteDecode(() => this.#servers.require(serverId));
    return yield* Effect.gen({ self: this }, function* () {
      if (server.transport === "webrtc-v2") {
        const compatibility = yield* this.ensureCompatibility(server);
        const value = yield* this.#hostRequestEffect(server.id, path, {
          ...init,
          preserveSemanticTags: supportsTeamSemanticTags(compatibility.capabilities),
          agentCreateModel: this.supportsAgentCreateModel(path, init, compatibility.capabilities),
        });
        return yield* remoteDecode(() => addRemotePreviewUrls(decodeOrProtocolError(decoder, value), server.id));
      }
      const compatibility = yield* this.ensureCompatibility(server);
      const value = yield* requestJson(server.apiUrl, path, decoder, {
        ...init,
        token: this.#servers.token(server),
        agentCreateModel: this.supportsAgentCreateModel(path, init, compatibility.capabilities),
        ...this.requestProtocol(compatibility),
      }).pipe(
        Effect.mapError(
          (failure) =>
            new RemoteWorkflowError({
              cause:
                failure instanceof RemoteRequestError || failure instanceof RemoteProtocolError
                  ? failure
                  : failure.cause,
            }),
        ),
      );
      return addRemotePreviewUrls(value, server.id);
    }).pipe(Effect.tapError(({ cause }) => Effect.sync(() => this.#connections.reportError(server.id, cause))));
  });

  readonly fetch = Effect.fn("RemoteClient.fetch")(function* (
    this: RemoteServerClient,
    server: StoredRemoteServerView,
    input: string | URL,
    init: RequestInit = {},
    affectsConnection = true,
    timeoutMs?: number,
    fileProgress?: RemoteFileProgress,
    uploadProgress?: (sent: number, total: number) => void,
  ): Effect.fn.Return<Response, RemoteWorkflowError> {
    return yield* Effect.gen({ self: this }, function* () {
      if (server.transport === "webrtc-v2") {
        const transport = yield* remoteDecode(() => this.#requireTransport());
        const url = new URL(input);
        const attempt2 = yield* Effect.gen({ self: this }, function* () {
          const compatibility = yield* this.ensureCompatibility(server);
          const contentType = new Headers(init.headers).get("Content-Type") ?? undefined;
          const requestBody = yield* remoteDecode(() => webRtcRequestBody(init.body, contentType));
          const response = yield* transport.requestResponse(server.id, `${url.pathname}${url.search}`, {
            ...(init.method === undefined ? {} : { method: init.method }),
            ...(requestBody === undefined ? {} : { body: requestBody }),
            ...(contentType === undefined ? {} : { contentType }),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(fileProgress === undefined ? {} : { fileProgress }),
            ...(uploadProgress === undefined ? {} : { uploadProgress }),
            preserveSemanticTags: supportsTeamSemanticTags(compatibility.capabilities),
          });
          const headers = new Headers();
          if (response.file) {
            headers.set("Content-Type", response.file.mimeType);
            headers.set(
              "Content-Disposition",
              `attachment; filename*=UTF-8''${encodeURIComponent(response.file.name)}`,
            );
            return new Response(Buffer.from(response.file.bytes), { status: response.status, headers });
          }
          headers.set("Content-Type", "application/json");
          return new Response(response.status === 204 ? null : JSON.stringify(response.body), {
            status: response.status,
            headers,
          });
        }).pipe(Effect.result);
        if (Result.isFailure(attempt2)) {
          const error = attempt2.failure.cause;
          return yield* remoteDecode(() => rethrowAsRemoteRequestError(error));
        } else return attempt2.success;
      }
      const compatibility = yield* this.ensureCompatibility(server);
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${this.#servers.token(server)}`);
      headers.set(TEAM_PROTOCOL_VERSION_HEADER, String(compatibility.negotiatedProtocol));
      if (this.#appVersion) {
        headers.set(TEAM_APP_VERSION_HEADER, this.#appVersion);
        const capabilities = teamCapabilitiesForProtocol(compatibility.negotiatedProtocol);
        for (const [name, value] of Object.entries(
          teamCapabilityHeaders(compatibility.negotiatedProtocol, capabilities),
        ))
          headers.set(name, value);
      }
      const response = yield* remoteFetch(input, { ...init, headers }, timeoutMs).pipe(
        Effect.mapError(
          (failure) =>
            new RemoteWorkflowError({
              cause:
                failure instanceof RemoteRequestError || failure instanceof RemoteProtocolError
                  ? failure
                  : failure.cause,
            }),
        ),
      );
      if (!response.ok) {
        yield* throwRemoteResponseError(response, init.method ?? "GET", new URL(input).pathname).pipe(
          Effect.mapError((cause) => new RemoteWorkflowError({ cause })),
        );
      }
      return response;
    }).pipe(
      Effect.tapError(({ cause }) =>
        Effect.sync(() => {
          if (affectsConnection) this.#connections.reportError(server.id, cause);
        }),
      ),
    );
  }).bind(this);

  requestProtocol(compatibility: ServerCompatibility): {
    protocol?: number | undefined;
    appVersion?: string | undefined;
    capabilities?: readonly TeamCurrentCapability[] | undefined;
    preserveSemanticTags?: boolean | undefined;
  } {
    const protocol = compatibility.negotiatedProtocol;
    const appVersion = this.#appVersion;
    return {
      ...(protocol === null ? {} : { protocol }),
      ...(appVersion === null ? {} : { appVersion }),
      ...(appVersion ? { capabilities: teamCapabilitiesForProtocol(protocol) } : {}),
      preserveSemanticTags: supportsTeamSemanticTags(compatibility.capabilities),
    };
  }

  readonly ensureCompatibility = Effect.fn("RemoteClient.ensureCompatibility")(function* (
    this: RemoteServerClient,
    server: StoredRemoteServerView,
    refresh = false,
  ): Effect.fn.Return<ServerCompatibility, RemoteWorkflowError> {
    const current = this.#connections.compatibilityFor(server.id);
    const issue = this.#connections.issueFor(server.id);
    if (
      !refresh &&
      (issue?.code === "client_update_required" ||
        issue?.code === "host_update_required" ||
        issue?.code === "protocol_error" ||
        issue?.code === "server_safe_mode")
    ) {
      return yield* new RemoteWorkflowError({
        cause: new RemoteProtocolError(
          issue.code,
          issue.message,
          current?.hostAppVersion && current.hostProtocol
            ? {
                appVersion: current.hostAppVersion,
                protocol: current.hostProtocol,
                capabilities: current.capabilities,
              }
            : null,
        ),
      });
    }
    if (!this.#appVersion) {
      const compatibility = assumedCompatibility(this.#appVersion);
      this.#connections.setCompatibility(server.id, compatibility);
      return compatibility;
    }
    if (!refresh && current?.negotiatedProtocol) return current;
    const pending = this.#compatibilityRequests.get(server.id);
    if (pending) return yield* Deferred.await(pending);
    const issueAtStart = this.#connections.issueFor(server.id);
    const request = Deferred.makeUnsafe<ServerCompatibility, RemoteWorkflowError>();
    this.#compatibilityRequests.set(server.id, request);
    return yield* Effect.gen({ self: this }, function* () {
      const compatibility = yield* server.transport === "webrtc-v2"
        ? this.#negotiateWebRtcCompatibilityEffect(server.id)
        : this.negotiateCompatibility(server.apiUrl);
      if (compatibility.capabilities.includes(SERVER_SAFE_MODE_CAPABILITY))
        return yield* this.#serverSafeModeError(server, compatibility);
      this.#connections.setCompatibility(server.id, compatibility);
      this.#connections.clearStaleIssue(server.id, issueAtStart);
      return compatibility;
    }).pipe(
      Effect.onExit((exit) => Deferred.done(request, exit)),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#compatibilityRequests.get(server.id) === request) this.#compatibilityRequests.delete(server.id);
        }),
      ),
    );
  }).bind(this);

  readonly #serverSafeModeError = Effect.fn("RemoteClient.serverSafeModeError")(function* (
    this: RemoteServerClient,
    server: StoredRemoteServerView,
    compatibility: ServerCompatibility,
  ): Effect.fn.Return<never, RemoteWorkflowError> {
    const reason = yield* server.transport === "webrtc-v2"
      ? this.#hostRequestEffect(server.id, SERVER_SAFE_MODE_ROUTES.reason).pipe(
          Effect.flatMap((value) => remoteDecode(() => decodeServerSafeModeReason(value))),
          Effect.option,
        )
      : requestJson(server.apiUrl, SERVER_SAFE_MODE_ROUTES.reason, decodeServerSafeModeReason, {
          token: this.#servers.token(server),
          ...this.requestProtocol(compatibility),
        }).pipe(Effect.option);
    const message = Option.match(reason, {
      onNone: () => sourceText("error.team.serverSafeMode"),
      onSome: ({ reason, appVersion }) =>
        reason === "newer_database"
          ? sourceText("error.team.serverSafeModeNewerDatabase", { version: appVersion })
          : sourceText("error.team.serverSafeModeStartFailed", { version: appVersion }),
    });
    return yield* new RemoteWorkflowError({
      cause: new RemoteProtocolError(
        "server_safe_mode",
        message,
        compatibility.hostAppVersion && compatibility.hostProtocol
          ? {
              appVersion: compatibility.hostAppVersion,
              protocol: compatibility.hostProtocol,
              capabilities: compatibility.capabilities,
            }
          : null,
      ),
    });
  });

  readonly refreshWebRtcCompatibility = Effect.fn("RemoteClient.refreshWebRtcCompatibility")(function* (
    this: RemoteServerClient,
    server: StoredRemoteServerView,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (!this.#transport) return;
    yield* this.ensureCompatibility(server, true).pipe(
      Effect.tapError(({ cause }) => Effect.sync(() => this.#connections.reportError(server.id, cause))),
    );
  }).bind(this);

  readonly negotiateCompatibility = Effect.fn("RemoteClient.negotiateCompatibility")(function* (
    this: RemoteServerClient,
    apiUrl: string,
  ): Effect.fn.Return<ServerCompatibility, RemoteWorkflowError> {
    if (!this.#appVersion) return assumedCompatibility(this.#appVersion);
    const host = yield* this.#readCompatibilityEffect(apiUrl, 7, TEAM_BOOTSTRAP_CAPABILITIES);
    const negotiatedProtocol = highestCommonTeamProtocol(LOCAL_TEAM_PROTOCOL, host.protocol);
    if (negotiatedProtocol === null) {
      if (teamProtocolUpdateDirection(LOCAL_TEAM_PROTOCOL, host.protocol) === "client_update_required") {
        return yield* new RemoteWorkflowError({
          cause: new RemoteProtocolError("client_update_required", sourceText("error.remote.appUpdateRequired"), host),
        });
      }
      return yield* new RemoteWorkflowError({
        cause: new RemoteProtocolError("host_update_required", sourceText("error.team.hostUpdateRequired"), host),
      });
    }
    if (negotiatedProtocol <= 7) return negotiatedCompatibility(this.#appVersion, host, negotiatedProtocol);
    const current = yield* this.#readCompatibilityEffect(
      apiUrl,
      negotiatedProtocol,
      teamCapabilitiesForProtocol(negotiatedProtocol),
    );
    return negotiatedCompatibility(
      this.#appVersion,
      { ...host, capabilities: current.capabilities },
      negotiatedProtocol,
    );
  }).bind(this);

  readonly #readCompatibilityEffect = Effect.fn("RemoteClient.readCompatibility")(function* (
    this: RemoteServerClient,
    apiUrl: string,
    protocol: number,
    capabilities: readonly TeamCurrentCapability[],
  ): Effect.fn.Return<TeamProtocolSupportV9, RemoteWorkflowError> {
    const attempt4 = yield* Effect.gen({ self: this }, function* () {
      return yield* requestJson(apiUrl, TEAM_API_ROUTES.compatibility, decodeTeamProtocolSupportExpanded, {
        protocol,
        capabilities,
      }).pipe(
        Effect.mapError(
          (failure) =>
            new RemoteWorkflowError({
              cause:
                failure instanceof RemoteRequestError || failure instanceof RemoteProtocolError
                  ? failure
                  : failure.cause,
            }),
        ),
      );
    }).pipe(Effect.result);
    if (Result.isFailure(attempt4)) {
      const error = attempt4.failure.cause;
      if (error instanceof RemoteRequestError && error.status === 404) {
        return yield* new RemoteWorkflowError({
          cause: new RemoteProtocolError("host_update_required", sourceText("error.team.hostUpdateRequired")),
        });
      }
      if (error instanceof SyntaxError || (error instanceof RemoteProtocolError && error.code === "protocol_error")) {
        return yield* new RemoteWorkflowError({
          cause: new RemoteProtocolError("protocol_error", sourceText("error.remote.invalidCompatibility")),
        });
      }
      return yield* new RemoteWorkflowError({ cause: error });
    }
    return attempt4.success;
  }).bind(this);

  readonly verifyIdentity = Effect.fn("RemoteClient.verifyIdentity")(function* (
    this: RemoteServerClient,
    apiUrl: string,
    serverId: string,
    expectedFingerprint: string,
  ): Effect.fn.Return<
    {
      publicKey: string;
      serverName: string;
      logoVersion: string | null;
      compatibility: ServerCompatibility;
    },
    RemoteWorkflowError
  > {
    const compatibility = yield* this.negotiateCompatibility(apiUrl);
    const challenge = randomBytes(24).toString("base64url");
    const proof = yield* requestJson(
      apiUrl,
      `${TEAM_API_ROUTES.identity}?challenge=${encodeURIComponent(challenge)}`,
      decodeIdentityProof,
      { ...this.requestProtocol(compatibility) },
    ).pipe(
      Effect.mapError(
        (failure) =>
          new RemoteWorkflowError({
            cause:
              failure instanceof RemoteRequestError || failure instanceof RemoteProtocolError ? failure : failure.cause,
          }),
      ),
    );
    const valid = yield* remoteDecode(
      () =>
        proof.serverId === serverId &&
        proof.challenge === challenge &&
        proof.fingerprint === expectedFingerprint &&
        fingerprint(proof.publicKey) === expectedFingerprint &&
        verify(null, Buffer.from(challenge), proof.publicKey, Buffer.from(proof.signature, "base64url")),
    );
    if (!valid)
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.identityNotVerified")) });
    return {
      publicKey: proof.publicKey,
      serverName: proof.serverName,
      logoVersion: proof.logoVersion,
      compatibility,
    };
  }).bind(this);

  readonly probeRemoteDesktop = Effect.fn("RemoteClient.probeRemoteDesktop")(function* (
    this: RemoteServerClient,
    server: StoredRemoteServerView,
  ): Effect.fn.Return<boolean, RemoteWorkflowError> {
    return yield* Effect.gen({ self: this }, function* () {
      const compatibility = yield* this.ensureCompatibility(server);
      if (!compatibility.capabilities.includes("remote-desktop")) return false;
      let capabilities: RemoteDesktopCapabilities;
      if (server.transport === "webrtc-v2") {
        const value = yield* this.#hostRequestEffect(server.id, TEAM_API_ROUTES.remoteScreen.capabilities, {
          preserveSemanticTags: supportsTeamSemanticTags(compatibility.capabilities),
        });
        capabilities = yield* remoteDecode(() => decodeOrProtocolError(decodeRemoteDesktopCapabilities, value));
      } else {
        capabilities = yield* requestJson(
          server.apiUrl,
          TEAM_API_ROUTES.remoteScreen.capabilities,
          decodeRemoteDesktopCapabilities,
          { token: this.#servers.token(server), ...this.requestProtocol(compatibility) },
        ).pipe(
          Effect.mapError(
            (failure) =>
              new RemoteWorkflowError({
                cause:
                  failure instanceof RemoteRequestError || failure instanceof RemoteProtocolError
                    ? failure
                    : failure.cause,
              }),
          ),
        );
      }
      return capabilities.ready;
    }).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.gen({ self: this }, function* () {
          if (error instanceof RemoteRequestError && [404, 426, 503].includes(error.status)) return false;
          if (
            error instanceof RemoteProtocolError ||
            (error instanceof RemoteRequestError && error.code === "protocol_error")
          ) {
            this.#connections.reportError(server.id, error);
          }
          return yield* new RemoteWorkflowError({ cause: error });
        }),
      ),
    );
  }).bind(this);

  forget(serverId: string): void {
    this.#compatibilityRequests.delete(serverId);
  }

  clear(): void {
    this.#compatibilityRequests.clear();
  }

  readonly #negotiateWebRtcCompatibilityEffect = Effect.fn("RemoteClient.negotiateWebRtcCompatibility")(function* (
    this: RemoteServerClient,
    serverId: string,
  ): Effect.fn.Return<ServerCompatibility, RemoteWorkflowError> {
    const first = yield* this.#readWebRtcCompatibilityEffect(serverId);
    const host =
      !first.lists && Math.min(first.support.protocol.maximum, LOCAL_TEAM_PROTOCOL.maximum) >= TEAM_PROTOCOL_V10
        ? (yield* this.#readWebRtcCompatibilityEffect(serverId)).support
        : first.support;
    return webRtcCompatibility(this.#appVersion, host);
  });

  readonly #readWebRtcCompatibilityEffect = Effect.fn("RemoteClient.readWebRtcCompatibility")(function* (
    this: RemoteServerClient,
    serverId: string,
  ): Effect.fn.Return<{ support: TeamProtocolSupportV9; lists: boolean }, RemoteWorkflowError> {
    const value = yield* this.#hostRequestEffect(serverId, TEAM_API_ROUTES.compatibility);
    const support = yield* remoteDecode(() =>
      decodeOrProtocolError(decodeTeamProtocolSupportExpanded, value, sourceText("error.remote.invalidCompatibility")),
    );
    return { support, lists: hasTeamProtocolV10Lists(value) };
  });

  readonly #hostRequestEffect = Effect.fn("RemoteClient.hostRequest")(function* (
    this: RemoteServerClient,
    serverId: string,
    path: string,
    init: { method?: string; body?: unknown; preserveSemanticTags?: boolean; agentCreateModel?: boolean } = {},
  ): Effect.fn.Return<unknown, RemoteWorkflowError> {
    return yield* Effect.gen({ self: this }, function* () {
      return yield* this.#requireTransport().request(serverId, path, init);
    }).pipe(Effect.catch(({ cause }) => remoteDecode(() => rethrowAsRemoteRequestError(cause))));
  });

  private supportsAgentCreateModel(path: string, init: RemoteRequestInit, capabilities: readonly string[]): boolean {
    return (
      isAgentCreateRoute(init.method ?? (init.body === undefined ? "GET" : "POST"), path) &&
      capabilities.includes(TEAM_AGENT_CREATE_MODEL_CAPABILITY)
    );
  }

  #requireTransport(): RemoteHostRequestTransport {
    if (!this.#transport) throw new Error(sourceText("error.remote.webRtcUnavailable"));
    return this.#transport;
  }
}

function decodeOrProtocolError<T>(
  decoder: ResponseDecoder<T>,
  value: unknown,
  message = sourceText("error.remote.unsafeData"),
): T {
  try {
    return decoder(value);
  } catch (error) {
    throw new RemoteProtocolError("protocol_error", message, null, { cause: error });
  }
}

function rethrowAsRemoteRequestError(error: unknown): never {
  if (error instanceof TeamWebRtcRequestError) throw new RemoteRequestError(error.status, error.message, error.code);
  throw error;
}
