### Fixed

- The image viewer shows a small screenshot sharp when the display scale is above 100%, such as
  125% or 150% on Windows. Before, the viewer made the image larger than its pixels and the text
  was blurry. The zoom level now counts screen pixels, so 100% shows the image as an image app does.
