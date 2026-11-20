### Fixed

- On a Linux server or computer with the `C.UTF-8` or `POSIX` locale, pages in the OpenBot browser
  load correctly. Before, the browser told pages that the language was `c`, which is not a language,
  and some pages, such as the Gumroad Products page, stayed blank.
