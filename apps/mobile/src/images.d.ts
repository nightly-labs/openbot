// Metro resolves a bundled image import to an asset id. Expo ships no declaration for it,
// so importing a PNG needs this one to stay typed instead of falling back to `any`.
declare module "*.png" {
  const asset: number;
  export default asset;
}
