### Fixed

- When a service does not accept OpenBot for its browser sign-in, the connect dialog now says that the
  service does not accept OpenBot yet and that your account is not the cause. Before, some services
  showed only their own English text, such as "No dynamic client registration template matched this
  request.". On a joined server, the server must also be on this version.
- Connect Tessie from the Apps marketplace with an access token from Tessie's Developer Settings. Before,
  the browser sign-in always failed, because Tessie does not accept OpenBot for it.
- Connect Omnisend from the Apps marketplace with an Omnisend API key. Before, the browser sign-in always
  failed, because Omnisend does not accept OpenBot for it.
