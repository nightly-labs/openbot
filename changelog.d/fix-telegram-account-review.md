### Fixed

- Read all matching Telegram account messages when paging forward with a date filter.
- Check the sending switch after chat lookup, before sending a message or file or marking a chat
  as read.
- Keep downloaded Telegram file names within the file-system byte limit, including Unicode names,
  and preserve short file extensions.
