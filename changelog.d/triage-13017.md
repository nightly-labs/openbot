### Fixed

- An old Codex chat no longer shows the error "invalid paginated history lineage … missing source rollout" when OpenBot starts. Codex shows this error when its own list of chats points to a file that is not there, for example after the server or its home folder moves. The chat now shows the messages that OpenBot saved. If Codex cannot continue its old session, your next message starts a new Codex session in the same chat. A joined server must also be on the new version to get this fix.
