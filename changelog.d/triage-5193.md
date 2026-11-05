### Fixed

- On Windows and Linux, OpenBot now refuses Workspace only for a provider that it can only confine on macOS, such as a custom ACP agent, with the message to choose Full access. Before, the setting was saved, and then each message to the agent failed until the user changed it back.
