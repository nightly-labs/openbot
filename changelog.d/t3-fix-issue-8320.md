### Fixed

- An agent can fill a saved authenticator code from the Vault on more two-step sign-in pages, such as
  Okta ("Enter code"), Squarespace ("Authentication code") and Zerodha Kite ("External TOTP").
  OpenBot now also reads the field's label and placeholder. It accepts a field named only "code" or
  "passcode" when the form names an authenticator app and does not name email or SMS. Before, these
  fields were refused with "the field targets are not code fields", and the user had to type the code.
