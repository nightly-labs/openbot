### Fixed

- A Marketplace app that starts a local server with `npx` (Obsidian, Airtable, Apple apps, Brave Search, Firecrawl, Resend) now starts with
  the runtime that OpenBot downloads, not with the Node.js of the computer. Before, Obsidian showed "The server stopped before it answered"
  on a computer with Node.js older than 24, and the agents could not use it. The first connection can wait for the download of the runtime.
  A server that you added yourself starts as before. For an app on a joined server, the server must also be on the new version.
