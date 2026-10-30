import { createFileRoute } from "@tanstack/solid-router";
import { PrivacyPolicyPage } from "../components/legal/PrivacyPolicyPage";
import { privacyPolicyHead } from "../lib/privacy-policy-head";

// A short address for the privacy policy. It shows the same page.
export const Route = createFileRoute("/privacy")({
  head: ({ match }) => privacyPolicyHead(match.context.siteUrl),
  component: PrivacyPolicyPage,
});
