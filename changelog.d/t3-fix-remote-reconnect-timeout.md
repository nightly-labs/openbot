### Added

- Restart a server that you host yourself from the app: as an owner or admin, select Restart server in
  the server menu. Before, only an OpenBot-hosted server and a server on this computer had this item, and a
  server that stopped answering after an update needed `sudo openbot restart` in a terminal. It works on the
  desktop and in the web client. The server must also be on the new version. In Docker, the container needs a
  restart policy, such as `--restart unless-stopped`.
