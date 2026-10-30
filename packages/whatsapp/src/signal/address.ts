// Signal protocol addresses of WhatsApp JIDs (`<name>.<deviceId>`) and sender key names.

import { jidDecode } from "@openbot/whatsapp/baileys";

export interface SignalAddress {
  /** JID user, with `_<domainType>` for every domain except WhatsApp (0). */
  name: string;
  deviceId: number;
}

const HOSTED_SERVERS = new Set(["hosted", "hosted.lid"]);

export function jidToAddress(jid: string): SignalAddress {
  const decoded = jidDecode(jid);
  if (!decoded?.user) throw new Error(`Invalid JID for a Signal address: ${jid}`);
  const deviceId = decoded.device ?? 0;
  if (deviceId === 99 && !HOSTED_SERVERS.has(decoded.server)) {
    throw new Error(`Device 99 is valid only on hosted servers: ${jid}`);
  }
  const domainType = decoded.domainType ?? 0;
  return { name: domainType === 0 ? decoded.user : `${decoded.user}_${domainType}`, deviceId };
}

export function addressToString(address: SignalAddress): string {
  return `${address.name}.${address.deviceId}`;
}

/** Storage name of the sender key of `author` in `group`: `<group>::<name>::<deviceId>`. */
export function senderKeyName(group: string, author: SignalAddress): string {
  return `${group}::${author.name}::${author.deviceId}`;
}
