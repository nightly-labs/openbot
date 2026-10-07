### Added

- Connect Bitwarden in Marketplace or Server settings to fill browser passwords and authenticator codes. Share logins through a folder named `Shared with OpenBot`. The CLI session lasts until disconnect, eight idle hours, or app exit.

### Security

- Bitwarden fills require an exact HTTPS origin and a current item in the shared folder. Session keys and login values are not saved by OpenBot, and short authenticator codes are redacted from logs.
