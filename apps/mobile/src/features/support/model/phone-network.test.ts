import { describe, expect, it } from "vitest";
import { candidateLineAddress, interfaceAddresses, phoneNetworkText, probeShape } from "./phone-network";

const wifi = { address: "192.168.1.20", vpn: false, underlying: null } as const;
const tunnel = (address: string) => ({ address, vpn: true, underlying: null }) as const;

describe("phone network in a public report", () => {
  it("names the mesh VPN and holds no address of the phone", () => {
    const tailscale = phoneNetworkText({
      connection: "wifi",
      addresses: [wifi, tunnel("100.101.102.103"), tunnel("fd7a:115c:a1e0::ab12:4843")],
    });
    expect(tailscale).toBe("Wi-Fi · VPN: Tailscale");
    const similar = phoneNetworkText({ connection: "cellular", addresses: [tunnel("100.101.102.103")] });
    expect(similar).toBe("Mobile data · VPN: probably Tailscale or a similar mesh VPN (tunnel 100.64.x.x)");
    const zeroTier = phoneNetworkText({
      connection: "wifi",
      addresses: [wifi, { address: "fd8b:d517:9cb0:e6d4:f499:9301:2345:6789", vpn: null, underlying: null }],
    });
    expect(zeroTier).toBe("Wi-Fi · VPN: ZeroTier");
    for (const text of [tailscale, similar, zeroTier]) expect(text).not.toMatch(/101\.102|ab12|192\.168|d517/u);
  });

  it("names a VPN product from the default address of its tunnel, and says when it does not know", () => {
    const name = (address: string) => phoneNetworkText({ connection: "wifi", addresses: [wifi, tunnel(address)] });
    expect(name("10.5.0.2")).toBe("Wi-Fi · VPN: probably NordVPN");
    expect(name("10.2.0.2")).toBe("Wi-Fi · VPN: probably Proton VPN");
    expect(name("10.71.12.9")).toBe("Wi-Fi · VPN: probably Mullvad");
    expect(name("172.16.0.2")).toBe("Wi-Fi · VPN: probably Cloudflare WARP");
    expect(name("10.8.0.6")).toBe("Wi-Fi · VPN: on, name not known (tunnel 10.8.x.x)");
    expect(name("203.0.113.77")).toBe("Wi-Fi · VPN: on, name not known");
    expect(phoneNetworkText({ connection: "wifi", addresses: [{ ...wifi, address: "10.5.0.2" }] })).toBe(
      "Wi-Fi · no VPN found",
    );
    expect(
      phoneNetworkText({
        connection: "cellular",
        addresses: [{ address: "100.72.3.4", vpn: false, underlying: null }],
      }),
    ).toBe("Mobile data · no VPN found");
  });

  it("does not say that no VPN is on when the phone cannot tell", () => {
    expect(phoneNetworkText({ connection: "wifi", addresses: null })).toBe("Wi-Fi · VPN: not known");
    expect(phoneNetworkText({ connection: "wifi", addresses: [] })).toBe("Wi-Fi · VPN: not known");
    expect(phoneNetworkText({ connection: "wifi", addresses: [{ ...wifi, vpn: null }] })).toBe(
      "Wi-Fi · VPN: not known",
    );
    expect(phoneNetworkText({ connection: "vpn", addresses: null })).toBe(
      "Network type not known · VPN: on, name not known",
    );
    expect(
      phoneNetworkText({ connection: "vpn", addresses: [{ address: "10.5.0.2", vpn: true, underlying: "cellular" }] }),
    ).toBe("Mobile data · VPN: probably NordVPN");
    expect(phoneNetworkText({ connection: "none", addresses: null })).toBe("No network");
  });

  it("reads the interfaces from the statistics and the candidate lines of the WebRTC library", () => {
    const addresses = interfaceAddresses([
      { type: "local-candidate", address: "192.168.1.20", networkType: "wifi", vpn: false },
      { type: "local-candidate", ip: "100.101.102.103", networkType: "vpn" },
      { type: "local-candidate", address: "10.5.0.2", vpn: true, networkAdapterType: "cellular4g" },
      { type: "local-candidate", address: "192.168.1.20", networkType: "wifi" },
      { type: "local-candidate", address: "10.0.0.9" },
      { type: "remote-candidate", address: "203.0.113.77" },
      { type: "transport" },
      null,
    ]);
    expect(addresses).toEqual([
      { address: "192.168.1.20", vpn: false, underlying: null },
      { address: "100.101.102.103", vpn: true, underlying: null },
      { address: "10.5.0.2", vpn: true, underlying: "cellular" },
      { address: "10.0.0.9", vpn: null, underlying: null },
    ]);
    expect(candidateLineAddress("candidate:1 1 udp 2122260223 fd7a:115c:a1e0::1 54321 typ host generation 0")).toBe(
      "fd7a:115c:a1e0::1",
    );
    expect(candidateLineAddress("candidate:2 1 udp 1686052607 203.0.113.77 54321 typ srflx raddr 0.0.0.0")).toBeNull();
  });

  it("gives the names of the probe's fields and attributes, never a value", () => {
    const shape = probeShape(
      [
        { type: "local-candidate", address: "100.101.102.103", networkType: "vpn", "a.b": 1 },
        { type: "remote-candidate", secretField: "x" },
      ],
      [
        "candidate:1 1 udp 2122260223 fd7a:115c:a1e0::1 54321 typ host generation 0 ufrag Ab12 network-id 3 network-cost 10",
      ],
      2,
    );
    expect(shape).toBe(
      "2 interfaces; candidate fields: address networkType type; line attributes: generation network-cost network-id ufrag",
    );
    expect(shape).not.toMatch(/101\.102|fd7a|Ab12|secretField/u);
    expect(probeShape([], [], 0)).toBe("0 interfaces; candidate fields: none; line attributes: none");
  });
});
