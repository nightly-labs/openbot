### Fixed

- Keep browser navigation through a verified page redirect without repeating the request. Initial opens share a 10-second navigation deadline; a normal timeout retains the tab, while failed private opens close their tabs.
