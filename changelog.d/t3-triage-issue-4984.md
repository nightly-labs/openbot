### Changed

- You can now attach a file of any type to a chat, for example a VPN profile (`.ovpn`), a
  certificate (`.pem`) or a Terraform file (`.tf`). Before, OpenBot refused a file whose extension
  was not in its list. The agent gets the file's path and reads it with its own tools. Open shows the
  file in the file manager. A remote server must run this version of OpenBot to take these files.
