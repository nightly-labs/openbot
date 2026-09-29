### Fixed

- A Grok agent answers again after you sign in to Grok with a different account or change the xAI
  API key. Before, each message in an earlier chat failed with "reasoning `encrypted_content` was
  not issued to this caller". Now OpenBot starts a new Grok session that keeps the chat history, and
  sends your message again.
