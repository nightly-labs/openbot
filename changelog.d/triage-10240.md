### Fixed

- On Windows, scripts and routines that read an API key for one agent at its old path,
  `agent-api-keys/<agent>/<NAME>`, work again. Before, when Windows did not allow links (Developer Mode
  off), OpenBot deleted the file after it moved the key into the Vault, and the path did not come
  back. Now a copy of the key stays at that path, and it changes when you change or delete the key in
  the Vault. The next start brings back the files that 0.70.0 and 0.71.0 deleted. A server must also
  be on the new version.
