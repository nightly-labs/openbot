### Fixed

- Show what went wrong when a Gemini agent (Antigravity) stops with "Agent execution terminated due to error." OpenBot now finds the cause in the Gemini CLI's own log. A refused API key, a rate limit or a model that is not available now gives its own message and the next step. Another error says in plain words that Gemini stopped, and that you can send the message again or choose another model or provider. Before, the chat showed only the CLI's text, and reinstalling Gemini did not help.
