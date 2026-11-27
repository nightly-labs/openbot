### Fixed

- Bitwarden and Vaultwarden now connect on a server that had a Bitwarden CLI that cannot run there, for example a copy made for a different processor. Before, OpenBot used that copy again on each connect, and the connect always failed with a message that told you to check your server address, API key and master password. Now OpenBot installs the correct CLI again. If the new CLI also cannot start, the message says so. On a joined server, the server must also be on this version.
