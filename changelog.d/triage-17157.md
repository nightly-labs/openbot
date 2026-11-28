### Fixed

- When Gemini sent nothing for a message, even after OpenBot sent it again, OpenBot kept the same Gemini session, so the next message failed in the same way. Now the next message opens a new Gemini session with the conversation so far, and it gets again the pictures of the message that failed.
