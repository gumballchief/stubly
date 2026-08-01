import React from "react";
import { AbsoluteFill } from "remotion";
import { C, F, StubMark } from "./brand";

/** Square avatar: mark on manila, sized to survive X's circle crop. */
export const LogoStill: React.FC = () => (
  <AbsoluteFill style={{ background: C.manila, alignItems: "center", justifyContent: "center" }}>
    <StubMark size={660} />
  </AbsoluteFill>
);

/** X profile banner, 1500×500. Desk-gray field, lockup dead center. */
export const XBanner: React.FC = () => (
  <AbsoluteFill style={{ background: C.desk, alignItems: "center", justifyContent: "center" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
      <StubMark size={300} />
      <div>
        <div style={{ fontFamily: F.display, fontSize: 128, color: C.ink, letterSpacing: "0.02em", lineHeight: 1 }}>STUBLY</div>
        <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: "0.42em", color: C.inkSoft, marginTop: 12 }}>
          MACHINES THAT WORK FOR MONEY
        </div>
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        bottom: 26,
        right: 40,
        fontFamily: F.mono,
        fontSize: 19,
        letterSpacing: "0.18em",
        color: C.inkSoft,
      }}
    >
      STUBLY.ORG · LIVE ON ARC TESTNET
    </div>
    {/* perforation strip along the very bottom, like the edge of a ticket roll */}
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 10,
        backgroundImage: `radial-gradient(circle 5px at 12px 5px, ${C.usdc} 98%, transparent 100%)`,
        backgroundSize: "34px 10px",
        backgroundRepeat: "repeat-x",
        opacity: 0.55,
      }}
    />
  </AbsoluteFill>
);
