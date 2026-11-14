### Fixed

- With an OpenRouter key, models with very long answers, such as Gemini 4 Carbon and Muse Wonder,
  now work with a balance of a few dollars. Before, OpenBot asked OpenRouter for up to about 944,000
  answer tokens, OpenRouter refused the request, and the chat said that the account had no balance.
  A reply can now have up to 128,000 tokens. When the account still does not have enough credit for a
  reply, the message says so and tells you to add credit or select a different model. On a joined
  server, the server must also be on the new version.
