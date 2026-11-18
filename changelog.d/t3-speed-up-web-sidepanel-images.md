### Fixed

- In the web client, an image opens in the side panel and downloads at once when the chat already
  shows it, and it opens at once again after the first open. Before, each open and each download
  read the full file from the server again, which took a long time for a large image.
