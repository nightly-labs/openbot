### Added

- An agent that takes audio and video, such as Gemini CLI, now gets attached MP3, MP4 and MOV files themselves, so the model can listen to or watch them. Before, the agent got only the path of the file. Agents that do not take audio, such as Codex, Claude, Cursor and OpenCode, still get the path. The media in one message can be up to 10 MB in total; a larger file goes as its path.
