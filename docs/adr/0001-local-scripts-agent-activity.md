# Report agent activity on the Local scripts roster

Local scripts report one activity state per agent across its threads. A wait for a person takes
priority over work in another thread so a monitoring tool can ask for attention promptly. The
existing roster provides the state and the time of its last observed change. The time belongs to
the running host process, which can report an unknown start without keeping a history of activity
in the database.
