### Fixed

- A password that you type on the password card now signs you in and goes to the Vault on sign-in
  pages that change their address while the card is open, as many mail sign-in pages do. Before,
  the secure fill failed on these pages, you had to finish the sign-in in the tab, and "Save to
  Vault" did nothing. When you select "Save to Vault" and the secure fill fails for another reason,
  the agent now tells you that the password was not saved. On a joined server, the server must also
  be on this version.
