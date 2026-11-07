import { createFileRoute } from "@tanstack/solid-router";
import { PrivacyPolicyPage } from "../components/legal/PrivacyPolicyPage";
import { privacyPolicyHead } from "../lib/privacy-policy-head";

export const Route = createFileRoute("/privacy-policy")({
  head: ({ match }) => privacyPolicyHead(match.context.siteUrl),
  component: PrivacyPolicyPage,
});
