### Fixed

- On Windows, OpenBot now opens at normal speed after you restart or shut down the computer while it runs. Before, the restart left the database open, so the next start checked the full database before the window showed. On a large database this took minutes. After a crash or a power loss, OpenBot still checks the database before it opens.
