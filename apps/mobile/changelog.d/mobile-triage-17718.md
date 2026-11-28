### Fixed

- When you open the app again, a long approval request now waits until the server is connected before it loads the full request, and it loads again by itself after a lost connection. Before, the card often said "Could not load the full request. You can deny it here." and showed "Try again" even when the connection was fine a few seconds later.
- When you tap "Try again" on an approval request that is closed, the app now tells you "Request closed". Before, the card went away with no message.
