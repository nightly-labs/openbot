### Fixed

- On Windows, agents can use the browser while the OpenBot window is minimized or closed to the tray.
  Before, each snapshot image or screenshot failed with "dynamic tool request failed" or timed out
  after 10 seconds, until the window opened again. When a page still gives an empty image, the agent
  now gets the reason and can ask you to open the OpenBot window.
