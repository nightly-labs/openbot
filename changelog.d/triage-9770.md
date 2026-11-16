### Fixed

- When an agent uploads the same file again to a form in the OpenBot browser, the page now gets the
  file. Before, the agent got a success message but the form did not change, so a retry after a
  failed first upload did nothing. For a browser on a joined server, the server must also be on the
  new version.
