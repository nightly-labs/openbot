### Fixed

- A Gemini conversation that failed or stopped responding at each message stayed stuck, while a new topic of the same agent worked. After two failed messages in a row, OpenBot now starts a new Gemini session for the conversation, and gives it the conversation so far. Send the message again to continue.
