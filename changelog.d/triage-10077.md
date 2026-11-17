### Fixed

- Keep a key file that an agent puts by hand in OpenBot's API key folder, also when its name looks
  like an API key name, such as `GOOGLE_SA_JSON`. Before, each start of OpenBot and each Vault
  change deleted such a file when no Vault key had its name. OpenBot now removes only the key files
  that it wrote. A deleted Vault key still removes its file. For agents on a joined server, the
  server must also be on the new version.
