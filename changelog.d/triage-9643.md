### Fixed

- When an agent filled a password in a page that keeps a copy of it, such as a security check in a
  dialog, OpenBot loaded the page again. This closed the dialog, and the other values in it were
  lost. Now the page stays open, and the agent can finish the form. Until the page goes to a new
  address, the agent does not see the password and takes no images of the tab. On a joined server,
  the server must also be on this version.
