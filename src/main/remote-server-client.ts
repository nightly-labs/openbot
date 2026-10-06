// One Team API call, from picking a wire format to recording that it failed.
//
// **Two encodings, on purpose. Never merge them.** The HTTPS path frames V1 or V3 according to the
// protocol this app and the host negotiated; the WebRTC path frames V2 JSON and nothing else. Both
// are released wire protocols, so a shipped frame never changes meaning -- see
// `packages/contracts/AGENTS.md`. What looks like duplication between the two arms of every method
// here is two protocols that happen to carry the same payload today. Collapsing them is the one
// edit in this file that silently breaks a build already in users' hands. Deleting a *duplicated
// call site* is fine; merging the two encodings is not.
//
// Everything above the wire is shared and lives here once: compatibility negotiation and its
// in-flight deduplication, the protocol and capability headers, translating a transport failure
// into a `RemoteRequestError`, and reporting the failure to the connection registry. The registry
// decides what a failure means to the user; this file only decides what it means to the request.
//
// This file does not know the event stream exists. When a failure makes reconnecting pointless the
// registry says so and its owner acts on it -- that is what keeps a failed HTTP request from
// reaching in and closing a WebSocket.

import { randomBytes, verify } from "node:crypto";
import type { RemoteDesktopCapabilities, ServerCompatibility } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  isAgentCreateRoute,
  supportsTeamSemanticTags,
  TEAM_AGENT_CREATE_MODEL_CAPABILITY,
  TEAM_CURRENT_CAPABILITIES,
  type TeamCurrentCapability,
} from "@openbot/contracts/team-protocol/current";
import {
  decodeTeamProtocolSupportV1,
  highestCommonTeamProtocol,
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamProtocolUpdateDirection,
} from "@openbot/contracts/team-protocol/v1";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result } from "effect";
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
import { RemoteWorkflowError, remoteDecode } from "./remote-service-effects";
import { decodeIdentityProof } from "./remote-team-decoding";
import { fingerprint } from "./team-store";
import { TeamWebRtcRequestError } from "./team-webrtc-client-transport";

/**
 * The two transport methods a request needs. `TeamWebRtcClientTransport` also carries a live event
 * channel and a control-plane client; naming only these two is what keeps those out of this file.
 */
export interface RemoteHostRequestTransport {
  request: (
    hostId: string,
    path: string,
    init?: { method?: string; body?: unknown; preserveSemanticTags?: boolean; agentCreateModel?: boolean },
  ) => Effect.Effect<unknown, RemoteWorkflowError>;
  requestResponse: (
    hostId: string,
    path: string,
    init?: { method?: string; body?: unknown; contentType?: string; preserveSemanticTags?: boolean },
  ) => Effect.Effect<
    {
      status: number;
      body: unknown;
      file?: { bytes: Uint8Array; name: string; mimeType: string };
    },
    RemoteWorkflowError
  >;
}

/** What the client needs from the stored server list: a server, and the token to speak for it. */
export interface RemoteServerLookup {
  require: (serverId: string) => StoredRemoteServerView;
  token: (server: StoredRemoteServerView) => string;
}

/**
 * Where a request records what happened. The client reads the last known compatibility to avoid
 * renegotiating, and reads the last issue because a protocol failure must not be retried on every
 * call -- see `ensureCompatibility`.
 */
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

/** `RemoteServerClient.request` as a plain function, for callers that need nothing else from it. */
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
  // In-flight negotiations, so a burst of calls to a cold server produces one compatibility request
  // rather than one per call. Private to the client: the UI never sees this, unlike the status the
  // negotiation produces.
  readonly #compatibilityRequests = new Map<string, Deferred.Deferred<ServerCompatibility, RemoteWorkflowError>>();

  constructor(options: RemoteServerClientOptions) {
    this.#appVersion = options.appVersion;
    this.#servers = options.servers;
    this.#connections = options.connections;
    this.#transport = options.transport;
  }

  /** One decoded Team API call. Every failure is reported to the registry before it is rethrown. */

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
        // Decoding is outside the transport's catch on purpose. A frame that arrived intact and then
        // failed its route decoder is a protocol failure, not a request that happened to fail, and
        // only `RemoteProtocolError` makes the classifier stop reconnecting to a host talking
        // nonsense. `requestJson` draws the same line for the HTTPS arm; a plain error here left
        // the server looking healthy.
        return yield* remoteDecode(() => addRemotePreviewUrls(decodeOrProtocolError(decoder, value), server.id));
      }
      const compatibility = yield* this.ensureCompatibility(server);
      const value = yield* requestJson(server.apiUrl, path, decoder, {
        ...init,
        token: this.#servers.token(server),
        timeoutMs: init.timeoutMs,
        // A host without the capability drops the fields in its frozen projection and starts the
        // agent on its own default, so the pair is only encoded for hosts that read it.
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

  /**
   * The undecoded form, for bytes: attachments, avatars, logos and the remote viewer. The WebRTC arm
   * rebuilds an HTTP `Response` from a V2 frame so both arms hand back the same thing.
   *
   * `affectsConnection` is false for the remote viewer, whose requests are triggered by page loads
   * rather than by the user and so must not mark a healthy server offline.
   *
   * `timeoutMs` applies to HTTP only. A WebRTC request has the transport's own limit.
   */

  readonly fetch = Effect.fn("RemoteClient.fetch")(function* (
    this: RemoteServerClient,
    server: StoredRemoteServerView,
    input: string | URL,
    init: RequestInit = {},
    affectsConnection = true,
    timeoutMs?: number,
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
            method: init.method,
            body: requestBody,
            contentType,
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
        headers.set(TEAM_CAPABILITIES_HEADER, TEAM_CURRENT_CAPABILITIES.join(","));
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

  /** The negotiated protocol and this app's capabilities, as `requestJson` wants them. */
  requestProtocol(compatibility: ServerCompatibility): {
    protocol?: number;
    appVersion?: string;
    capabilities?: readonly TeamCurrentCapability[];
    preserveSemanticTags?: boolean;
  } {
    return {
      protocol: compatibility.negotiatedProtocol ?? undefined,
      appVersion: this.#appVersion ?? undefined,
      capabilities: this.#appVersion ? TEAM_CURRENT_CAPABILITIES : undefined,
      preserveSemanticTags: supportsTeamSemanticTags(compatibility.capabilities),
    };
  }

  /**
   * The negotiated compatibility for a server, negotiating it if this is the first call.
   *
   * A recorded protocol issue is rethrown without touching the network: the two ends have already
   * agreed they cannot talk, and re-asking on every call would turn one incompatibility into a
   * request storm. `refresh` is how an explicit reconnect gets past that.
   */

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
        issue?.code === "protocol_error")
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
    // What the server was complaining about when this negotiation started. Only that complaint is
    // this answer's to withdraw: a caller reusing the compatibility already on record -- the desktop
    // probe does -- can record a protocol failure while this request is still out, and clearing it
    // unconditionally on the way back is how a host that failed closed comes back healthy.
    const issueAtStart = this.#connections.issueFor(server.id);
    const request = Deferred.makeUnsafe<ServerCompatibility, RemoteWorkflowError>();
    this.#compatibilityRequests.set(server.id, request);
    return yield* Effect.gen({ self: this }, function* () {
      const compatibility = yield* server.transport === "webrtc-v2"
        ? this.#negotiateWebRtcCompatibilityEffect(server.id)
        : this.negotiateCompatibility(server.apiUrl);
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

  /**
   * Re-reads what a WebRTC host supports and records it. Unlike the pinned V2 framing the WebRTC arm
   * always uses, this reports the host's real protocol range, so the user is told to update the end
   * that is actually behind.
   */

  readonly refreshWebRtcCompatibility = Effect.fn("RemoteClient.refreshWebRtcCompatibility")(function* (
    this: RemoteServerClient,
    serverId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (!this.#transport) return;
    const attempt3 = yield* Effect.gen({ self: this }, function* () {
      // The request is inside the reporting `try`, not before it: the transport itself raises
      // `protocol_error` for a frame the released adapter refuses, and that is the same failure as a
      // compatibility body that will not decode. The caller of this one is a `connected` handler
      // with nowhere to put an error, so recording it here is the only thing that stops the app
      // treating a host talking nonsense as healthy.
      const value = yield* this.#hostRequestEffect(serverId, TEAM_API_ROUTES.compatibility);
      return yield* remoteDecode(() =>
        decodeOrProtocolError(decodeTeamProtocolSupportV1, value, sourceText("error.remote.invalidCompatibility")),
      );
    }).pipe(Effect.result);
    if (Result.isFailure(attempt3)) {
      const error = attempt3.failure.cause;
      this.#connections.reportError(serverId, error);
      return yield* new RemoteWorkflowError({ cause: error });
    }
    const host = attempt3.success;
    this.#connections.setCompatibility(
      serverId,
      negotiatedCompatibility(this.#appVersion, host, highestCommonTeamProtocol(LOCAL_TEAM_PROTOCOL, host.protocol)),
    );
  }).bind(this);

  /**
   * Negotiation against a bare URL, for a server not stored yet -- joining, or verifying an
   * identity. Nothing here is recorded, because there is no connection to record it against.
   */

  readonly negotiateCompatibility = Effect.fn("RemoteClient.negotiateCompatibility")(function* (
    this: RemoteServerClient,
    apiUrl: string,
  ): Effect.fn.Return<ServerCompatibility, RemoteWorkflowError> {
    if (!this.#appVersion) return assumedCompatibility(this.#appVersion);
    const attempt4 = yield* Effect.gen({ self: this }, function* () {
      return yield* requestJson(apiUrl, TEAM_API_ROUTES.compatibility, decodeTeamProtocolSupportV1).pipe(
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
    const host = attempt4.success;
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
    return negotiatedCompatibility(this.#appVersion, host, negotiatedProtocol);
  }).bind(this);

  /**
   * Proves the host at `apiUrl` holds the key behind `expectedFingerprint`, by making it sign a
   * challenge this app just generated. This is what an invite link's fingerprint is for, and it runs
   * before any token is ever sent -- so a host that fails it never learns anything.
   */

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

  /**
   * Whether this server can share a screen right now. A host that has never heard of the route
   * answers 404, 426 or 503; those mean "no", not "the connection is broken".
   */

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
          // A host answering the probe with something no build can read is not a host without screen
          // sharing. Every caller of this turns a rejection into `false` or `null`, so a protocol failure
          // that is not recorded here is a host that stays healthy and reconnectable. Both error classes
          // appear here and neither extends the other: the HTTPS arm's `requestJson` raises
          // `RemoteProtocolError` for a body it cannot decode, the WebRTC arm's transport raises a
          // `protocol_error` `RemoteRequestError` -- so checking one of them records half the failures.
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

  /** Forgets an in-flight negotiation. Called when a server is removed or the app stops. */
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
    const value = yield* this.#hostRequestEffect(serverId, TEAM_API_ROUTES.compatibility);
    return yield* remoteDecode(() =>
      webRtcCompatibility(
        this.#appVersion,
        decodeOrProtocolError(decodeTeamProtocolSupportV1, value, sourceText("error.remote.invalidCompatibility")),
      ),
    );
  });

  /**
   * One WebRTC call, with the transport's own failures translated. Every direct `transport.request`
   * went through this once and stopped: a `TeamWebRtcRequestError` that reaches a caller untranslated
   * is invisible to the classifier, so the status codes below and the `protocol_error` the transport
   * raises for a frame it cannot decode both stop meaning anything.
   */
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

  /**
   * Whether the chosen pair may ride an agent creation request to this host: only the create
   * route carries the fields, and only a host advertising the capability reads them.
   */
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

/** A transport failure carries a status and a code; everything else is rethrown untouched. */
function rethrowAsRemoteRequestError(error: unknown): never {
  if (error instanceof TeamWebRtcRequestError) throw new RemoteRequestError(error.status, error.message, error.code);
  throw error;
}
