### Fixed

- On a busy computer, a provider CLI that answers slowly no longer shows as broken. OpenBot now waits 15 seconds for its version, says that it did not answer in time, keeps the last known version, and tries again by itself. ([#1258](https://github.com/nightly-labs/openbot/issues/1258))
- A provider in the error state no longer lists its models, and a provider refresh no longer marks a connected provider as failed. ([#1258](https://github.com/nightly-labs/openbot/issues/1258))
