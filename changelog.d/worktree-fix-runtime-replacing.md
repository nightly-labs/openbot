### Fixed

- A provider CLI download no longer fails with "another instance is replacing it" when no other OpenBot runs. When another program holds the new files open, OpenBot now waits for a moment, and then tells you to close that program. ([#1264](https://github.com/nightly-labs/openbot/issues/1264))
- A failed update notification now closes when the CLI is updated later. Retry on a provider row now removes the old error text, and the custom provider row no longer shows a second Retry next to Add. ([#1264](https://github.com/nightly-labs/openbot/issues/1264))
