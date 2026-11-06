import type { PluginGuide } from "./plugin-guide";

// Features, allowances, and usage figures were checked on Pagey's public pages on checkedAt.
// The usage figures are reported by Pagey and include anonymous creators, not only accounts.
export const PAGEY_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Publish a site from your conversation",
      text: "Ask your OpenBot agent to publish a portfolio, project demo, landing page, or event site. The plugin previews the build files, uploads an HTML file, ZIP archive, or static build folder, and returns a live HTTPS address. Pagey handles HTTPS certificates for its hosted addresses.",
    },
    {
      title: "Keep your address when the site changes",
      text: "Update an existing site by its site ID. The agent checks that the files match your preview before replacing the content. You can choose a custom Pagey subdomain when you create a site, change its title or expiry, and enable or disable maintenance mode.",
    },
    {
      title: "Read full visitor analytics",
      text: "Read page views, unique visitors, referrers, countries, device and browser details, and UTM data, with 90-day retention. Ask the agent about a date range, or use the analytics dashboard in Pagey.",
    },
    {
      title: "Use Pagey's free dashboard tools",
      text: "Pagey also provides password-protected sites, expiring secure share links, site management and a file browser, an AI site builder, and a custom form builder with a built-in form backend. Build contact, waitlist, or feedback forms, embed them in your site, and read or export responses. These dashboard features are free for registered accounts, within usage allowances.",
    },
  ],
  faq: [
    {
      question: "Is Pagey Site free, and how many sites can I publish?",
      answer:
        "Pagey's current offering makes all registered features free, with no subscription or credit card required and no cap on total sites. Registered accounts can create 25 new sites per UTC day. Updating an existing site does not consume that allowance. Upload, request-rate, AI, and form limits apply. Pagey reports more than 10,000 published sites and more than 4,000 users, including anonymous creators, as of October 28, 2026.",
    },
    {
      question: "Which features can I use from OpenBot?",
      answer:
        "The plugin previews and publishes files, lists sites, updates existing content at the same address, changes titles and expiry dates, enables or disables maintenance mode, and reads analytics. You can choose a custom Pagey subdomain at creation. Use the Pagey dashboard for password protection, secure share links, file browsing, the AI site builder, and the form builder.",
    },
    {
      question: "What are the AI builder and form allowances?",
      answer:
        "Registered accounts include 5 AI Builder sessions per month and 5 prompts per session, plus 25 active forms and 5,000 form submissions per calendar month across the account. Forms support up to 25 fields and 50 options per choice field. Up to 1,000 submissions can be stored per standalone form or linked site. Pagey's public documentation lists the current allowances.",
    },
    {
      question: "What data leaves the computer that runs OpenBot?",
      answer:
        "An upload preview reads files locally. Publishing sends the selected build files to Pagey, along with the title, subdomain, or expiry you set. The adapter sends your API token in an Authorization header and keeps it out of tool output. Other site operations also send requests to Pagey. The plugin rejects links and common secret files, but you must still review the build output before publishing. Disconnecting the app does not delete hosted sites.",
    },
  ],
  sources: [
    { label: "Pagey Site: features and published usage figures", url: "https://pagey.site/" },
    { label: "Pagey Site: free access and usage allowances", url: "https://pagey.site/llms.txt" },
    { label: "Pagey Site: REST API", url: "https://pagey.site/api-docs" },
    { label: "Pagey Site: privacy policy", url: "https://pagey.site/privacy" },
  ],
  checkedAt: "2026-10-28",
};
