### Fixed

- An Antigravity (Gemini) or Kiro agent can now make a long video or image with OpenBot credits in its own chat and in its task chats. Before, Antigravity stopped the tool call after 3 minutes, so an 8-second MAGI-2 clip failed with "timed out after 3m0s", although the video still came later and used credits. Now the agent says that the video is on the way. The video shows in the chat when it is ready, and a note tells the agent that it is ready and where its file is. In a channel or a routine chat, the agent still waits for the result in the same tool call, as before.
