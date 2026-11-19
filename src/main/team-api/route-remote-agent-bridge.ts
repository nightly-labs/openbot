import type { IncomingMessage } from "node:http";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  isRemoteAgentBridgePeerPath,
  REMOTE_AGENT_BRIDGE_CAPABILITY,
  REMOTE_AGENT_BRIDGE_ROUTES,
} from "@openbot/contracts/team-protocol/remote-agent-bridge-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { RemoteAgentBridgeError, type RemoteAgentBridgeMessage } from "../../backend/remote-agent-bridge";
import { readBodyWithin } from "../http-body";
import { RemoteAgentBridgeReachError } from "../remote-agent-bridge-reach";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { bearerToken, readJson, requireAdmin } from "./request-helpers";

const MEMBER_PATHS: ReadonlySet<string> = new Set([
  REMOTE_AGENT_BRIDGE_ROUTES.invites,
  REMOTE_AGENT_BRIDGE_ROUTES.createInvite,
  REMOTE_AGENT_BRIDGE_ROUTES.revokeInvite,
  REMOTE_AGENT_BRIDGE_ROUTES.redeem,
  REMOTE_AGENT_BRIDGE_ROUTES.links,
  REMOTE_AGENT_BRIDGE_ROUTES.revokeLink,
  REMOTE_AGENT_BRIDGE_ROUTES.prepareReach,
  REMOTE_AGENT_BRIDGE_ROUTES.reachStatus,
]);

const MESSAGE_BODY_LIMIT = Math.ceil(ATTACHMENT_LIMITS.totalBytes * 1.4) + 1024 * 1024;
const acceptAttempts = new Map<string, { count: number; resetAt: number }>();

export function remoteAgentBridgePeerPath(pathname: string): boolean {
  return isRemoteAgentBridgePeerPath(pathname);
}

function asBridgeError(error: unknown): never {
  if (error instanceof RemoteAgentBridgeError) throw new HttpError(error.status, error.message);
  if (error instanceof RemoteAgentBridgeReachError) throw new HttpError(error.status, error.message);
  throw error;
}

function asReachCause(error: unknown): never {
  if (error instanceof RemoteAgentBridgeReachError) throw new HttpError(error.status, error.message);
  throw error;
}

export async function routeRemoteAgentBridge(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  if (context.method !== "POST" || !MEMBER_PATHS.has(context.url.pathname)) return "unmatched";
  const bridge = admin?.remoteAgentBridge;
  if (!bridge) return "unmatched";
  if (!context.capabilities.has(REMOTE_AGENT_BRIDGE_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.remoteAgentBridgeUnsupported"));
  requireAdmin(context.member);
  const path = context.url.pathname;
  if (path === REMOTE_AGENT_BRIDGE_ROUTES.invites) {
    return context.json(200, { invites: bridge.listInvites() });
  }
  if (path === REMOTE_AGENT_BRIDGE_ROUTES.links) {
    return context.json(200, { links: bridge.listLinks() });
  }
  if (path === REMOTE_AGENT_BRIDGE_ROUTES.createInvite) {
    const invite = await runCauseEffect(bridge.createInvite(admin?.serverName?.() ?? "OpenBot")).catch(asBridgeError);
    return context.json(201, invite);
  }
  const bridgeReach = admin?.remoteAgentBridgeReach;
  if (path === REMOTE_AGENT_BRIDGE_ROUTES.reachStatus) {
    if (!bridgeReach) throw new HttpError(400, sourceText("error.backend.remoteAgentBridgeUnsupported"));
    const status = await bridgeReach.status();
    return context.json(200, status);
  }
  if (path === REMOTE_AGENT_BRIDGE_ROUTES.prepareReach) {
    if (!bridgeReach) throw new HttpError(400, sourceText("error.backend.remoteAgentBridgeUnsupported"));
    const status = await runCauseEffect(bridgeReach.prepare()).catch(asReachCause);
    return context.json(200, status);
  }
  const body = await readJson(context.request);
  if (path === REMOTE_AGENT_BRIDGE_ROUTES.revokeInvite) {
    if (!isString(body.inviteId)) throw new HttpError(400, sourceText("error.team.invalidRequest"));
    bridge.revokeInvite(body.inviteId);
    return context.json(200, {});
  }
  if (path === REMOTE_AGENT_BRIDGE_ROUTES.revokeLink) {
    if (!isString(body.linkId)) throw new HttpError(400, sourceText("error.team.invalidRequest"));
    await runCauseEffect(bridge.revokeLink(body.linkId)).catch(asBridgeError);
    return context.json(200, {});
  }
  if (!isString(body.code)) throw new HttpError(400, sourceText("error.team.invalidRequest"));
  const link = await runCauseEffect(bridge.redeem(body.code, admin?.serverName?.() ?? "OpenBot")).catch(asBridgeError);
  return context.json(200, link);
}

export async function routeRemoteAgentBridgePeer(
  request: IncomingMessage,
  pathname: string,
  address: string,
  admin: TeamApiAdmin | undefined,
  json: (status: number, value: object | null) => void,
): Promise<void> {
  const bridge = admin?.remoteAgentBridge;
  if (!bridge || request.method !== "POST") {
    json(401, { error: sourceText("error.team.authenticationRequired") });
    return;
  }
  const token = bearerToken(request.headers.authorization);
  try {
    if (pathname === REMOTE_AGENT_BRIDGE_ROUTES.accept) {
      if (!allowAccept(address)) {
        json(429, { error: sourceText("error.backend.remoteAgentBridgePeerDown") });
        return;
      }
      const body = await readJson(request);
      if (
        !isString(body.secret) ||
        !isString(body.peerReach) ||
        !isString(body.peerName) ||
        !isString(body.peerToken)
      ) {
        json(401, { error: sourceText("error.team.authenticationRequired") });
        return;
      }
      const accepted = await runCauseEffect(
        bridge.accept({
          secret: body.secret,
          peerReach: body.peerReach,
          peerName: body.peerName,
          peerToken: body.peerToken,
        }),
      );
      json(200, accepted);
      return;
    }
    if (pathname === REMOTE_AGENT_BRIDGE_ROUTES.agents) {
      json(200, await runCauseEffect(bridge.agentsForPeer(token)));
      return;
    }
    if (pathname === REMOTE_AGENT_BRIDGE_ROUTES.peerRevoke) {
      await runCauseEffect(bridge.revokeFromPeer(token));
      json(200, {});
      return;
    }
    const raw = await readBodyWithin(request, MESSAGE_BODY_LIMIT);
    if (raw === null) {
      json(413, { error: sourceText("error.backend.remoteAgentBridgeFileTooLarge") });
      return;
    }
    const parsed = JSON.parse(raw.toString("utf8"));
    if (!isRemoteMessage(parsed)) {
      json(400, { error: sourceText("error.team.invalidRequest") });
      return;
    }
    json(200, await runCauseEffect(bridge.enqueueFromPeer(token, parsed)));
  } catch (error) {
    if (error instanceof RemoteAgentBridgeError) {
      json(error.status, { error: error.message });
      return;
    }
    if (error instanceof HttpError) {
      json(error.status, { error: error.message });
      return;
    }
    json(401, { error: sourceText("error.team.authenticationRequired") });
  }
}

function allowAccept(address: string): boolean {
  const now = Date.now();
  const entry = acceptAttempts.get(address);
  if (!entry || entry.resetAt <= now) {
    acceptAttempts.set(address, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 20;
}

function isRemoteMessage(value: unknown): value is RemoteAgentBridgeMessage {
  if (!isDynamicRecord(value)) return false;
  if (!isString(value.senderAgentId) || !isString(value.senderAgentName) || !isString(value.senderServerName))
    return false;
  if (!isString(value.recipientAgentId) || !isString(value.text)) return false;
  if (value.replyToMessageId !== undefined && value.replyToMessageId !== null && !isString(value.replyToMessageId))
    return false;
  if (value.files === undefined) return true;
  return (
    Array.isArray(value.files) &&
    value.files.every(
      (file) => isDynamicRecord(file) && isString(file.name) && isString(file.data) && file.name.length <= 255,
    )
  );
}
