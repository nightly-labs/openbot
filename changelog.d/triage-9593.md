### Fixed

- A Gemini chat no longer stops working after Google refuses an image in it with "Unable to process input image". Before, each new message in that chat failed with the same 400 error until you started a new chat. OpenBot now starts a new Gemini session with the chat history and sends your message again.
