### Fixed

- A Workspace only agent can now write in the Shared folder and in its own folders with shell commands when the path of the folder goes through a symbolic link, for example on a Linux computer where `/home` is a link to `/var/home`. Before, a Claude agent got "Read-only file system" for the full Shared folder, but its file edit tool could write there. On a joined server, the server must also be on this version.

### Security

- A Workspace only Claude agent no longer writes through a symbolic link that an agent can change. When a folder that you gave to the agent becomes a link inside a folder where agents can write, the file edit tool now asks for your approval, and shell commands cannot write there. Before, the file edit tool wrote to the target of the link without a question.
