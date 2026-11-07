### Fixed

- Let an agent fill a saved Proton Pass login in the browser. Before, `submit_secret` refused the
  Proton Pass login id from `list_logins`, because the id was longer than 128 characters.
