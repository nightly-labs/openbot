### Fixed

- When more than one provider updated at the same time, the update notifications jumped and
  overlapped, and OpenBot used much CPU. Each percent of each download measured the notification
  again. Now a notification measures its height only when its lines change.
