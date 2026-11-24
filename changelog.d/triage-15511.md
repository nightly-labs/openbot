### Fixed

- Shared tables work again after their file is deleted while OpenBot is open. Before, each table action failed with "agent-data.db does not exist yet" until you restarted OpenBot. Now OpenBot makes a new, empty file at the next table action. Tables that were in the deleted file do not come back.
