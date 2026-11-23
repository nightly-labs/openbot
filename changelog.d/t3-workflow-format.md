### Changed

- Workflows now have a format version. An older OpenBot opens a workflow that uses newer steps or settings as read-only, and does not change it. A server refuses a new step setting that it does not know, with a message to update OpenBot. A setting that is already saved stays as it is, also after a server transfer.
