import type { MessagingOverview, MessagingThread } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { MESSAGING_CAPABILITY, MESSAGING_ROUTES } from "@openbot/contracts/team-protocol/messaging-v1";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import {
  parseMessagingAgentInput,
  parseReadMessagingThreadInput,
  parseSetMessagingEnabledInput,
} from "../ipc/messaging-inputs";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent } from "./request-helpers";

/** The bounds `messaging-v1` froze. The host cuts to them, so a reply never fails closed on the client. */
const WIRE_NAME = 256;
const WIRE_TEXT = 20_000;
const WIRE_THREADS = 200;
const WIRE_WORKSPACES = 50;
const WIRE_MESSAGES = 200;

/**
 * The Slack connection of an agent on this computer, managed from a joined server. Frozen by
 * `messaging-v1`. `requireAdmin` runs on every route. No response carries a token, and no error
 * message quotes the request.
 */
export async function routeMessaging(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  const messaging = admin?.messaging;
  if (!messaging || !capabilities.has(MESSAGING_CAPABILITY))
    throw new HttpError(400, sourceText("error.messaging.unsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  try {
    switch (url.pathname) {
      case MESSAGING_ROUTES.overview:
        return json(200, wireOverview(messaging.overview(parsed(parseMessagingAgentInput, body).agentId)));
      case MESSAGING_ROUTES.reconnect:
        return json(200, wireOverview(await messaging.reconnect(parsed(parseMessagingAgentInput, body).agentId)));
      case MESSAGING_ROUTES.setEnabled: {
        const input = parsed(parseSetMessagingEnabledInput, body);
        return json(200, wireOverview(await messaging.setEnabled(input.agentId, input.enabled)));
      }
      case MESSAGING_ROUTES.disconnect:
        return json(200, wireOverview(await messaging.disconnect(parsed(parseMessagingAgentInput, body).agentId)));
      default: {
        const input = parsed(parseReadMessagingThreadInput, body);
        return json(200, wireThread(messaging.readThread(input.agentId, input.linkId)));
      }
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // A refused token or an unknown agent is a sentence for the admin, not a host fault. Slack can
    // quote what it was sent, so the message leaves this computer redacted.
    if (error instanceof Error) throw new HttpError(409, redactText(error.message));
    throw error;
  }
}

const ROUTES = new Set<string>(Object.values(MESSAGING_ROUTES));

function parsed<T>(parse: (value: DynamicRecord) => T, body: DynamicRecord): T {
  try {
    return parse(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid messaging request.");
  }
}

function wireOverview(overview: MessagingOverview): MessagingOverview {
  const { connection } = overview;
  return {
    connection: connection && {
      ...connection,
      workspaceName: connection.workspaceName?.slice(0, WIRE_NAME) ?? null,
      botUserId: connection.botUserId?.slice(0, WIRE_NAME) ?? null,
    },
    threads: overview.threads
      .slice(0, WIRE_THREADS)
      .map((thread) => ({ ...thread, title: thread.title.slice(0, WIRE_NAME) })),
    slackWorkspaces: overview.slackWorkspaces
      .slice(0, WIRE_WORKSPACES)
      .map((workspace) => ({ ...workspace, name: workspace.name.slice(0, WIRE_NAME) })),
  };
}

function wireThread(thread: MessagingThread): MessagingThread {
  return {
    linkId: thread.linkId,
    title: thread.title.slice(0, WIRE_NAME),
    messages: thread.messages.slice(-WIRE_MESSAGES).map((message) => ({
      ...message,
      authorName: message.authorName?.slice(0, WIRE_NAME) ?? null,
      text: message.text.slice(0, WIRE_TEXT),
    })),
  };
}
