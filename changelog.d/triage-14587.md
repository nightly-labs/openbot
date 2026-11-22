### Fixed

- A ChatGPT (Codex) agent set to **Ask first** now asks you before it runs a command or changes a file. Before, it ran commands outside its workspace, `sudo` included, without an approval card. This also applies to its routines and channel work: they wait for your approval. When you change the setting while the agent works, the change starts with its next message. Select **Always allow** on a card to give the agent Full access. On a joined server, the server must also be on the new version.
