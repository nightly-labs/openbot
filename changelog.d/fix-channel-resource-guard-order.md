### Fixed

- The app no longer freezes when an agent declares a very long task resource list. OpenBot now
  refuses an oversized list at once, instead of resolving every path in the list first.