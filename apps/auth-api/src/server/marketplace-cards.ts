import { AGENT_TEMPLATE_CARD, isAgentTemplateCardPng } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { readRequestBytes } from "./json-body";

export const readMarketplaceCard = Effect.fn("readMarketplaceCard")(function* (request: Request) {
  const card = yield* readRequestBytes(request, AGENT_TEMPLATE_CARD.maxBytes).pipe(Effect.orElseSucceed(() => null));
  return card && isAgentTemplateCardPng(card) ? card : null;
});

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
