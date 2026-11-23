### Fixed

- When Google's servers answer a Gemini turn with "Requested entity was not found" after the agent already did work, the agent now continues the work on its backup model. Before, the turn stopped with this error and the work did not continue.
- When Google says that a Gemini quota or rate limit is reached and gives the reset time, OpenBot now waits for that time before it tries the model again. Before, OpenBot tried the model again after 10 minutes and could hit the same limit.
- When a Claude model in Gemini cannot read the thinking of an earlier turn, OpenBot now starts a new session with the chat history at the first failure. Before, the message failed and the same error came back on the next message.
- On a Linux computer whose kernel uses memory pages larger than 4 KiB, such as a Raspberry Pi 5 or Asahi Linux, or that has IPv6 turned off, a provider that cannot start now says why. Before, the provider showed only "Download failed" and each try downloaded it again.
- Gemini no longer leaves the files of its short helper sessions in `~/.gemini/antigravity-acp`. OpenBot opens these sessions to check sign-in, read the models and write profile text, and now deletes their files when it stops the provider. Before, each start added files that stayed on disk. Your chats keep their files, and files from earlier versions stay.
- The Gemini usage popover no longer shows a reset time for a quota that you did not use. Before, it showed a reset in 5 hours or 7 days that moved forward each time you looked.
