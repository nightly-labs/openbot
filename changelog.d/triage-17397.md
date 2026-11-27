### Fixed

- The estimated cost of a DeepSeek agent now uses DeepSeek's off-peak price, which is half of the peak price. Peak hours are Monday to Friday, 01:00 to 04:00 and 06:00 to 10:00 UTC. Before, each turn got the peak price, so the estimate was about 2 times too high for most of the day. Turns that OpenBot recorded before this update keep their old estimate. On a joined server, the server must also be on this version.
