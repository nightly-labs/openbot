### Fixed

- A Gemini chat no longer stops working after Google refuses an item in its history, such as an image that the agent opened. Before, each new message in that chat failed with the same 400 error ("Request contains an invalid argument" or "Unable to process input image") until you started a new chat. OpenBot now starts a new Gemini session with the chat history. When the refusal comes before the agent does work, OpenBot also sends your message again.
