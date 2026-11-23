### Fixed

- A Gemini chat no longer stops working when Google refuses an image in its history with "the file or media data is empty, corrupted, or malformed". Before, each new message in that chat, also a text-only message from a teammate, failed with the same 400 error. OpenBot now starts a new session with the chat history and sends the message again, as it does for "Unable to process input image".
