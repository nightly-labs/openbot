### Changed

- Agent faces move at 60 frames per second, not 30, so their motion is smoother.
- Scrolling lists check their top and bottom edges once per frame, after the frame is drawn. With
  many working agents, this uses less CPU in the window.
