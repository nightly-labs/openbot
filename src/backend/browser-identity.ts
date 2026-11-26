export function sessionBrowserUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s(?:Electron|OpenBot)\/[^\s]+/gu, "")
    .replace(/(\sChrome\/\d+)\.[\d.]+/u, "$1.0.0.0")
    .replace(/\(X11; Linux [^;)]+\)/u, "(X11; Linux x86_64)");
}

export function browserRequestUserAgent(url: string, userAgent: string, electronVersion: string): string {
  const cleanAgent = sessionBrowserUserAgent(userAgent);
  const hostname = URL.parse(url)?.hostname.replace(/\.+$/u, "");
  if (hostname !== "accounts.google.com") return cleanAgent;
  return cleanAgent.replace(/(Chrome\/[^\s]+)/u, `$1 Electron/${electronVersion}`);
}

const GREASE_CHARACTERS = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"] as const;
const GREASE_VERSIONS = ["8", "99", "24"] as const;

function browserBrandHeader(chromeVersion: string, full: boolean): string {
  const majorVersion = Number.parseInt(chromeVersion, 10);
  const greaseVersion = GREASE_VERSIONS[majorVersion % GREASE_VERSIONS.length];
  const grease = `"Not${GREASE_CHARACTERS[majorVersion % GREASE_CHARACTERS.length]}A${
    GREASE_CHARACTERS[(majorVersion + 1) % GREASE_CHARACTERS.length]
  }Brand";v="${full ? `${greaseVersion}.0.0.0` : greaseVersion}"`;
  const chromium = `"Chromium";v="${full ? chromeVersion : majorVersion}"`;
  return majorVersion % 2 === 0 ? `${grease}, ${chromium}` : `${chromium}, ${grease}`;
}

export function browserClientHints(chromeVersion: string, platform: NodeJS.Platform): Record<string, string> {
  const platformName = platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : "Linux";
  return {
    "Sec-CH-UA": browserBrandHeader(chromeVersion, false),
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": `"${platformName}"`,
  };
}

export interface BrowserHintSystem {
  chromeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  systemVersion: string;
}

export function browserHighEntropyClientHints(system: BrowserHintSystem): Record<string, string> {
  const hints: Record<string, string> = {
    "Sec-CH-UA-Full-Version-List": browserBrandHeader(system.chromeVersion, true),
    "Sec-CH-UA-Full-Version": `"${system.chromeVersion}"`,
    "Sec-CH-UA-Model": '""',
    "Sec-CH-UA-WoW64": "?0",
    "Sec-CH-UA-Form-Factors": '"Desktop"',
  };
  const arch = system.arch === "arm64" ? "arm" : system.arch === "x64" ? "x86" : undefined;
  if (arch) {
    hints["Sec-CH-UA-Arch"] = `"${arch}"`;
    hints["Sec-CH-UA-Bitness"] = '"64"';
  }
  const numbers = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(system.systemVersion);
  if (system.platform === "linux") hints["Sec-CH-UA-Platform-Version"] = '""';
  else if (numbers && system.platform === "darwin") {
    hints["Sec-CH-UA-Platform-Version"] = `"${numbers[1]}.${numbers[2] ?? 0}.${numbers[3] ?? 0}"`;
  }
  return hints;
}

const HINT_ORIGIN_LIMIT = 500;

export class BrowserHintRequests {
  readonly #origins = new Map<string, ReadonlySet<string>>();

  note(url: string, responseHeaders: Record<string, string[]> | undefined): void {
    const origin = URL.parse(url)?.origin;
    const header = Object.entries(responseHeaders ?? {}).find(([name]) => name.toLowerCase() === "accept-ch");
    if (!origin || !header) return;
    const names = header[1]
      .flatMap((value) => value.split(","))
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    this.#origins.delete(origin);
    if (names.length === 0) return;
    this.#origins.set(origin, new Set(names));
    const oldest = this.#origins.keys().next().value;
    if (this.#origins.size > HINT_ORIGIN_LIMIT && oldest !== undefined) this.#origins.delete(oldest);
  }

  requested(url: string, pageUrl: string): ReadonlySet<string> | undefined {
    const origin = URL.parse(url)?.origin;
    if (!origin || URL.parse(pageUrl)?.origin !== origin) return undefined;
    return this.#origins.get(origin);
  }
}
