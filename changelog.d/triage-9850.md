### Fixed

- When you attach an image to an agent whose custom Pi model gets only text, the composer now tells
  you that the model does not see the image. If the model can read images, click Turn on images.
  Before, the image did not go to the model, and only the agent's reply said that it saw no image.
  You can turn it off again in the model menu > Edit endpoints > Accepts.
