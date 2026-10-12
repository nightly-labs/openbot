### Added

- Require every tested real provider to discover and call custom HTTP and STDIO MCP tools, with server receipts and chat results.
- Check custom HTTP and STDIO MCP connections, failed connection recovery, tool use, disable/re-enable, and removal in local and host modes.

- Require Grok and Gemini agent creation, delegation, browser, file preview, and interactive HTML checks in local and host modes.

- Add release checks for chat, routines, file previews, browser control, and agent delegation in local and remote-host modes.
- Cover interrupted delegation, provider switches and failures, conversation and host isolation, attachment use, host access removal, setup, and long chat history.
- Compare six fixed Storybook layouts against reviewed visual baselines before release.
- Check on the host that a removed member has no session and that the host stays online for other members.
- Run the live group and provider-switch cases with a comma-separated `OPENBOT_E2E_PROVIDER` list.
- Check missed routine schedules (run once and skip), MCP edits, and that the Codex user file holds no MCP secrets.

### Fixed

- Make the chat recipient menu clickable when it overlaps another message.
- Keep browser form submissions successful when navigation replaces the page during the completion wait.
- Keep inherited process environment values out of release test artifacts by disabling Playwright traces.
- Use the existing macOS process cleanup handling for release test services.
- Update restored streaming messages when the host sends their completed content.
- Stop repeated agent settings requests while a host is offline, so reconnect can recover.
- Block release when required Linux UI cases are missing or skipped.
- Build the current app and include visual comparisons in the single release test command, with a final result and failure status.
- Require all six visual cases to pass; missing or skipped cases block the release command.
- Make scripted release cases call hidden tools through the tool bridge and use the Codex user config layer, as real Codex does.
- Remove release checks that could not fail, and run reconnect cases only in host mode.
- Reconnect a host to Signal at once after a member is removed; only a Signal rate limit delays the reconnect.
