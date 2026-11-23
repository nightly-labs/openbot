### Fixed

- Many custom agents no longer slow down or freeze the computer after one custom agent process stops. Before, a custom agent process that ran no chat could restart all custom agents. Each start then read old chats again and left one agent process running for each agent, which used all the memory on some computers.
