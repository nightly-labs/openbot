### Fixed

- When an agent finds no saved login for a sign-in page, it can now tell you why and what to do.
  A saved login fits only the site of its website, and some services sign you in on a different
  site, for example Walmart Seller Center on `wal-mart.com`. For a password manager, the agent asks
  you to add the address of the sign-in page to the login, and to keep the login where you share
  logins with OpenBot. For the OpenBot Vault, it asks you to save a login for the sign-in address
  and to let the agent use it. Before, the agent only said that no login was saved. For an agent
  on a joined server, the server must also be on the new version.
