### Fixed

- Mistral agents: a chat opens again when GitHub is connected. Before, Mistral Vibe 3.1.5 stopped each
  chat with the error "('github', 'ui_get')". OpenBot now goes back to the Mistral Vibe version that
  comes with OpenBot, and it does not give agents the GitHub tools that only app screens use.
