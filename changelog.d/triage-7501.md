### Fixed

- ChatGPT agents now work when Codex on your computer is set to use a different model provider,
  such as a local gateway. Before, OpenBot asked you to connect ChatGPT again and again, and the
  connection failed with "OpenBot could not verify the ChatGPT connection". When you connect ChatGPT
  or add an OpenAI API key in this setup, OpenBot now tells you that Codex uses the other provider.
