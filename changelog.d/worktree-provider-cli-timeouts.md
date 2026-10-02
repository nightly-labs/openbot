### Fixed

- On a busy computer, a provider CLI that answers slowly no longer shows as broken. OpenBot now waits 10 seconds for its version, says that it did not answer in time, keeps the last known version, and tries again by itself. ([#1258](https://github.com/nightly-labs/openbot/issues/1258))
- A provider refresh no longer marks a connected provider as failed while its models stay in the model list. ([#1258](https://github.com/nightly-labs/openbot/issues/1258))
