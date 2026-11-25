### Fixed

- The OpenBot database no longer grows by tens of megabytes each day while agents work. Before, OpenBot kept every intermediate save of each chat message, also after a newer save replaced it. Now OpenBot removes these replaced saves when it starts and every 6 hours. Chats and their history do not change.
