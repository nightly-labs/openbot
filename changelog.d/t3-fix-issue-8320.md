### Fixed

- An agent can fill a saved authenticator code from the Vault on more two-step sign-in pages, such as
  Okta ("Enter code"), Squarespace ("Authentication code") and Zerodha Kite ("External TOTP").
  OpenBot now also reads the field's label and placeholder, and it accepts a field labelled only "code"
  when its form names an authenticator app. Before, these fields were refused with "the field targets
  are not code fields", and the user had to type the code.
