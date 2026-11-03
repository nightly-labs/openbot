### Added

- Company sign-in. A server owner can connect an OpenID Connect provider, such as Microsoft Entra ID, Okta or Google Workspace, in Members → Company sign-in. After a test sign-in passes, people with an email at the company domains sign in through the company page: in the browser from the desktop app, and in the same tab in the web app. A person who signs in this way joins the server as a member with no invitation, while the server has a free seat. A person whom the owner removed stays out.
- For Microsoft Entra ID, the issuer field accepts the tenant ID URL, the tenant domain, or the metadata URL from the portal.
- User sync (SCIM). When the company provider turns off a person, OpenBot signs them out and removes them from the server. When the provider turns the person on again, they come back.

### Fixed

- The desktop app now signs out when the account service ends its session, for example after a revocation. Before, it stayed signed in until the next start.
- The app no longer stops responding while a chat history loads, on desktop and on the web.
