// Direct messages between two people on the team.
//
// Every handler goes through the server's own DM facade rather than the chat store, because that
// facade is where the recipient check and the realtime publish live. Its refusals are `HttpError`s:
// 400 for a message to yourself, 403 when the sender has no team access, and 404 when the recipient
// is not on the team or is disabled. A member list can be out of date, so these are client errors,
// not 500s for the error log.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  DirectConversationPage,
  DirectConversationPageAnchor,
  DirectConversationReadState,
  DirectConversationSnapshot,
  DirectMessage,
  DirectThreadSummary,
} from "@openbot/contracts/ipc";
import { isNumber } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { pageAnchor, pageLimit, pathIdentifier, readJson, stringField } from "./request-helpers";

export interface DirectRouteDependencies {
  listDirectThreads: (memberId: string) => DirectThreadSummary[];
  readDirectConversation: (memberId: string, otherMemberId: string) => DirectConversationSnapshot;
  readDirectConversationPage: (
    memberId: string,
    otherMemberId: string,
    anchor: DirectConversationPageAnchor,
    limit: number,
  ) => DirectConversationPage;
  sendDirectMessage: (
    senderMemberId: string,
    input: { memberId: string; text: string; clientMessageId: string },
  ) => DirectMessage;
  markDirectRead: (memberId: string, otherMemberId: string, throughSequence: number) => DirectConversationReadState;
}

export async function routeDirect(
  context: TeamApiRequestContext,
  {
    listDirectThreads,
    readDirectConversation,
    readDirectConversationPage,
    sendDirectMessage,
    markDirectRead,
  }: DirectRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, member, json } = context;

  if (method === "GET" && url.pathname === TEAM_API_ROUTES.direct.threads) {
    return json(200, listDirectThreads(member.id));
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.direct.messages) {
    const body = await readJson(request);
    return json(
      201,
      sendDirectMessage(member.id, {
        memberId: stringField(body, "memberId", false, INPUT_LIMITS.identifier),
        text: stringField(body, "text", false, INPUT_LIMITS.directMessageText),
        clientMessageId: stringField(body, "clientMessageId", false, INPUT_LIMITS.identifier),
      }),
    );
  }
  const directConversationMatch = url.pathname.match(/^\/v1\/direct\/conversations\/([^/]+)(?:\/(read|page))?$/);
  if (method === "GET" && directConversationMatch && !directConversationMatch[2]) {
    return json(200, readDirectConversation(member.id, pathIdentifier(directConversationMatch[1], "memberId")));
  }
  if (method === "POST" && directConversationMatch?.[2] === "read") {
    const body = await readJson(request);
    const throughSequence = body.throughSequence;
    if (!isNumber(throughSequence) || !Number.isSafeInteger(throughSequence)) {
      throw new HttpError(400, "Invalid direct-message read boundary.");
    }
    return json(
      200,
      markDirectRead(member.id, pathIdentifier(directConversationMatch[1], "memberId"), throughSequence),
    );
  }
  if (method === "GET" && directConversationMatch?.[2] === "page") {
    return json(
      200,
      readDirectConversationPage(
        member.id,
        pathIdentifier(directConversationMatch[1], "memberId"),
        pageAnchor(url),
        pageLimit(url),
      ),
    );
  }

  return "unmatched";
}
