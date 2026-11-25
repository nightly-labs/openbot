### Changed

- A computer or server now tells the account service once a day which accounts used it: its owner
  when a turn starts, and each member who uses it. The account service counts each account once a
  day and sends only the total to analytics, with no account ID. It deletes the list when it sends
  the total.
