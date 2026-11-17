### Fixed

- The recovery window that shows after OpenBot stops several times in a row before it opens offers
  the previous version only when that version can open your data. Before, it could offer a version
  that stopped on your data and then installed the version that did not open, again and again. When
  no earlier version can open the data, the window offers the latest version.
- When an older OpenBot finds data that a newer one saved, it no longer installs the latest version
  again if that version stopped several times in a row before it opened. It says that the latest
  OpenBot did not open, and it shows the releases page and the guide. Your data is not changed.
