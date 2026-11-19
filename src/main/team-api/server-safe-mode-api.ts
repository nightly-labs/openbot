// The Team API of a server in safe mode (`../server-safe-mode.ts`). The server stopped its start loop,
// so its services, its database and its normal `TeamApiServer` do not run. This API answers only:
//
// - `compatibility`, above the protocol gate as in `TeamApiServer`. It offers protocol 10 only, so
//   a client of protocol 1-9 reads that it must update. A protocol 10 client reads the
//   `server-safe-mode-v1` capability and no other.
// - `server-safe-mode-v1` `GET /v1/server/safe-mode`, for each signed-in member of any role.
//
// It refuses each other route and each WebSocket upgrade. Nothing here writes: no route signs in, joins
// or changes a value. The reason is a fixed word, the app version and a time, never a path or an
// error text.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { TeamMemberSummary } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { encodeTeamCapabilitiesV10 } from "@openbot/contracts/team-protocol/current";
import {
  SERVER_SAFE_MODE_CAPABILITY,
  SERVER_SAFE_MODE_ROUTES,
  type ServerSafeModeReason,
} from "@openbot/contracts/team-protocol/server-safe-mode-v1";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
  type TeamProtocolSupportV1,
} from "@openbot/contracts/team-protocol/v1";
import { TEAM_PROTOCOL_V10, type TeamProtocolSupportV10 } from "@openbot/contracts/team-protocol/v10";
import { sourceText } from "@openbot/i18n/source";
import { bearerToken, firstHeaderValue, requestCapabilityListsV10, requestProtocol } from "./request-helpers";

export interface ServerSafeModeApiOptions {
  reason: ServerSafeModeReason;
  /** The member of a session token, or null. It reads the team file and the open WebRTC sessions only. */
  authenticate(token: string): TeamMemberSummary | null;
}

type SafeModeSupport = TeamProtocolSupportV1 | TeamProtocolSupportV10;

/** The error bodies of `TeamApiServer`. */
interface SafeModeErrorBody {
  error: string;
  code?: string;
  host?: SafeModeSupport;
}

type SafeModeBody = SafeModeSupport | SafeModeErrorBody | ServerSafeModeReason;

/** The compatibility answer. A protocol 10 request gets the two protocol 10 lists. */
function serverSafeModeCompatibility(appVersion: string, protocol: number | null): SafeModeSupport {
  const support: TeamProtocolSupportV1 = {
    appVersion,
    protocol: { minimum: TEAM_PROTOCOL_V10, maximum: TEAM_PROTOCOL_V10 },
    capabilities: [],
  };
  return protocol !== null && protocol >= TEAM_PROTOCOL_V10
    ? { ...support, ...encodeTeamCapabilitiesV10([SERVER_SAFE_MODE_CAPABILITY]) }
    : support;
}

function send(response: ServerResponse, status: number, value: SafeModeBody): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

/**
 * The protocol gate, with the bodies of `TeamApiServer`: a client of protocol 1-9 must update. A
 * client of a newer protocol always offers protocol 10 too, so it never sends a higher one here.
 */
function protocolIssue(
  request: IncomingMessage,
  appVersion: string,
): { status: number; body: SafeModeErrorBody } | null {
  const rawProtocol = firstHeaderValue(request.headers[TEAM_PROTOCOL_VERSION_HEADER.toLowerCase()]);
  const clientAppVersion = firstHeaderValue(request.headers[TEAM_APP_VERSION_HEADER.toLowerCase()]);
  const host = serverSafeModeCompatibility(appVersion, null);
  const clientUpdate = {
    status: 426,
    body: { error: sourceText("error.team.clientUpdateRequired"), code: "client_update_required", host },
  };
  if (!rawProtocol || !clientAppVersion) return clientUpdate;
  const protocol = Number(rawProtocol);
  const malformed = {
    status: 400,
    body: { error: "Invalid Team API protocol headers.", code: "protocol_error", host },
  };
  if (!Number.isSafeInteger(protocol) || protocol < 1 || protocol > 65_535 || clientAppVersion.length > 64)
    return malformed;
  if (protocol < TEAM_PROTOCOL_V10) return clientUpdate;
  if (protocol > TEAM_PROTOCOL_V10)
    return {
      status: 426,
      body: { error: sourceText("error.team.hostUpdateRequired"), code: "host_update_required", host },
    };
  return requestCapabilityListsV10(request) ? null : malformed;
}

/** Answers one HTTP request of the safe-mode API. It reads no request body. */
export function handleServerSafeModeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServerSafeModeApiOptions,
): void {
  const method = request.method ?? "GET";
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const appVersion = options.reason.appVersion;
  if (method === "GET" && path === TEAM_API_ROUTES.compatibility) {
    send(response, 200, serverSafeModeCompatibility(appVersion, requestProtocol(request)));
    return;
  }
  const issue = protocolIssue(request, appVersion);
  if (issue) {
    send(response, issue.status, issue.body);
    return;
  }
  if (method !== "GET" || path !== SERVER_SAFE_MODE_ROUTES.reason) {
    send(response, 503, { error: sourceText("error.team.serverSafeMode"), code: "server_safe_mode" });
    return;
  }
  const token = bearerToken(firstHeaderValue(request.headers.authorization));
  if (!token || !options.authenticate(token)) {
    send(response, 401, { error: sourceText("error.team.authenticationRequired") });
    return;
  }
  const { reason, haltedAt } = options.reason;
  send(response, 200, { reason, appVersion, haltedAt });
}

/** The events socket and every other upgrade: safe mode sends no events. */
export function refuseServerSafeModeUpgrade(socket: Duplex): void {
  socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
  socket.destroy();
}
