### Fixed

- Pair a phone, make a permanent phone link and disconnect a phone also while the OpenBot account service is very busy. Before, these actions failed at once with "The account service could not complete the request." when the account database refused the request, while the list of phones still loaded. The same applies to the other account actions that save data, such as sign-in codes.
