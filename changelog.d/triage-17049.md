### Fixed

- When the channel lead's model fails while it routes a message, the channel now says why in more cases: the account has no credit, the provider does not permit the model, the provider blocked the request, the request is too long, the provider had an error, the model gave no answer, the model stopped before it answered, or the model did not answer in time. Before, these cases showed only "The channel lead could not route this message." Each message also says what to do next. On a joined server, the server must also have this version.
