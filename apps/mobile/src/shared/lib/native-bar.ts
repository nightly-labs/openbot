import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVerticalBarShown } from "@/shared/lib/vertical-bar";

/**
 * The height of the native bar under the status bar, by the rule that the stack uses: 50 pt on iPad,
 * 44 pt on iPhone, and the 64 dp Material top app bar on Android.
 */
export const NATIVE_BAR_HEIGHT = Platform.OS === "ios" ? (Platform.isPad ? 50 : 44) : 64;

/** The size of the glass bar buttons that the app draws itself. */
export const BAR_BUTTON_SIZE = 48;

/**
 * The top of a drawn bar button under the status bar that lines up with the native bar buttons of the
 * screen beside it, as in the two columns of a wide window.
 */
export const NATIVE_BAR_BUTTON_TOP = (NATIVE_BAR_HEIGHT - BAR_BUTTON_SIZE) / 2;

/** The least room over the top bars while the status bar is in the vertical bar of iPhone Duo. */
const VERTICAL_BAR_TOP_GAP = 20;

/**
 * Where the top bar starts. iOS moves the status bar into the vertical bar of iPhone Duo, and the top
 * inset then has no status bar to clear; the bars keep a gap from the top edge, as under a status bar.
 */
export function useBarTop(): number {
  const insets = useSafeAreaInsets();
  const verticalBar = useVerticalBarShown();
  return verticalBar ? Math.max(insets.top, VERTICAL_BAR_TOP_GAP) : insets.top;
}
