import type { TextStyle } from "react-native";

/**
 * The type roles of the mobile layout that HeroUI `Typography` has no variant for. `Typography`
 * keeps the family, weight and color; spread a role into its `style`. A theme size class such as
 * `text-label` reads to tailwind-merge as a color, so next to `text-muted` one of the two is lost.
 */
export const typeScale = {
  /** The big header of a full screen: the server name on home, Routines, Usage. */
  largeTitle: { fontSize: 34, lineHeight: 40, letterSpacing: -0.68 },
  /** The big header on Android: the Material 3 headline of a medium top app bar. */
  largeTitleAndroid: { fontSize: 28, lineHeight: 36 },
  /** The heading of the task editor above the search field. */
  taskHeading: { fontSize: 22, lineHeight: 28, letterSpacing: -0.22 },
  /** The server name at the top of the drawer. */
  drawerTitle: { fontSize: 26, lineHeight: 32, letterSpacing: -0.52 },
  /** The small title that the big header leaves in the bar. */
  barTitle: { fontSize: 17, lineHeight: 22 },
  /** The small title on Android: the Material 3 title of a small top app bar. */
  barTitleAndroid: { fontSize: 22, lineHeight: 28 },
  /** A row name: a chat, a server, a drawer row. */
  rowTitle: { fontSize: 16, lineHeight: 21 },
  /** A task or search row name, a little smaller than a chat name. */
  body: { fontSize: 15.5, lineHeight: 20 },
  /** One line under a row name, such as a chat preview, and a drawer row value. */
  preview: { fontSize: 14, lineHeight: 19 },
  /** Section headings, times and supporting lines. */
  caption: { fontSize: 13, lineHeight: 18 },
  /** Labels under avatars and small supporting lines. */
  small: { fontSize: 12.5, lineHeight: 16 },
} as const satisfies Record<string, TextStyle>;
