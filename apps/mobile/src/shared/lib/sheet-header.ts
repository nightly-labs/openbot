import { isAndroid } from "@/shared/lib/platform";

export const sheetHeaderInsetOptions = isAndroid
  ? {
      statusBarTranslucent: false,
      unstable_nativeProps: { headerConfig: { disableTopInsetApplication: true } },
    }
  : {};

export function isSheetHeader(options: { statusBarTranslucent?: boolean }) {
  return isAndroid && options.statusBarTranslucent === false;
}
