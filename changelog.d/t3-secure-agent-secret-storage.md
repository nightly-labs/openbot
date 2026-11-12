### Added

- In Settings > Vault, you can choose which agents can use each login, card, contact and API key. A new
  item is for all agents. An agent sees, fills and reads only the items that it can use. On a joined
  server this works in the desktop app and the web client when the server is also on this version.

### Changed

- An API key that you save "Only for this agent" from the chat is now kept in the encrypted Vault,
  for that agent. The keys that earlier versions kept in plain files move into the Vault when OpenBot
  starts. Agents still run as the same user of the computer, so this is not a strong wall between
  agents.
- The key files that agents read have a new path. An agent gets the path each time it lists its keys,
  so a script that has the old path must use the new one.
