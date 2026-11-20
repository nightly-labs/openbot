### Fixed

- When a teammate sent the same result again after the agent already gave it to you, a ChatGPT agent
  ended the turn with no answer, ran it again, and then showed "ChatGPT ended the turn with no
  answer". Now the agent ends that turn quietly, and the teammate's second message stays in the chat.
