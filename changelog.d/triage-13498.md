### Fixed

- When Connect fails for a provider, the provider status now shows the reason when OpenBot has a
  clear text for it, for example a Pi extension that cannot load. For other failures, "Last error"
  now shows the reason of this Connect, not an older message. A Pi warning that does not stop Pi, such
  as a note about an extension package, no longer shows as "Last error".
