### Fixed

- When a provider such as Gemini did not start, and an agent then tries to change a model to one of its models, the agent now gets the real error and where to check it: Server settings > Providers. Before, it got "Gemini is not connected", which was not true. On a joined server, the server must also be on this version.
