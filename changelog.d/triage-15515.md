### Fixed

- OpenBot uses less CPU while agents work and you look at the window. Before, the face of each working agent moved at up to 80 frames per second, and one working agent could keep the window at more than half of a processor core. A working face now moves at up to 30 frames per second. A face under the pointer or with the focus, and a face that follows the pointer, still move at the full rate.
