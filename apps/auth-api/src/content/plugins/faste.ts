import type { PluginGuide } from "./plugin-guide";

export const FASTE_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Inspect models and schemas",
      text: "The list_models tool shows the image and video models permitted by your Faste API key, and get_model_schema returns the exact input parameters and enum options before starting a job.",
    },
    {
      title: "Estimate costs before spending",
      text: "The estimate_cost tool calculates the integer credit price (1 Credit = Rp 100) for a prompt and parameter set upfront, and get_account_balance reports available credits, active jobs, and key-level spend limits.",
    },
    {
      title: "Generate images and videos",
      text: "The generate_media tool submits text-to-image, image-to-image, upscaling, and text- or image-to-video jobs with idempotency keys. Credits are reserved atomically and refunded automatically if a render fails.",
    },
    {
      title: "Track jobs and manage top-ups",
      text: "The get_job_status and list_jobs tools monitor asynchronous renders and return direct CDN output links (retained for 30 days). On keys with billing:write scope, create_topup and get_topup_status create and verify QRIS credit top-ups.",
    },
  ],
  faq: [
    {
      question: "Is the Faste MCP server official?",
      answer: "Yes. Faste operates the remote MCP server at api.faste.dev/mcp and documents it at faste.dev/docs.",
    },
    {
      question: "How do I connect Faste?",
      answer:
        "Select Sign in and authorize a Faste API key (sk_live_*) on Faste's browser consent screen. The server uses OAuth 2.1 with dynamic client registration and PKCE (S256). OpenBot keeps the issued access and rotating refresh tokens in encrypted storage, and revoking the source API key immediately invalidates all derived sessions.",
    },
    {
      question: "Does it cost anything?",
      answer:
        "Installing the plugin is free. Generation jobs spend prepaid Faste credits (1 Credit = Rp 100), with no monthly subscription required. Credits are reserved when a job starts and refunded automatically if generation fails.",
    },
    {
      question: "Can I limit what an agent is allowed to spend?",
      answer:
        "Yes. Every OAuth session inherits the source Faste API key's guardrails: allowed scopes (for example omitting billing:write), model allowlists, per-job credit caps, daily spend caps, and key expiration.",
    },
    {
      question: "What data does Faste receive?",
      answer:
        "Faste receives the prompts, model parameters, and reference media URLs that the agent submits. Uploaded inputs expire after 24 hours and generated outputs on obj.faste.dev expire after 30 days. Your OpenBot workspaces, conversations, and local files stay on your computer.",
    },
  ],
  sources: [
    { label: "Faste", url: "https://faste.dev" },
    { label: "Faste: Documentation", url: "https://faste.dev/docs" },
    { label: "Faste: Privacy Policy", url: "https://faste.dev/privacy" },
    { label: "Faste: Terms of Service", url: "https://faste.dev/terms" },
    {
      label: "Faste MCP server: OAuth authorization server metadata",
      url: "https://api.faste.dev/.well-known/oauth-authorization-server",
    },
  ],
  checkedAt: "2026-11-26",
};
