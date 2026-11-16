### Fixed

- When a service does not accept OpenBot for its browser sign-in, the connect dialog now says that the
  service does not accept OpenBot yet and that your account is not the cause. Before, some services
  showed only their own English text, such as "No dynamic client registration template matched this
  request.". On a joined server, the server must also be on this version.
- Connect Tessie from the Apps marketplace with an access token from Tessie's Developer Settings. Before,
  the browser sign-in always failed, because Tessie does not accept OpenBot for it.
- Connect Omnisend from the Apps marketplace with an Omnisend API key. Before, the browser sign-in always
  failed, because Omnisend does not accept OpenBot for it.
- When a service such as GitLab or Adobe Analytics refuses the account that you signed in with, the
  sign-in and Test connection now say that the service refused the account, and tell you to check its
  access or to sign in with another account. Before, Test connection told you to check an API key that
  you did not use, and an agent asked you for a key. On a joined server, the server must also be on this
  version.
