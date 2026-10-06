import { isAndroid } from "@/shared/lib/platform";

/**
 * A header in a sheet does not touch the status bar, but on Android the native header still adds the
 * status bar height above its title. `disableTopInsetApplication` removes that space, and
 * `statusBarTranslucent: false` makes the reported header height agree. Both apply only on Android,
 * and iOS does not get them.
 */
export const sheetHeaderInsetOptions = isAndroid
  ? {
      statusBarTranslucent: false,
      unstable_nativeProps: { headerConfig: { disableTopInsetApplication: true } },
    }
  : {};
