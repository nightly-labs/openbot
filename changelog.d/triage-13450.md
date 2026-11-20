### Fixed

- A Gemini chat failed each message with "proto: field google.protobuf.Value.string_value contains invalid UTF-8", often on Windows, when Gemini could not encode a text in the chat, such as the output of a command. OpenBot now starts a new Gemini session with the chat history at the first such error and sends the message again, so the answer comes without a new chat. On a joined server, the server must also be on the new version.
