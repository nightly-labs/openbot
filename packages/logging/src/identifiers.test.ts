import { describe, expect, it } from "vitest";
import { maskIdentifiers, redactText } from "./index";

describe("maskIdentifiers", () => {
  it("masks network addresses and keeps their kind", () => {
    expect(maskIdentifiers("from 10.0.0.7, 172.20.1.1, 192.168.1.20 to 203.0.113.77.")).toBe(
      "from [private-ip], [private-ip], [private-ip] to [public-ip].",
    );
    expect(maskIdentifiers("100.101.102.103 127.0.0.1 169.254.10.1")).toBe("[shared-ip] [loopback-ip] [link-local-ip]");
    expect(maskIdentifiers("2001:db8:85a3:0:0:8a2e:370:7334, fe80::1, aa:bb:cc:dd:ee:ff")).toBe(
      "[ipv6], [ipv6], [ipv6]",
    );
    expect(maskIdentifiers("http://192.168.1.5:8080/v1/me")).toBe("http://[private-ip]:8080/v1/me");
    expect(maskIdentifiers("OpenBot 1.4.0 (212), 999.1.1.1")).toBe("OpenBot 1.4.0 (212), 999.1.1.1");
  });

  it("masks each host name that is not an OpenBot service", () => {
    expect(maskIdentifiers("GET https://anna.example.com:8443/v1/me -> failed")).toBe(
      "GET https://[host]:8443/v1/me -> failed",
    );
    expect(maskIdentifiers("wss://user@my-server.internal/socket")).toBe("wss://[host]/socket");
    expect(maskIdentifiers("Failed to resolve nas.anna.pl, then anna-pages.openbot.site.")).toBe(
      "Failed to resolve [host], then [host].",
    );
    const service = "GET https://api.openbot.run/v1/me and turn2.openbot.run and http://localhost:8081/status";
    expect(maskIdentifiers(service)).toBe(service);
  });

  it("masks record IDs, hashes and the name of a user folder", () => {
    expect(maskIdentifiers("host 0f8fad5b-d9cb-469f-a165-70867728950e /v1/x/4d2a9c1e7b3f5a6088c1d2e3f4a5b6c7")).toBe(
      "host [id] /v1/x/[id]",
    );
    expect(maskIdentifiers("device usr_2NfQ8aLm3Xz9Kp4Rt7Vw and 12345678901234567890")).toBe(
      "device usr_[id] and [id]",
    );
    expect(maskIdentifiers("open /Users/annakowalska/Library/a.json or /home/anna/.config")).toBe(
      "open /Users/[user]/Library/a.json or /home/[user]/.config",
    );
  });

  it("keeps the words, versions and codes of a diagnostic", () => {
    const text =
      "server-1 attempt 2 failed at signal (5021 ms): TypeError: undefined is not an object (evaluating 'state.connection.close') [webrtc/ice/failed], iPhone 16 Plus (iPhone17,4), phone-feedback-v1, host_update_required";
    expect(maskIdentifiers(text)).toBe(text);
  });

  it("gives the same text on a second run, also after the secret redaction", () => {
    const text = redactText(
      "GET https://anna.example.com/v1/hosts/0f8fad5b-d9cb-469f-a165-70867728950e from 203.0.113.77 for anna@example.com token=abcdefghijklmnop",
    );
    const masked = maskIdentifiers(text);
    expect(masked).not.toContain("anna");
    expect(masked).not.toContain("abcdefghijklmnop");
    expect(maskIdentifiers(masked)).toBe(masked);
  });
});
