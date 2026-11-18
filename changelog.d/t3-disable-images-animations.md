### Added
- Settings > Appearance has a new Motion section with two switches: Background blur and Moving
  agent faces. Turn them off to make OpenBot faster on a slow computer, or turn them on again on a
  computer with no GPU. The web app has the same switches in its settings. The choice stays on
  this device and browser.

### Fixed
- The web app is faster in a browser with no GPU, such as a remote desktop on a server.
  Like the desktop app, it now turns off blur, the moving agent faces and the falling crew
  of the loading screen there. In our test, the page was busy about 14% of the time when
  idle, and is now busy about 5%.
