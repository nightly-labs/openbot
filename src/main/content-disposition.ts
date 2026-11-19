export function contentDispositionFileName(disposition: string | null, fallback: string): string {
  const encodedName = disposition?.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
  if (!encodedName) return fallback;
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return fallback;
  }
}

export function inlineContentDisposition(name: string): string {
  try {
    if (!name) return "inline";
    const encoded = encodeURIComponent(name).replace(
      /['()*]/gu,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `inline; filename*=UTF-8''${encoded}`;
  } catch {
    return "inline";
  }
}
