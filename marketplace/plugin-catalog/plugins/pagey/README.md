# Pagey Site for OpenBot

**Build in OpenBot. Publish for free. Keep the same link when you update.**

Turn an HTML file, ZIP archive, or static build folder into a live website from your
OpenBot conversation. Pagey provides free static hosting with **no cap on total sites**.
No subscription or credit card is required. Registered accounts can publish **25 new
sites per UTC day**; updates to existing sites do not use that allowance.

Pagey reports **10,000+ sites published and 4,000+ users**, including anonymous creators,
as of October 28, 2026. See [Pagey Site](https://pagey.site/) and its
[current features and allowances](https://pagey.site/llms.txt).

> Publish this static build folder to Pagey Site and give me the link.

Use it for portfolios, project demos, landing pages, client previews, event pages,
and small sites that need a public address without a separate deployment workflow.

## Connect once, then publish from chat

1. [Create a free Pagey account](https://pagey.site/signup), or sign in.
2. Open [API tokens](https://pagey.site/dashboard/api-tokens) and create a token.
3. In the updated OpenBot app, open **Marketplace > Apps > Pagey Site**.
4. Connect, paste the token in the API key field, and ask the agent to publish your build.

The agent checks the files before upload, then returns the site ID and HTTPS URL.
For an update, ask it to use the existing site ID. Replacing content removes the old
files; the agent must get your approval first. The public address stays the same.

Use `dist`, `out`, or another static build folder with `index.html` at its root. A single
HTML file can have any name. ZIP archives must have `index.html` at their root. Pagey
hosts static output; application server code and build commands do not run there.

## A free hosting toolkit

All these Pagey features are free for registered accounts. The plugin handles publishing,
updates, titles, expiry, maintenance, custom subdomains at creation, and analytics from chat.
The Pagey dashboard provides the rest of the toolkit.

| Feature | What you get |
| --- | --- |
| Automatic HTTPS | Every hosted Pagey address has HTTPS. Pagey handles the certificates; you do not need to provision one. |
| Custom subdomains | Choose an address such as `your-project.pagey.site` when you publish. |
| Password-protected sites | Add a password in Pagey before you share a private draft. |
| Secure sharing | Create expiring access links for client or team previews. |
| Full site analytics | Read page views, visitors, referrers, countries, devices, browsers, and UTM data, with 90-day retention. |
| Site management and file browser | Browse, upload, move, and manage site files in the Pagey dashboard. |
| AI site builder | Describe a site, refine the result, and publish it from Pagey. |
| Custom form builder and built-in backend | Build contact, waitlist, and feedback forms. Embed them in your site; Pagey collects responses and supports CSV export. |

Free access includes usage allowances: 5 AI Builder sessions per month with 5 prompts
per session, 25 active forms, and 5,000 form submissions per calendar month across the
account. Upload and request-rate limits also apply. See the
[full allowances](https://pagey.site/llms.txt) and [API reference](https://pagey.site/api-docs).
These allowances do not put a cap on the total number of sites you can keep.

## Tools

| Tool | Action |
| --- | --- |
| `preview_upload` | Read files, check them, and return names, sizes, and a digest. No upload. |
| `publish_site` | Publish the files that match the preview digest. Optional title, subdomain, and expiry. |
| `list_sites` | List or search sites, with pages and status filters. |
| `get_site` | Read one site's metadata and public URL. |
| `update_site_content` | Replace all content at an existing address, with a preview digest and explicit replacement flag. |
| `update_site` | Change or clear the title or expiry. |
| `set_maintenance` | Enable maintenance mode or resume public access. |
| `get_analytics` | Read visitor analytics for a date range. |

The account token grants access to the account's API. This adapter exposes only the tools
above. It does not expose site deletion, token management, passwords, or visitor sessions.
Disconnect the app to remove its tools and saved key from OpenBot. Connect again to use a
new token. To revoke the token itself, use the Pagey API tokens page. Existing sites stay
on Pagey after you disconnect.

## Upload checks

Uploads have a local limit of 1000 files and 50 MiB of uncompressed content. Pagey can apply
lower account or server limits. The adapter rejects links, hidden paths, dependency folders,
databases, source maps, private-key files, common credential patterns, and files that contain
the current Pagey token. These checks cannot find every secret. Review the file list and use
only public build output. The adapter never uploads a parent folder or follows a file link.
It checks and repacks ZIP files before upload. Password-protected ZIPs are not supported.

A preview digest binds the upload to those file contents. If files change, run the preview
again. Uploads have a 60-second network deadline and no automatic retry. If a request times
out, check the site list or content revision before you try again: Pagey may have completed it.

## Distribution

`server.mjs` is the complete standalone adapter. The catalog builder copies its source into
`bun --eval` arguments. The generated listing pins the source with the plugin version. No
script is fetched from a remote address. OpenBot's existing managed Bun runtime can run it.
The catalog builder limits the script size to leave space in Windows command lines.
Biome reports `noTemplateCurlyInString` in the three generated TypeScript copies because
the embedded JavaScript has template strings. These are intentional source-code strings;
keep the warning and do not change them into TypeScript template strings.

The adapter is a separate runtime tool. Its MCP callbacks use native runtime APIs and do not
add a desktop domain service or import application modules. It sends the token only in an
Authorization header to `https://pagey.site/api`, refuses redirects, and removes the token
from tool output. API error bodies are discarded. Site responses use an allowlist of fields.

For a local service test, `PAGEY_API_URL` can name `http://127.0.0.1:<port>/api`. No other
API address is accepted. The Marketplace does not set this override.

## Checks

```sh
bun scripts/pagey-plugin-e2e.ts
bun run marketplace:build:plugins
bun run marketplace:build:plugins -- --check
```

The E2E script starts the generated MCP command as a child process and sends real multipart
requests to a loopback HTTP service. It checks archive contents, validation, redaction, and
maintenance in both directions. CI runs it with no account or external token. Its report is
`.openbot-build/pagey-plugin/report.json`.

To test the live service, set `PAGEY_API_TOKEN` in the shell and run:

```sh
bun scripts/pagey-plugin-e2e.ts --live
```

This creates one site with a 24-hour expiry, updates it, changes its title, reads analytics,
enables and disables maintenance, and checks the public HTML and nested CSS file. It does
not delete the site. The report is `.openbot-build/pagey-plugin/live-report.json`. Neither
report contains the API token. The scripts retain their test files under `.openbot-build/`.
