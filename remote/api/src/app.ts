import type { RemoteAuthEvent } from "@openbot/contracts/signal-protocol/auth-events";
import { SLACK_EVENTS_PATH } from "@openbot/contracts/signal-protocol/slack-route";
import { Elysia } from "elysia";
import { z } from "zod";
import type { RemoteApiConfig } from "./config";
import { SLACK_DELIVERY_BODY_BYTES_LIMIT, type SlackDeliveryKind } from "./protocol";
import type { SignalService, SignalSocket, SlackDeliveryResponse } from "./signal-service";
import { verifySlackSignature, verifyWebhookSignature } from "./tokens";

const SLACK_TEAM_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const SLACK_RETRY_REASON_PATTERN = /^[a-z0-9_]{1,64}$/u;

const slackRequestSchema = z.object({
  type: z.string().optional(),
  challenge: z.string().max(1_024).optional(),
  team_id: z.string().optional(),
  team: z.object({ id: z.string() }).nullish(),
  authorizations: z.array(z.object({ team_id: z.string() })).optional(),
});

const authEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("account-profile-changed"), userId: z.string().min(1) }),
  z.object({ type: z.literal("account-servers-changed"), userId: z.string().min(1) }),
  z.object({
    type: z.literal("remote-auth-changed"),
    hostId: z.string().min(1),
    authEpoch: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("remote-session-ended"),
    hostId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  z.object({
    type: z.literal("slack-route-revoked"),
    teamId: z.string().min(1),
    through: z.number().int().nonnegative(),
  }),
]) satisfies z.ZodType<RemoteAuthEvent>;

export function createRemoteApiApp(config: RemoteApiConfig, signal: SignalService) {
  const app = new Elysia()
    .get("/health/live", () => ({ service: "openbot-remote-api", status: "live" }))
    .get("/health/ready", () => ({ service: "openbot-remote-api", status: "ready" }))
    .post("/internal/auth-events", async ({ request, set }) => {
      const timestamp = request.headers.get("OpenBot-Timestamp") ?? "";
      const signature = request.headers.get("OpenBot-Signature") ?? "";
      const body = await request.text();
      if (!verifyWebhookSignature(body, timestamp, signature, config.authWebhookSecret)) {
        set.status = 401;
        return { error: { code: "invalid_signature", message: "The auth event signature is invalid." } };
      }
      const event = decodeAuthEvent(body);
      if (!event) {
        set.status = 400;
        return { error: { code: "invalid_event", message: "The auth event is invalid." } };
      }
      if (event.type === "remote-auth-changed") signal.revoke(event.hostId, event.authEpoch);
      else if (event.type === "account-profile-changed") signal.profileChanged(event.userId);
      else if (event.type === "account-servers-changed") signal.serversChanged(event.userId);
      else if (event.type === "slack-route-revoked") signal.revokeSlackRoute(event.teamId, event.through);
      else signal.revokeSession(event.sessionId);
      return new Response(null, { status: 204 });
    })
    // The OpenBot Slack app's one request URL, for the events and button presses of every
    // workspace. Signal checks Slack's signature, reads only the workspace ID, and passes the exact
    // body to the ingress socket of the host that the workspace is linked to. Nothing here stores or
    // logs the body.
    .post(
      SLACK_EVENTS_PATH,
      async ({ request, server }) => {
        if (config.slackSigningSecrets.length === 0) return slackResponse({ status: 503 });
        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (!Number.isFinite(declaredLength) || declaredLength > SLACK_DELIVERY_BODY_BYTES_LIMIT) {
          return slackResponse({ status: 413 });
        }
        const kind = slackDeliveryKind(request.headers.get("content-type"));
        if (!kind) return slackResponse({ status: 415 });
        const body = new Uint8Array(await request.arrayBuffer());
        if (body.byteLength > SLACK_DELIVERY_BODY_BYTES_LIMIT) return slackResponse({ status: 413 });
        const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
        const signature = request.headers.get("x-slack-signature") ?? "";
        if (!config.slackSigningSecrets.some((secret) => verifySlackSignature(body, timestamp, signature, secret))) {
          const address = signalClientIp(
            server?.requestIP(request)?.address,
            request.headers.get("x-forwarded-for"),
            config.trustProxy,
          );
          return slackResponse({ status: signal.acceptSlackRequest(`address:${address}`) ? 401 : 429 });
        }
        const slack = slackRequest(kind, body);
        if (!slack) return slackResponse({ status: 400 });
        if ("challenge" in slack) {
          return slackResponse({ status: 200, contentType: "text/plain", body: slack.challenge });
        }
        if (!signal.acceptSlackRequest(`team:${slack.teamId}`)) return slackResponse({ status: 429 });
        const retryNum = Number(request.headers.get("x-slack-retry-num") ?? "");
        const retryReason = request.headers.get("x-slack-retry-reason");
        return slackResponse(
          await signal.deliverSlack(slack.teamId, {
            kind,
            retryNum: Number.isInteger(retryNum) && retryNum >= 0 && retryNum < 100 ? retryNum : null,
            retryReason: retryReason && SLACK_RETRY_REASON_PATTERN.test(retryReason) ? retryReason : null,
            body,
          }),
        );
      },
      { parse: "none" },
    )
    .ws("/v1/signal", {
      idleTimeout: 120,
      maxPayloadLength: 64 * 1024,
      backpressureLimit: 256 * 1024,
      closeOnBackpressureLimit: true,
      perMessageDeflate: false,
      sendPings: true,
      open(ws) {
        signal.connect(socketAdapter(ws, config.trustProxy));
      },
      async message(ws, message) {
        const socket = socketAdapter(ws, config.trustProxy);
        const textMessage = z.string().safeParse(message);
        const input = textMessage.success
          ? textMessage.data
          : message instanceof Uint8Array
            ? message
            : JSON.stringify(message);
        await signal.receive(socket, input);
      },
      close(ws) {
        signal.disconnect(socketAdapter(ws, config.trustProxy));
      },
      error({ error }) {
        console.error("Remote signal WebSocket failed.", error instanceof Error ? error.message : "Unknown error");
      },
    });
  return app;
}

interface ElysiaSocketLike {
  id: string;
  data?: { request?: Request };
  remoteAddress?: string;
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
}

function socketAdapter(ws: ElysiaSocketLike, trustProxy: boolean): SignalSocket {
  return {
    id: ws.id,
    ip: signalClientIp(ws.remoteAddress, ws.data?.request?.headers.get("x-forwarded-for"), trustProxy),
    send: (message) => {
      ws.send(message);
    },
    close: (code, reason) => ws.close(code, reason.slice(0, 123)),
  };
}

export function signalClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | null | undefined,
  trustProxy: boolean,
) {
  if (!trustProxy) return remoteAddress ?? "unknown";
  const forwarded = forwardedFor?.split(",", 1)[0]?.trim();
  return forwarded || remoteAddress || "unknown";
}

function slackDeliveryKind(contentType: string | null): SlackDeliveryKind | null {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/json") return "events";
  if (mediaType === "application/x-www-form-urlencoded") return "interactivity";
  return null;
}

/**
 * The only parts of a signed Slack request that Signal reads: the `url_verification` challenge, which
 * Signal answers itself, or the workspace ID that picks the host. Events carry it as `team_id`, and
 * button presses as `payload.team.id`.
 */
function slackRequest(kind: SlackDeliveryKind, body: Uint8Array): { challenge: string } | { teamId: string } | null {
  let value: unknown;
  try {
    const text = new TextDecoder().decode(body);
    value = kind === "events" ? JSON.parse(text) : JSON.parse(new URLSearchParams(text).get("payload") ?? "null");
  } catch {
    return null;
  }
  const parsed = slackRequestSchema.safeParse(value);
  if (!parsed.success) return null;
  if (kind === "events" && parsed.data.type === "url_verification" && parsed.data.challenge) {
    return { challenge: parsed.data.challenge };
  }
  const teamId = parsed.data.team_id ?? parsed.data.team?.id ?? parsed.data.authorizations?.[0]?.team_id;
  return teamId && SLACK_TEAM_PATTERN.test(teamId) ? { teamId } : null;
}

function slackResponse(response: SlackDeliveryResponse | { status: 413 | 415 | 429 | 401 | 400 | 503 }): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if ("contentType" in response && response.contentType && response.body !== undefined) {
    headers["Content-Type"] = response.contentType;
    return new Response(response.body, { status: response.status, headers });
  }
  return new Response(null, { status: response.status, headers });
}

function decodeAuthEvent(body: string): RemoteAuthEvent | null {
  try {
    const result = authEventSchema.safeParse(JSON.parse(body));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function prometheusMetrics(signal: SignalService): string {
  const metrics = signal.metrics();
  return [
    "# TYPE openbot_remote_signal_sockets gauge",
    `openbot_remote_signal_sockets ${metrics.activeSockets}`,
    "# TYPE openbot_remote_peer_connections gauge",
    `openbot_remote_peer_connections ${metrics.activePeerConnections}`,
    "# TYPE openbot_remote_signal_messages_total counter",
    `openbot_remote_signal_messages_total ${metrics.relayedMessages}`,
    "# TYPE openbot_remote_auth_failures_total counter",
    `openbot_remote_auth_failures_total ${metrics.authenticationFailures}`,
    "# TYPE openbot_remote_protocol_failures_total counter",
    `openbot_remote_protocol_failures_total ${metrics.protocolFailures}`,
    "# TYPE openbot_remote_slack_deliveries_total counter",
    `openbot_remote_slack_deliveries_total ${metrics.slackDeliveries}`,
    "# TYPE openbot_remote_slack_deliveries_unavailable_total counter",
    `openbot_remote_slack_deliveries_unavailable_total ${metrics.slackDeliveriesUnavailable}`,
    "",
  ].join("\n");
}
