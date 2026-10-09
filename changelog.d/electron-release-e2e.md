### Added

- Add release checks for chat, routines, file previews, browser control, and agent delegation in local and remote-host modes.
- Cover interrupted delegation, provider switches and failures, conversation and host isolation, attachment use, host access removal, setup, and long chat history.
- Compare six fixed Storybook layouts against reviewed visual baselines before release.

### Fixed

- Make the chat recipient menu clickable when it overlaps another message.
- Keep browser form submissions successful when navigation replaces the page during the completion wait.
- Keep inherited process environment values out of release test artifacts by disabling Playwright traces.
- Use the existing macOS process cleanup handling for release test services.
- Update restored streaming messages when the host sends their completed content.
- Stop repeated agent settings requests while a host is offline, so reconnect can recover.
- Block release when required Linux UI cases are missing or skipped.
