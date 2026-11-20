### Fixed

- A model step in a workflow now sees the pictures that come in through a picture connection, from
  an asset or from an image step. Before, the model got only the text and could not see the picture.
  When the model of the step cannot read pictures, the step stops and tells you to choose a different
  model, or to remove the picture connection. A model step reads PNG, JPEG, GIF and WebP pictures. On
  a joined server, the server must also be on this version.
