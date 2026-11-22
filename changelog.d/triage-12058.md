### Fixed

- An OpenCode agent on a model of a custom OpenAI-compatible endpoint, such as Qwen on llama.cpp, now
  gets OpenBot's tools as direct tools. Question cards and file attachments work, and the chat no
  longer shows raw `<tool_call>` text. Each request on such a model is larger: it carries the full tool
  schemas, also those of your own MCP servers, and the first message of a new chat can start up to half
  a second later, until OpenCode has loaded the tools. OpenCode's built-in models and endpoints on Anthropic's,
  OpenAI's or Azure's own API do not change. On a joined server, the server must also be on this version.
