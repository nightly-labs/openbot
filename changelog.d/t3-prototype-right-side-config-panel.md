### Added

- In a workflow, the selected image or video step opens a composer under its card, with the
  description, the pictures, the model, the settings and Run in one place.
- The settings of a Higgsfield model also show its other settings, such as a switch for sound and
  the bitrate, which starts on High, and the aspect ratios 21:9 and 3:4 when the model has them.
  The price follows these settings. On a joined server, the server must also be on the new version.
- A Higgsfield video step, such as Seedance 2.0, takes reference videos and audio from a connected
  step on its file port. A Mode tile in its settings sets the mode of the model, and the input ports
  of the card follow the mode. On a joined server, the server must also be on the new version.
- The other settings of a Higgsfield model show clear names, such as "Standard" and "Fast". A
  setting that has no default starts on "Auto", and the model then chooses. A setting that needs
  more input than the canvas gives, such as a custom light or the file format, is not shown. On a
  joined server, the server must also be on the new version.

### Changed

- The settings of an image or video step are tiles: a length bar with a mark for each length that
  the model makes and that is full at the longest length, and a tile with a list for the aspect ratio, the resolution and each other
  choice. A custom size is one tile with the width and the height, next to the aspect ratio. The
  resolutions are in the order of their size. A tile alone on the last row fills the row. The settings open under their button, and above it
  when there is no space under it. On a joined server, the server must also be on the new version.
- On a workflow card, a connected port stays visible and has a soft tint of the color of what it carries: teal for
  text, pink for a picture and orange for a file. A port gets the tint only when its line shows: an
  asset with no file has no line, so the port that it connects to stays grey.

### Fixed

- The glass summary on an image or video card is blurred while it fades in. Before, the blur came on
  only at the end of the fade.
- On a zoomed-in workflow, the ports and the summary of a card stay visible while the pointer goes
  from the card to a port. Before, they faded out and in again in the gap between them.
- A video step connected to the file input of another step can run. Before, the run refused the
  connection.
