### Fixed

- Stop filling the Grok session history with empty sessions. Before, each time OpenBot checked the
  Grok models (about every 5 minutes while Grok was on), it left one empty session in the Grok
  session list of the folder that OpenBot started in.
