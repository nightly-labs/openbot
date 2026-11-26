import { Effect } from "effect";
import { proxyUrlFromRules } from "./signal-ingress";

export const CODEX_API_URL = "https://chatgpt.com/";
export const GROK_API_URL = "https://cli-chat-proxy.grok.com/";
const PROXY_READ_TIMEOUT_MS = 2_000;
const USER_PROXY_NAMES = new Set(["https_proxy", "http_proxy", "all_proxy"]);
const DIRECT_ADDRESSES = [
  "localhost",
  "127.0.0.1",
  "::1",
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  ".local",
];

function valuesNamed(environment: NodeJS.ProcessEnv, names: ReadonlySet<string>): string[] {
  return Object.entries(environment).flatMap(([key, value]) =>
    names.has(key.toLowerCase()) && value?.trim() ? [value.trim()] : [],
  );
}

function providerProxyEnvironment(rules: string, environment: NodeJS.ProcessEnv): Record<string, string> {
  if (valuesNamed(environment, USER_PROXY_NAMES).length > 0) return {};
  const userBypass = valuesNamed(environment, new Set(["no_proxy"])).flatMap((value) => value.split(/[\s,]+/u));
  if (userBypass.includes("*")) return {};
  const proxy = proxyUrlFromRules(rules);
  if (!proxy) return {};
  return { HTTPS_PROXY: proxy, NO_PROXY: [...new Set([...userBypass.filter(Boolean), ...DIRECT_ADDRESSES])].join(",") };
}

export function createProviderSystemProxy(
  apiUrl: string,
  resolveProxy: (url: string) => Promise<string>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  let current: Readonly<Record<string, string>> = {};
  let reading = false;
  const refresh = Effect.tryPromise(() => resolveProxy(apiUrl)).pipe(
    Effect.timeout(PROXY_READ_TIMEOUT_MS),
    Effect.flatMap((rules) =>
      Effect.sync(() => {
        current = providerProxyEnvironment(rules, environment);
      }),
    ),
    Effect.ignore,
    Effect.ensuring(
      Effect.sync(() => {
        reading = false;
      }),
    ),
  );
  const read = Effect.suspend(() => {
    if (reading) return Effect.void;
    reading = true;
    return refresh;
  });
  return {
    refresh: read,
    environment: (): Readonly<Record<string, string>> => {
      Effect.runFork(read);
      return current;
    },
  };
}
