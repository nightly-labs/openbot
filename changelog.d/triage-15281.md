### Fixed

- An OpenCode agent with no OpenCode sign-in no longer tries to make images or videos that always fail with "Invalid credential" or "Missing API key". OpenCode offered its paid image and video models to the free models, and the OpenCode service refused each request. Now OpenBot turns off OpenCode's image and video tools until OpenCode has a key that can pay for them, so the agent tells you at once that it cannot make the image. The OpenCode Go key does not change this: OpenCode Go has no image or video models. On a joined server, the server must also be on this version.
