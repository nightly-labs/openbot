### Fixed

- A workflow GitHub trigger now says when events from a repository cannot reach OpenBot. OpenBot tries again by itself, and the message goes away when the events arrive. Before, the trigger showed only "None" and no run started. On a joined server, the server must also be on the new OpenBot version.
- When you install OpenBotGit on a repository after a GitHub trigger already watches it, OpenBot now gets its events after you open the workflow. Before, the events did not arrive until OpenBot restarted.
