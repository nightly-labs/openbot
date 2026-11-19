### Fixed

- A chat whose saved provider history has an empty message works again. Before, the model refused
  each new message in that chat, and the chat showed a technical error. Now OpenBot starts a new
  session with the chat history and sends the message again.
