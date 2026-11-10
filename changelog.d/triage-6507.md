### Fixed

- On macOS, a sign-in in the built-in browser no longer stops when the site asks for a passkey. The
  built-in browser cannot show a passkey prompt, so the page waited, with nothing on screen, until
  the site's time limit. Now the site shows its other sign-in methods at once, for example the
  Microsoft Authenticator app or a password. When the site asks for a security key, or for a
  credential that a security key can hold, the request does not change.
