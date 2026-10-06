import { getCACertificates, setDefaultCACertificates } from "node:tls";

// Node trusts only its bundled root list, so `fetch` and `ws` in the main process reject a root
// that the operating system trusts and Chromium accepts. A company network that inspects TLS, such
// as Fortinet or Zscaler, re-signs every connection with such a root. Sign-in, team, and
// provider calls then fail although the same address opens in a browser. Adding the system roots
// gives the main process the trust that Chromium already has; it does not turn off verification.
export function trustSystemCertificates(): void {
  const system = getCACertificates("system");
  if (system.length === 0) return;
  setDefaultCACertificates([...new Set([...getCACertificates("default"), ...system])]);
}
