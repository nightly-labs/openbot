### Changed

- Agent faces move at 60 frames per second or more, not 30, so their motion is smoother.
- Scrolling lists check their top and bottom edges at most once per frame. With many working agents,
  this uses less CPU in the window.
