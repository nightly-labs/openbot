import { isNotFound } from "@tanstack/solid-router";
import {
  OPENBOT_SOCIAL_IMAGE_ALT,
  OPENBOT_SOCIAL_IMAGE_META,
  OPENBOT_SOCIAL_IMAGE_URL,
  OPENBOT_X_HANDLE,
  type PageSocialImage,
  pageSocialImageMeta,
} from "../../lib/site-metadata";
import { isMarketplaceMissingData } from "./MarketplaceMissingPage";
import type { MarketplaceHeadText, MarketplaceListingHeadText } from "./marketplace-page-text";

const NOINDEX = { name: "robots", content: "noindex, nofollow" } as const;

function pageMeta(url: string, text: MarketplaceHeadText) {
  return [
    { title: text.title },
    { name: "description", content: text.description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "OpenBot" },
    { property: "og:url", content: url },
    { property: "og:title", content: text.title },
    { property: "og:description", content: text.description },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:site", content: OPENBOT_X_HANDLE },
    { name: "twitter:title", content: text.title },
    { name: "twitter:description", content: text.description },
  ];
}

const MARKETPLACE_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/marketplace.jpg",
  alt: "Your kind of team. Four OpenBot agents in front of a rainbow",
};

export function marketplaceIndexHead(route: string, siteUrl: string, text: MarketplaceHeadText | undefined) {
  const url = new URL(route, siteUrl).toString();
  if (!text) return { links: [{ rel: "canonical", href: url }] };
  const image = pageSocialImageMeta(MARKETPLACE_SOCIAL_IMAGE, siteUrl);
  return {
    meta: [...pageMeta(url, text), ...image.openGraph, ...image.twitter],
    links: [{ rel: "canonical", href: url }],
  };
}

export interface MarketplaceListingHeadInput {
  path: string;
  text: MarketplaceListingHeadText;
  cardUrl: string | null | undefined;
  pending: boolean;
}

export async function marketplaceListingHead(input: MarketplaceListingHeadInput, siteUrl: string) {
  const url = new URL(input.path, siteUrl).toString();
  const { AGENT_TEMPLATE_CARD } = await import("@openbot/contracts/ipc");
  const cardUrl = input.cardUrl ? new URL(input.cardUrl, siteUrl).toString() : null;
  const card = cardUrl
    ? [
        { property: "og:image", content: cardUrl },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: String(AGENT_TEMPLATE_CARD.width) },
        { property: "og:image:height", content: String(AGENT_TEMPLATE_CARD.height) },
        { property: "og:image:alt", content: input.text.imageAlt },
        { name: "twitter:image", content: cardUrl },
        { name: "twitter:image:alt", content: input.text.imageAlt },
      ]
    : [
        ...OPENBOT_SOCIAL_IMAGE_META,
        { name: "twitter:image", content: OPENBOT_SOCIAL_IMAGE_URL },
        { name: "twitter:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
      ];
  return {
    meta: [...pageMeta(url, input.text), ...(input.pending ? [NOINDEX] : []), ...card],
    links: [{ rel: "canonical", href: url }],
  };
}

export function marketplaceMissingHead(error: unknown) {
  if (!isNotFound(error)) return {};
  const data = error.data;
  if (!isMarketplaceMissingData(data)) return { meta: [NOINDEX] };
  return { meta: [{ title: data.text.title }, NOINDEX] };
}

export function marketplaceListingHeaders(pending: boolean): Record<string, string> {
  if (!pending) return {};
  return { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "private, no-store" };
}
