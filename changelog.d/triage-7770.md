### Fixed

- An agent can read and use a web page that hides its main part from screen readers, or that makes it
  transparent while it loads, but still shows it. Before, the agent got an empty page with no text and
  no controls, for example on a site that left its page marked as hidden after a dialog closed.
- When an agent reads a web page that has no text and no controls, it now also gets a picture of the
  page. Before, it got only the empty page.
