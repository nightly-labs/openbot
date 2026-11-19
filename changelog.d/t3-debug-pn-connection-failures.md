### Changed

- The app log now records each STUN or TURN server that a remote connection cannot use, with its
  error code, and the candidate types of the path that a connection uses, such as
  `relay/udp -> srflx/udp`. Support can then find a VPN, DNS or blocked port that stops a device
  from connecting. The log never names the addresses of a device.
