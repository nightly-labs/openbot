import { AGENT_TEMPLATE_CARD, isAgentTemplateCardPng } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { readRequestBytes } from "./json-body";

/**
 * The share cards of Marketplace listings: the PNG the reviewer's script uploads, and the response
 * that serves it. They have the size and the checks of an agent template card.
 */

/** The PNG in a request body, or null when the body is too large or not a card. */
export const readMarketplaceCard = Effect.fn("readMarketplaceCard")(function* (request: Request) {
  const card = yield* readRequestBytes(request, AGENT_TEMPLATE_CARD.maxBytes).pipe(Effect.orElseSucceed(() => null));
  return card && isAgentTemplateCardPng(card) ? card : null;
});

/**
 * Stored but checked on each use (a cheap 304 by ETag), so a new card after a new version shows at
 * once. R2 leaves out the body when If-None-Match still matches: the image has not changed.
 */
export function marketplaceCardResponse(object: R2Object | R2ObjectBody): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", "image/png");
  headers.set("Cache-Control", "public, no-cache");
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
}
