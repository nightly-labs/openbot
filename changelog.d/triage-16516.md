### Fixed

- Browser: a saved login now signs in on pages that hide the real password field behind a masked
  text field, such as the eproc court portals. Before, the page emptied the password, and the site
  said that the password was wrong. When a page still does not keep the saved password, the agent
  stops before it sends the form, so that you can take over and sign in.
