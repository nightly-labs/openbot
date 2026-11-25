import {
  decodeWebMessagingInstallMark,
  decodeWebMessagingInstallReceipt,
  WEB_MESSAGING_INSTALL_CHANNEL,
  type WebMessagingInstallPlatform,
  webMessagingInstallKey,
} from "@openbot/contracts/web-messaging-install";

const RECEIPT_TIMEOUT_MS = 3_000;

export function handOffToWebClient(
  platform: WebMessagingInstallPlatform,
  fragment: URLSearchParams,
): Promise<boolean> | null {
  const nonce = fragment.get("nonce");
  const grant = fragment.get("grant");
  if (!nonce || !grant) return null;
  try {
    const key = webMessagingInstallKey(nonce);
    const marked = decodeWebMessagingInstallMark(localStorage.getItem(key), Date.now());
    localStorage.removeItem(key);
    if (marked !== platform) return null;
  } catch {
    return null;
  }
  const channel = new BroadcastChannel(WEB_MESSAGING_INSTALL_CHANNEL);
  return new Promise<boolean>((resolve) => {
    const done = (received: boolean) => {
      clearTimeout(timer);
      channel.close();
      resolve(received);
    };
    const timer = setTimeout(() => done(false), RECEIPT_TIMEOUT_MS);
    channel.onmessage = (event) => {
      if (decodeWebMessagingInstallReceipt(event.data) === nonce) done(true);
    };
    channel.postMessage({ platform, nonce, grant });
  });
}
