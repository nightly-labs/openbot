### Fixed

- An OpenCode chat now recovers when a text-only model refuses an image from earlier in the chat with "multimodal processing is not enabled". Before, OpenBot showed the server's raw error, and each next message failed the same way. OpenBot now starts a new OpenCode session with the chat history and sends your message again. When the model refuses again, OpenBot tells you to send the message without the file or to choose a model that can read files.
