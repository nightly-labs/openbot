### Fixed

- Send sign-in codes, invitations and other OpenBot emails through a second provider when the main
  mail server reaches its hourly limit. Before, sign-in stopped with "OpenBot cannot send more email
  right now" until the limit reset.
