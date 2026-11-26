### Fixed

- A workflow step or a routine run with a ChatGPT (Codex) agent can now use an app that needs some time to start, such as Composio. Before, the step did not get the app's tools when the app took more than 10 seconds to start, and the agent answered that the tools were not available. The run now waits for each app to start, for up to 30 seconds. A chat does not wait longer than before. On a joined server, the server must also be on this version.
