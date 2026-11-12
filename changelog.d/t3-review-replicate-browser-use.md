### Changed

- OpenBot uses Electron 45.3.0 with Chromium 156. Some sites refused the older browser version.

### Fixed

- More sites with a bot check now load in the agent browser. The browser sent a version text and a
  language header that no Chrome sends, and some sites refused it.
- The agent browser now waits for a Cloudflare check on a page that also shows a cookie banner.
  Before, it told the agent that the check had passed while the check still ran.
- The agent browser now gives a site the browser details that the site asks for, as Chrome does.
- The agent now gets the page from its first read when a site redirects immediately. Before, it had to
  read the page a second time.
