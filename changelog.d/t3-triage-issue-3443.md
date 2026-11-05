### Added

- Give a named browser profile its own proxy. In Server settings > Browser profiles, add a proxy
  with one address, such as `socks5://user:password@host:1080` or `http://host:3128`, and choose it
  in the Proxy menu of a profile. A user name and a password are optional, for SOCKS5 too. A
  profile without a proxy uses the proxy settings of the computer that runs OpenBot. A badge shows
  the proxy of each profile, and it shows when the proxy does not answer. OpenBot keeps the
  password encrypted and shows it only as a mask. When the proxy cannot be set, the tab does not open,
  so pages never go out without the proxy. Owners and admins of a joined server can do the same
  from the desktop app and the web. The address can also be `user:password@host:port` or
  `host:port:user:password`. The agent's profile select and the toolbar label of a tab show the
  proxy. A page that does not open names the proxy, and tells when the proxy refused the sign-in.
  Before a proxy change closes open tabs, OpenBot asks. A save that does not change the address
  keeps the tabs open. When two proxies have the same host, their names also show the port.
- Use your own computer as the proxy of a browser profile on a joined server. In the Proxy menu of
  a profile, select "Use your computer…", or select Share in the Proxies section. The pages of that
  profile then go out through the internet connection of your computer, while OpenBot is open on
  it. Your computer opens only public internet addresses, so the server cannot reach your local
  network. Select Stop sharing to stop. Owners and admins can share.

### Fixed

- The window no longer stops to respond when the browser panel changes to the active tab of the
  agent.
