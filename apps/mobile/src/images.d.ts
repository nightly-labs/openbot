// Metro resolves a bundled image import to an asset id. Expo ships no declaration for it,
// so importing a PNG or WebP needs this one to stay typed instead of falling back to `any`.
declare module "*.png" {
  const asset: number;
  export default asset;
}

declare module "*.webp" {
  const asset: number;
  export default asset;
}

// KaTeX's fonts, which the native math renderer loads with expo-font.
declare module "*.ttf" {
  const asset: number;
  export default asset;
}
