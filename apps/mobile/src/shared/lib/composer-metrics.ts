/**
 * The sizes of the chat composer that other bottom fields copy. The controls are 40 pt with a 4 pt
 * inset, and one text line sits in the same box: a line plus 13 pt above and below.
 */
export const COMPOSER_TOOLBAR_HEIGHT = 48;
export const COMPOSER_FIELD_VERTICAL_PADDING = 26;
/** At rest the composer gives up this much of the height of its single line. */
const COMPOSER_REST_HEIGHT_LOSS = 8;

/** The height of the composer at rest, with one line of text at the user's text size. */
export function restingComposerHeight(fontScale: number): number {
  return (
    Math.max(COMPOSER_TOOLBAR_HEIGHT, 22 * fontScale + COMPOSER_FIELD_VERTICAL_PADDING) - COMPOSER_REST_HEIGHT_LOSS
  );
}

/** The space under the composer: the home indicator, or a minimum gap. */
export function composerBottomGap(bottomInset: number): number {
  return Math.max(bottomInset, 10);
}
