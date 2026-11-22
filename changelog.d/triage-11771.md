### Fixed

- When OpenBot cannot read the plan usage of a connected provider, such as Grok, the left rail now
  keeps the provider with a dashed ring. Its card says "Could not read usage. Trying again later."
  Before, the ring went away with no reason, and the provider looked disconnected. A provider that has
  no plan usage, such as one that uses an API key, still shows no ring. A desktop joined to a server
  and the web client show the same ring when the server is also on the new version.
