### Fixed

- An unanswered question no longer stops the routines and queued messages of all ChatGPT agents for
  hours while a ChatGPT update or restart waits. Before, the update waited for the question to be
  answered, and every new task of every agent on that provider waited too. Now the question stays
  open in the chat, the agent ends its turn, and the update and the queued work continue. When you
  answer later, the agent gets your answer as a new message. This applies to every provider that
  waits for its running tasks before an update or a restart.
