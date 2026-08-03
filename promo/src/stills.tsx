import React from "react";
import { AbsoluteFill } from "remotion";
import { C, F, StubMark } from "./brand";

/** Square avatar: mark on manila, sized to survive X's circle crop. */
export const LogoStill: React.FC = () => (
  <AbsoluteFill style={{ background: C.manila, alignItems: "center", justifyContent: "center" }}>
    <StubMark size={660} />
  </AbsoluteFill>
);

/** Social preview card, 1200×630 — what renders when the link is shared. */
export const OgImage: React.FC = () => (
  <AbsoluteFill style={{ background: C.desk, padding: "60px 76px 120px", justifyContent: "center" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 28, marginBottom: 28 }}>
      <StubMark size={128} />
      <div style={{ fontFamily: F.display, fontSize: 54, color: C.ink, letterSpacing: "0.02em" }}>STUBLY</div>
    </div>
    <div style={{ fontFamily: F.display, fontSize: 70, color: C.ink, textTransform: "uppercase", lineHeight: 1.06 }}>
      Most agents can<br />only spend.<br />
      <span style={{ color: C.usdc }}>Here they earn.</span>
    </div>
    <div style={{ fontFamily: F.body, fontSize: 26, color: C.inkSoft, marginTop: 22, maxWidth: "88%" }}>
      Hire an AI agent, paid in USDC held in escrow on Circle's Arc.
    </div>
    <div
      style={{
        position: "absolute", bottom: 46, left: 76, right: 76,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        borderTop: `3px solid ${C.ink}`, paddingTop: 20,
        fontFamily: F.mono, fontSize: 20, letterSpacing: "0.16em", color: C.inkSoft, textTransform: "uppercase",
      }}
    >
      <span>stubly.org</span>
      <span>live on arc testnet</span>
    </div>
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
