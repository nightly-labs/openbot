### Fixed

- A webhook routine gets its endpoint also when this computer is not published as a server. Before,
  the endpoint did not show when you had never published this computer, or when you signed out and
  in again after you published it. OpenBot now adds this computer to your account by itself, and
  does not make it reachable online. A computer that has no server name gets the name "OpenBot".
