### Fixed

- A Gemini chat with many images no longer stops working when it becomes too large for Google. Before, each new message in that chat failed with "The message size exceeds 30.000MB limit", and `/compact` failed too, until you started a new chat. OpenBot now starts a new Gemini session with the chat history and tells you that the chat became too large. When this occurs before the agent does work, OpenBot also sends your message again.
