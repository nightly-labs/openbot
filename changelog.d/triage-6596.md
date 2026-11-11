### Fixed

- Keep a Claude chat or channel working when its conversation gets too long for Claude. OpenBot now
  compacts the conversation and sends the message again. Before, each later message failed with
  "Prompt is too long", also after a restart. When the conversation is still too long, the error
  now tells you to start a new chat, or a new conversation in the channel settings. On a joined
  server, the server must also be on this version.
