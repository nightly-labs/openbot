### Changed

- On a Mac, one press of ⌘Q no longer quits OpenBot. Hold ⌘Q or press it twice to quit, and a hint
  in the window tells how. Before, one press stopped OpenBot with its agents and routines, and it was
  easy to press by mistake. Quit in the OpenBot menu, the Dock and an update still quit at once.
- When a process stops OpenBot with a signal, such as `kill`, OpenBot now stops its agents and
  saves its state before it quits. Before, the desktop app stopped at once.
- The main log now says how OpenBot quit: from the menu, with ⌘Q, from the tray, for an update or by
  a signal.
