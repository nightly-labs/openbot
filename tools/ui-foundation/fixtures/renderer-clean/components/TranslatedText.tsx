declare const toast: ((message: string) => void) & { error: (message: string) => void };
declare function t(key: string): string;
declare const Alert: { alert: (title: string, message?: string) => void };
declare const text: { errorMessage: (error: unknown, fallback: string) => string };
declare const error: unknown;
declare const count: number;
declare const name: string;
declare const state: string;
declare function format(value: number, options: { unit: string }): string;

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
export const joined = <span title={`${name} · ${count}`} />;
export const placeholderOnly = <img alt={`${name}`} src="a.png" />;
export const translatedParts = <span aria-label={`${t("common.close")}: ${name}`} />;
export const nestedCall = <span title={`${format(count, { unit: "kb" })} / ${`${count}%`}`} />;
export const classTemplate = <div class={`row ${state}`} />;
export const labelledBy = <section aria-labelledby={`${name}-summary`} />;
