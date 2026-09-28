// AppleZoom reveals tappable agent rows before its native return transition ends.
// Navigating during that window can lose the first tap when reopening the same chat,
// so retain it until transitionEnd and route focus have both settled (in either order).
export function createChatNavigationGate() {
  let transitioning = false;
  let pending: { navigate: () => void; isFocused: () => boolean } | null = null;
  // The home rows that open each chat. A chat opened from the search sheet goes through its row, so
  // the chat has the row's zoom source and zooms back into the row when it closes.
  const openers = new Map<string, () => void>();

  function flush() {
    if (transitioning || !pending?.isFocused()) return;
    const { navigate } = pending;
    pending = null;
    navigate();
  }

  return {
    request(navigate: () => void, isFocused: () => boolean) {
      // Nested navigators may already be focused without emitting an initial focus
      // event. Tracking focus in a boolean initially set to false blocked every tap
      // on first load. Read isFocused() on each flush; focus events only retry a
      // pending tap when focus arrives after transitionEnd.
      pending = { navigate, isFocused };
      flush();
    },
    start() {
      transitioning = true;
    },
    finish() {
      transitioning = false;
      flush();
    },
    focus() {
      flush();
    },
    blur() {
      pending = null;
    },
    cancel() {
      transitioning = false;
      pending = null;
    },
    /** Registers the home row that opens a chat. Returns a function that removes it. */
    registerOpener(chatId: string, open: () => void) {
      openers.set(chatId, open);
      return () => {
        if (openers.get(chatId) === open) openers.delete(chatId);
      };
    },
    /** Opens a chat through its home row. Returns false when the home screen shows no row for it. */
    openFromHome(chatId: string): boolean {
      const open = openers.get(chatId);
      open?.();
      return Boolean(open);
    },
  };
}
