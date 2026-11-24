### Fixed

- A Gemini chat continues after Google refuses a tool result that contains a JSON schema. Before,
  each later message in that chat failed with the same HTTP 400 error. Now OpenBot starts a new
  Gemini session with the chat history. The server must also be on this version.
- A Gemini chat continues again after Gemini cannot encode the chat history. Version 0.77.0 showed
  "Gemini stopped because of an error" for each message in that chat.
