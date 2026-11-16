### Fixed

- Bot checks such as DataDome no longer find the agent browser when an agent runs page scripts. Before,
  sites such as Higgsfield could block the agent with "unusual activity from your device".
- On a server with no GPU, the agent browser no longer looks like headless Chrome to bot checks. Its
  WebGL named the software renderer (SwiftShader).
- A site can still block the IP address of a data center. On a server, give the agent a browser
  profile with a proxy, such as "Your computer".
