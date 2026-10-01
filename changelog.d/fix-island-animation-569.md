### Fixed

- When the Dynamic Island width or height changes, the logo and the greeting now move with the black
  island, on the same curve and at the same distance from each edge. Before, they got to their new
  place first and showed outside the island while it grew.
- Settings → Dynamic Island → Size: the built-in display preview now draws the island that display
  shows. On a built-in display with no notch, it no longer draws a notch. Each preview scales so
  that the widest width fits its frame, and keeps that scale while the setting changes. The
  preview island hangs below the frame edge, so the edge runs over it.

- A lower Dynamic Island now has smaller bottom corners (7.9px at 75% height, 14px at 100%), and a
  higher one larger corners. On an external display the island stays a capsule at every height. At
  100% height nothing changes.

### Changed

- The logo and the greeting blur a little while the Dynamic Island changes size, as much as the move
  is large: one slow step of the width setting barely blurs them, and a large move blurs them in
  full. The logo also gets a little smaller and half closes its eyes, and on a large move rounds its
  corners a little. The greeting gets a little fainter, and when a large move lands it pops softly.
  Both are sharp and at rest again as the island settles. With Reduce motion on, none of this
  happens.
- Each idle greeting is now a small 3D card that moves once as it shows: the hand waves and turns
  into heart hands, the smile spins like a ball into a grin, the raised hands turn to clap twice and
  turn back raised, and the sparkles light up one star at a time. With Reduce motion on, they do not
  move.
- Below 100%, the idle Dynamic Island width now changes with each step of the width setting, from
  the smallest island at 20% to the default at 100%. Before, the lowest steps gave the same island.
  On a built-in display with no notch, the smallest idle island is now 82px, with a 16px gap between
  the logo and the greeting. It was 120px. The same percent can give a different width than before.
  Beside a physical notch, the width does not change.
