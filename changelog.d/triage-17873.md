### Fixed

- A Gemini (Antigravity) agent no longer gets a new full copy of the OpenBot instructions each time its chat opens again after 5 idle minutes. Antigravity keeps the earlier copy in the session, so the extra copies only filled the context, made replies slower and made the chat compact sooner. Changed instructions, a compaction and a failed turn still send the instructions again. On a joined server, the server must also be on this version.
