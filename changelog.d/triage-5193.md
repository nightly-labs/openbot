### Fixed

- On Windows and Linux, OpenBot now refuses Workspace only for a provider that it can only confine on macOS, such as a custom ACP agent, with the message to choose Full access. It also refuses a move of a Workspace only agent to such a provider. Before, the change was saved, and then each message to the agent failed until the user changed the access back.
