### Added

- Add a webhook trigger to teammate and group routines. The host makes the webhook URL and the signing secret. You see the secret one time when you create the webhook, and you can make a new one.
- Add notifications to a routine: OpenBot sends a webhook when a run starts, succeeds, fails or needs attention. Each routine shows the webhook requests that it ignored and the failed notifications, and you can send a failed notification again. Tap **Filter events** to limit a webhook routine to one event type and to data filters.

### Fixed

- Signing secrets and secret header values are now hidden while you type them on iPhone. Before, they showed as plain text.
