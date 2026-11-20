### Fixed

- When a teammate sent the same result again, with the same text, after a ChatGPT agent already took
  it, the agent ended the turn with no answer, ran it again, and then showed "ChatGPT ended the turn
  with no answer". Now the agent ends that turn quietly, and the teammate's second message stays in
  the chat.
