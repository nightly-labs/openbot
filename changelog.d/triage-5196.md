### Fixed

- The browser can now fill saved logins from Proton Pass. Before, `list_logins` always failed with
  "The shared password vault could not be read", because OpenBot listed the logins without naming
  a vault. OpenBot now lists the logins of each vault that the access key can read.
