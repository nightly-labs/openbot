### Fixed

- A Claude agent turn that stops in a tool no longer stays open for hours. When an OpenBot tool gets no answer, or a tool only sends "still running" signals, OpenBot ends the turn after 60 minutes and tells the user that Claude stopped responding. Later routine runs and incoming messages then start again. A turn that waits for the user, for example for an approval or an answer, stays open as before.
