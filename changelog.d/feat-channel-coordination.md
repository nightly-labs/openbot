### Added

- Use `@all` or `@everyone` at the start of a channel message to request a response or action from every member. Track and stop each task separately.
- Ask the channel lead for status or follow-up instructions while work runs. Supported providers can run two tool-free member responses and one coordinator session, subject to host capacity. Tool work keeps its resource locks.

### Fixed

- Keep ordinary channel work when Send continues a coordinator task. Tasks for removed members stay paused until reassigned.
- Stop all includes work assigned by the lead while Stop waits and leaves later requests running.
