### Fixed

- On Linux with a Wayland desktop, an agent can check an HTML page before it shows the page in the
  chat again. Before, each check stopped after 20 seconds with "The page did not finish drawing",
  also for a page with only text. Charts and other canvas drawings show in the check.
