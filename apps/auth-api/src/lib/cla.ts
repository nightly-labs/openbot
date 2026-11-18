// The route and dates of the /cla page. The text is in `content/cla.tsx`.

export const CLA_ROUTE = "/cla";

/** The PDF that a contributor fills in, signs and sends back. It is in `public/`. */
export const CLA_PDF_PATH = "/openbot-cla.pdf";

/** The "Last updated" date on the page. Change it when the text changes. */
export const CLA_UPDATED_AT = "2026-11-04";

export const CLA_META = {
  title: "OpenBot Contributor License Agreement",
  description:
    "The copyright and patent licenses that individual and corporate contributors give to OpenBot for their contributions, and how to sign the agreement.",
} as const;
