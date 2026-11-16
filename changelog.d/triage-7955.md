### Fixed

- Routines and chats with a custom (ACP) agent no longer fail when the agent calls a browser or OpenBot
  tool by the name that it sees, or with no arguments. Before, each try got "Invalid tool discovery
  arguments", and the run failed. When the agent uses a wrong name, it now gets the correct name.
