### Fixed

- Vault: when the secret storage of the computer is not ready at startup, for example just after a
  Windows restart, the Vault now opens again when you open Server settings > Vault or when an agent
  uses it. Before, the Vault stayed closed until OpenBot restarted, and agents said only "No Vault is
  available on this computer" and found no saved API keys. Agents now tell you to open Server
  settings > Vault.
