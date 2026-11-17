### Fixed

- A Gemini chat failed each message with "context summarization: … all steps in trajectory are cleared" when Gemini could not read the saved history of the chat. OpenBot now starts a new Gemini session with the chat history at the first such error and sends the message again, so the answer comes without a new chat.
