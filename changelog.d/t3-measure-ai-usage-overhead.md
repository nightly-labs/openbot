### Changed

- Reduce default AI context by loading most built-in tool schemas and detailed guidance only when needed. All existing tools remain available. Browser security, approvals, and conversation history keep their existing paths.
- Use smaller history handoffs when a provider session changes. Agents can retrieve older messages from the same conversation; context reset still excludes earlier messages.
- Keep Claude queries open for model and reasoning-effort changes. Keep native compaction and avoid unsupported compaction requests.
- Show local agent context use and compaction with the ring, popover, notice, and conversation marker from PR #1786. Unknown usage stays hidden. Native compaction stays automatic.
- Clear the old context indication when a provider changes. Label Claude context counts as estimates and omit compaction comparisons that mix full-context and message-only counts.
