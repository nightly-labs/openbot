### Fixed

- In a channel, a task now completes when its member posted the result and the model reply then
  failed, for example with "The model's reply was cut off or was not valid." Before, the result was
  in the chat, but the task showed as failed, and the agent that gave the task waited for it until
  you sent a new message. On a joined server, the server must also be on the new version.
