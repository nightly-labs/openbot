### Fixed

- An OpenCode agent with a custom provider key, or a key for another provider that has no image or video models, no longer tries to make images or videos with OpenCode's own tools, which always failed with "Invalid credential". OpenCode offered only its own paid image model, and the key did not pay for it. Now OpenBot keeps these OpenCode tools only when OpenCode has a key that can pay for its image or video models. The agent then makes the picture or video with OpenBot credits, or tells you at once that it cannot. On a joined server, the server must also be on this version.
