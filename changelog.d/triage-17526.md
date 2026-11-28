### Fixed

- An agent can now run an OpenBot tool that needs no input, such as reading its own profile, without an empty input. Before, some custom agents and OpenCode refused the call before it got to OpenBot, and the agent sent the same call again many times.
