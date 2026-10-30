### Fixed

- A channel lead can now route a very long request. Before, a Grok lead got only part of a request of about 100,000 bytes or more, and the channel showed "The channel lead could not route this message". The lead now reads the first 20,000 bytes of the request.
