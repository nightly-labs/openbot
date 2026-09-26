declare const toast: ((message: string) => void) & { error: (message: string) => void };
declare function t(key: string): string;
declare const Alert: { alert: (title: string, message?: string) => void };
declare const text: { errorMessage: (error: unknown, fallback: string) => string };
declare const error: unknown;
declare const count: number;

export function notify(): void {
  toast.error(t("error.file.saveFailed"));
  Alert.alert(t("mobile.chat.deleteTitle"));
  text.errorMessage(error, t("error.chat.loadFailed"));
}

export const translated = <p>{t("chat.empty")}</p>;
export const separator = <span> · </span>;
export const number = <span>{count}</span>;
export const accessibleName = <a href="/" aria-label={t("common.close")} />;
export const attributes = <div class="p-2" data-state="open" role="status" id="panel" />;
export const image = <img alt="" src="a.png" />;
