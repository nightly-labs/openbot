### Changed

- Product analytics now counts how often OpenBot ends without a clean quit: a crash, a force quit, a kill or a power loss. At the next start, OpenBot sends one event with the phase, the previous app version, a coarse uptime class, the number of new local crash dumps, and whether the computer slept or started again. Crash dumps stay on the computer. The analytics setting applies.
