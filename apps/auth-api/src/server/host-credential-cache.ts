const HOST_CREDENTIAL_CACHE_MS = 30_000;
const HOST_CREDENTIAL_CACHE_LIMIT = 10_000;

interface AcceptedCredential {
  tokenHash: string;
  checkedAt: number;
}

function sameHash(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  for (let index = 0; index < right.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export class HostCredentialCache {
  readonly #accepted = new Map<string, AcceptedCredential>();

  accepts(hostId: string, tokenHash: string, now: number): boolean {
    const entry = this.#accepted.get(hostId);
    if (!entry) return false;
    if (now - entry.checkedAt >= HOST_CREDENTIAL_CACHE_MS || now < entry.checkedAt) {
      this.#accepted.delete(hostId);
      return false;
    }
    return sameHash(entry.tokenHash, tokenHash);
  }

  remember(hostId: string, tokenHash: string, now: number): void {
    this.#accepted.delete(hostId);
    this.#accepted.set(hostId, { tokenHash, checkedAt: now });
    while (this.#accepted.size > HOST_CREDENTIAL_CACHE_LIMIT) {
      const oldest = this.#accepted.keys().next();
      if (oldest.done) return;
      this.#accepted.delete(oldest.value);
    }
  }

  forget(hostId: string): void {
    this.#accepted.delete(hostId);
  }
}

export const isolateHostCredentials = new HostCredentialCache();
