### Fixed

- Gemini with a saved API key no longer stays on "Connecting" when Gemini does not answer its key sign-in. After the start time limit, the provider shows an error. Before, it waited with no end, and Cancel waited too.
- The provider settings and the model picker show "Finish the sign-in if a browser page opens" and Cancel only while a sign-in waits for you. Before, they also showed when OpenBot checked a provider again after a key change, a restart or an update, when no browser page opens.
