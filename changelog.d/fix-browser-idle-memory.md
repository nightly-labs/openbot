## Fixes

- Reduce browser memory use by releasing accessibility caches after browser operations. Tabs can freeze and unload again after their last connected popup closes. Open popups and their opener stay loaded while they are connected.
