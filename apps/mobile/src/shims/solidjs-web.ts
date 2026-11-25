function unsupportedSolidWebUi(): never {
  throw new Error("The web renderer from bloub is not available in the native app.");
}

export const Dynamic = unsupportedSolidWebUi;
export const mergeProps = unsupportedSolidWebUi;
export const ssr = unsupportedSolidWebUi;
export const ssrAttribute = unsupportedSolidWebUi;
export const ssrClassName = unsupportedSolidWebUi;
export const ssrGroup = unsupportedSolidWebUi;
export const ssrHydrationKey = unsupportedSolidWebUi;
export const ssrStyle = unsupportedSolidWebUi;

const escapeHtml = unsupportedSolidWebUi;

export { escapeHtml as escape };
