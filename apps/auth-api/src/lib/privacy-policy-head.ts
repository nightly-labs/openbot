import { PRIVACY_POLICY_META, PRIVACY_POLICY_ROUTE } from "./privacy-policy";
import { OPENBOT_LEGAL_SOCIAL_IMAGE, OPENBOT_X_HANDLE, pageSocialImageMeta } from "./site-metadata";

/** The head of the privacy policy at /privacy-policy and /privacy. The canonical link is /privacy-policy on both. */
export function privacyPolicyHead(siteUrl: string) {
  const url = new URL(PRIVACY_POLICY_ROUTE, siteUrl).toString();
  const { title, description } = PRIVACY_POLICY_META;
  const image = pageSocialImageMeta(OPENBOT_LEGAL_SOCIAL_IMAGE, siteUrl);
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "OpenBot" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: url },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      ...image.openGraph,
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: OPENBOT_X_HANDLE },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      ...image.twitter,
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
