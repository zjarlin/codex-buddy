import { describe, expect, it } from "vitest";

import { broadcastAddress, parseAnnouncement } from "../src/team-usage-discovery.js";

const ID = "8f14e45f-ceea-467a-9f0e-1a2b3c4d5e6f";

describe("team usage LAN discovery", () => {
  it("computes the directed broadcast of an IPv4 subnet", () => {
    expect(broadcastAddress("192.168.1.20", "255.255.255.0")).toBe("192.168.1.255");
    expect(broadcastAddress("10.1.4.9", "255.255.0.0")).toBe("10.1.255.255");
    expect(broadcastAddress("172.16.3.4", "255.255.252.0")).toBe("172.16.3.255");
  });

  it("has no broadcast for a point-to-point or host-only interface", () => {
    expect(broadcastAddress("10.0.0.1", "255.255.255.255")).toBeNull();
    expect(broadcastAddress("10.0.0.0", "255.255.255.254")).toBeNull();
    expect(broadcastAddress("not-an-address", "255.255.255.0")).toBeNull();
  });

  it("takes a member announcement and pairs the source address with its port", () => {
    expect(
      parseAnnouncement(
        {
          protocol: "codexhost-team-usage-discovery-v1",
          id: ID,
          name: "甲",
          department: "研发",
          port: 45871,
        },
        "192.168.1.30",
      ),
    ).toMatchObject({
      id: ID,
      name: "甲",
      department: "研发",
      address: "192.168.1.30:45871",
    });
  });

  it("rejects foreign, malformed and privileged packets", () => {
    const good = { protocol: "codexhost-team-usage-discovery-v1", id: ID, name: "甲", port: 45871 };
    expect(parseAnnouncement({ ...good, protocol: "other" }, "10.0.0.2")).toBeNull();
    expect(parseAnnouncement({ ...good, id: "nope" }, "10.0.0.2")).toBeNull();
    expect(parseAnnouncement({ ...good, name: "" }, "10.0.0.2")).toBeNull();
    expect(parseAnnouncement({ ...good, port: 0 }, "10.0.0.2")).toBeNull();
    expect(parseAnnouncement(null, "10.0.0.2")).toBeNull();
    expect(parseAnnouncement([good], "10.0.0.2")).toBeNull();
  });
});
