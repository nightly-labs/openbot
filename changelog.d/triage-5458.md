### Fixed

- On Windows, a message with an attachment, such as a pasted image, no longer fails with "OpenBot does
  not have permission to complete this action" when antivirus or the search indexer opens the new file
  for a moment. OpenBot now tries again for about 3 seconds before it shows the error.
