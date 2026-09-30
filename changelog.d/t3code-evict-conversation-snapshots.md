### Fixed

- OpenBot uses less memory when it runs for a long time with many agents. When an agent chat is not used for 10 minutes, OpenBot removes its copy from memory and reads it again from the database when you or the agent use the chat. The chat does not change.
