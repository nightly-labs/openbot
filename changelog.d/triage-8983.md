### Fixed

- Scripts, MCP servers and provider settings that read a Vault API key from the shared key folder
  work again. Before, version 0.70.0 deleted the files in that folder when OpenBot started, and these
  tools stopped with no message. The folder again has each Vault key that is for all agents. A key
  that you give only to some agents is not in it.
