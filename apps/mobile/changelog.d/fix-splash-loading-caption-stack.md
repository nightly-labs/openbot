### Fixed

- During app launch, the loading line under the eyes could appear several times at once. Each new status string opened a new caption while earlier ones were still fading out. The status line now keeps one view and updates the text in place.
- A short delay before the splash caption clears avoids replaying the entrance animation on brief launch handoff gaps.
