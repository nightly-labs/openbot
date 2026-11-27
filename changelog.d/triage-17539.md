### Fixed

- A Claude agent that calls an OpenBot tool with the tool name in a wrong field now gets an error that tells it to use only name and arguments. Before, the wrong field was removed silently, the agent was told that the call had no name, and it often sent the same failed call many times.
