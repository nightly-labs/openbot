### Fixed

- In the web app, you can now dictate a message with the microphone button in the message box, as in the desktop app. Your server writes the text with its own speech recognition model. The default model finds the language that you speak, Russian included. Before, the only voice input in the web app was GPT live voice, which sometimes wrote your speech in English. The server must be on version 0.78.0 or later. If speech recognition is not set up on the server, the message tells you where its owner or an admin can choose a model.
