### Fixed

- Agents can save to shared tables again when the shared database file or its folder became
  read-only, or when another program replaced the file while OpenBot was open. Before, every write
  failed with "attempt to write a readonly database". If OpenBot still cannot change the file, the
  agent now tells you why.
