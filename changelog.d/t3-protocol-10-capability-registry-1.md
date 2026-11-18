### Changed

- The desktop app and the web client now use Team API protocol 10 with a server on this version. A
  protocol 10 request does not send again the list of capabilities that protocol 9 has. It sends
  only the newer ones and the ones that it does not support. This makes space for new features on
  joined servers. A server on this version also accepts the older protocols, so older desktop apps,
  the web client and the mobile app keep working as before.
