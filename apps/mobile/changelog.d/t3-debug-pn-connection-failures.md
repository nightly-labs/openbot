### Changed

- The support log now records each STUN or TURN server that the connection to a server cannot use,
  with its error code. Support can then find a VPN, DNS or blocked port that stops the phone from
  connecting. The log never names the addresses of the phone.
