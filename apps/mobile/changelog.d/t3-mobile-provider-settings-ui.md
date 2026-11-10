### Added

- **API key for ChatGPT and Claude** in Server settings > Providers. When the server can read the
  key, the provider page has an API key row, as on the desktop. The key goes to the server only.
- **Default for new agents** on each provider page. Turn it on to make new agents of the server
  start with this provider. The page also shows how many agents use the provider.
- **Sign in in the browser** on a provider page when the server signs the provider in with a code.
  Use it when the code sign-in does not work.

### Changed

- The provider page has a new layout: a header with the provider logo, its status and its agents,
  then the Sign-in, Use, API key and Runtime sections. Each action, such as Reconnect, Update and
  Disconnect, has an icon, as in Settings. The API key opens on its own page.
- The sign-in page and the custom provider, custom agent and MCP server pages also have an icon
  on each action, such as Open sign-in page, Cancel, Add and Remove.
- The Models page of a provider shows the selected models in their own section, above the other
  models. Select all, Deselect all and Reset to default are in the menu at the top right.
- The provider page shows if the server runs the CLI that you installed or the one that OpenBot
  downloaded. The Disconnect question names the agents that stop until you sign in again.
