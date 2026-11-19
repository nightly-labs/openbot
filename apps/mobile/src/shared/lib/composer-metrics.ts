export const COMPOSER_TOOLBAR_HEIGHT = 48;
export const COMPOSER_FIELD_VERTICAL_PADDING = 26;
const COMPOSER_REST_HEIGHT_LOSS = 8;

export function restingComposerHeight(fontScale: number): number {
  return (
    Math.max(COMPOSER_TOOLBAR_HEIGHT, 22 * fontScale + COMPOSER_FIELD_VERTICAL_PADDING) - COMPOSER_REST_HEIGHT_LOSS
  );
}

export function composerBottomGap(bottomInset: number): number {
  return Math.max(bottomInset, 10);
}
