// The route and dates of the /privacy-policy page. The text is in `content/privacy-policy.tsx`.
//
// No JSX here, for the same reason `teams-page.ts` holds none: the sitemap imports it.

export const PRIVACY_POLICY_ROUTE = "/privacy-policy";

/** The "Last updated" date on the page and in the sitemap. Change it when the text changes. */
export const PRIVACY_POLICY_UPDATED_AT = "2026-10-29";

export const PRIVACY_POLICY_META = {
  title: "OpenBot Privacy Policy",
  description:
    "How Synthetify Labs processes personal data when you use OpenBot: what we collect, why, who receives it, how long we keep it, and your rights.",
} as const;
