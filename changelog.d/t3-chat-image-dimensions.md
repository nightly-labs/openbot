### Fixed

- On a joined server and in the web client, a picture in a chat now has its correct size before it
  loads. Before, the picture frame was square first and then changed its height after the picture
  loaded, and the chat moved. The server now sends the width and height of each picture with the
  message. The server must also be on the new version.
