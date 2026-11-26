import type { TextStyle } from "react-native";

export const typeScale = {
  largeTitle: { fontSize: 34, lineHeight: 40, letterSpacing: -0.68 },
  largeTitleAndroid: { fontSize: 28, lineHeight: 36 },
  taskHeading: { fontSize: 22, lineHeight: 28, letterSpacing: -0.22 },
  drawerTitle: { fontSize: 26, lineHeight: 32, letterSpacing: -0.52 },
  barTitle: { fontSize: 17, lineHeight: 22 },
  barTitleAndroid: { fontSize: 22, lineHeight: 28 },
  rowTitle: { fontSize: 16, lineHeight: 21 },
  chatName: { fontSize: 17.5, lineHeight: 23 },
  chatDetail: { fontSize: 15.5, lineHeight: 21 },
  chatTime: { fontSize: 14, lineHeight: 19 },
  pinnedName: { fontSize: 13.5, lineHeight: 17 },
  body: { fontSize: 15.5, lineHeight: 20 },
  preview: { fontSize: 14, lineHeight: 19 },
  caption: { fontSize: 13, lineHeight: 18 },
  small: { fontSize: 12.5, lineHeight: 16 },
} as const satisfies Record<string, TextStyle>;
