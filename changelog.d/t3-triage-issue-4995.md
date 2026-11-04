### Fixed

- A hosted server downloads its own Claude or ChatGPT CLI when the CLI of the server image is too old. Before, the provider showed as too old, and it looked uninstalled.
- ChatGPT no longer fails for 15 minutes after a slow first start. OpenBot gives the first start more time, and an update no longer reports "could not update the ChatGPT CLI" when ChatGPT only prepares its local history.
