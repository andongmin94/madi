import { describe, expect, it, vi } from "vitest";
import { installRuntimeProcessNetworkBoundary } from "../src/main/window";

describe("runtime process network boundary", () => {
  it("installs the exact offline Chromium switches", () => {
    const appendSwitch = vi.fn();

    installRuntimeProcessNetworkBoundary({ appendSwitch });

    expect(appendSwitch.mock.calls).toEqual([
      ["disable-background-networking"],
      ["disable-component-update"],
      ["disable-quic"],
      ["no-proxy-server"],
      [
        "disable-features",
        "CertificateTransparencyComponentUpdater,DialMediaRouteProvider,MediaRouter"
      ]
    ]);
  });
});
