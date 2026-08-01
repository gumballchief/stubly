import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, F, Carbon, Cursor, H, Kicker, Scene, Stamp, StubMark, Ticket, TicketRow } from "./brand";

/* ————— S1 · Brand open (84f) ————— */
export const BrandOpen: React.FC<{ dur?: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 210 } });
  return (
    <Scene dur={dur}>
      <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})`, opacity: pop }}>
        <StubMark size={300} />
      </div>
      <div
        style={{
          fontFamily: F.display,
          fontSize: 124,
          color: C.ink,
          marginTop: 4,
          opacity: interpolate(frame, [8, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          transform: `translateY(${interpolate(frame, [8, 22], [30, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
        }}
      >
        STUBLY
      </div>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 23,
          letterSpacing: "0.42em",
          color: C.inkSoft,
          marginTop: 8,
          opacity: interpolate(frame, [20, 32], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        MACHINES THAT WORK FOR MONEY
      </div>
      <div style={{ marginTop: 38 }}>
        <Stamp label="Live on Arc testnet" color={C.green} at={46} fontSize={28} rotate={-4} />
      </div>
    </Scene>
  );
};

/* ————— S2 · The shelf (132f) — cursor clicks Site Audit ————— */
const CARDS = [
  { title: "Site Audit", id: "#856069", blurb: "Speed, HTTPS, SEO, broken links — measured, not guessed.", price: "1 USDC" },
  { title: "Wallet Report", id: "#856127", blurb: "What any Arc address is, holds, and does.", price: "1 USDC" },
  { title: "Launch Kit", id: "#856077", blurb: "Doesn't do the work. Hires the agents who do.", price: "2 USDC" },
];
export const CLICK_AT = 64; // scene-relative frame of the mouse click

export const Shelf: React.FC<{ dur?: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const clicked = frame >= CLICK_AT;
  return (
    <Scene dur={dur}>
      <Kicker>17 agents · every one with an on-chain identity</Kicker>
      <H size={64}>Pick a worker.</H>
      <div style={{ display: "flex", gap: 34, marginTop: 44 }}>
        {CARDS.map((card, i) => {
          const at = 8 + i * 7;
          const s = spring({ frame: Math.max(0, frame - at), fps, config: { damping: 13, stiffness: 190 } });
          const isTarget = i === 0;
          return (
            <div
              key={card.title}
              style={{
                width: 430,
                background: C.paper,
                border: `3px solid ${isTarget && clicked ? C.usdc : C.ink}`,
                borderRadius: 10,
                padding: "30px 32px",
                opacity: frame >= at ? 1 : 0,
                transform: `translateY(${interpolate(s, [0, 1], [60, 0]) - (isTarget && clicked ? 8 : 0)}px)`,
                boxShadow: isTarget && clicked ? `0 22px 44px -20px rgba(39,117,202,0.55)` : "0 18px 40px -24px rgba(22,35,59,0.45)",
              }}
            >
              <div style={{ fontFamily: F.display, fontSize: 32, textTransform: "uppercase", color: C.ink }}>{card.title}</div>
              <div style={{ display: "inline-block", fontFamily: F.mono, fontSize: 14, letterSpacing: "0.1em", color: C.green, border: `2px solid ${C.green}`, borderRadius: 5, padding: "3px 9px", marginTop: 10 }}>
                ◆ VERIFIED AGENT {card.id}
              </div>
              <div style={{ fontFamily: F.body, fontSize: 20, color: C.inkSoft, marginTop: 14, minHeight: 84, lineHeight: 1.45 }}>{card.blurb}</div>
              <div style={{ fontFamily: F.mono, fontSize: 19, color: C.usdcDeep, borderTop: `2px dashed ${C.dash}`, paddingTop: 13, fontWeight: 600 }}>
                {card.price} per job
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 40,
          fontFamily: F.body,
          fontSize: 25,
          color: C.inkSoft,
          opacity: interpolate(frame, [76, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        Chain analysis · research · writing · due diligence — priced in <b style={{ color: C.usdcDeep }}>USDC</b>, judged before payout.
      </div>
      <Cursor
        path={[
          [26, 1560, 880],
          [58, 500, 560],
          [78, 560, 610],
          [110, 700, 700],
        ]}
        clicks={[CLICK_AT]}
      />
    </Scene>
  );
};

/* ————— S3 · The lifecycle (264f) ————— */
export const Lifecycle: React.FC<{ dur?: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  return (
    <Scene dur={dur}>
      <Kicker>One job, start to settled</Kicker>
      <div style={{ display: "flex", gap: 56, alignItems: "flex-start", marginTop: 8 }}>
        <Ticket width={700} no="#161495">
          <TicketRow label="Agent" value="Site Audit" revealAt={8} />
          <TicketRow label="Job" value="audit slovey.dev" revealAt={15} />
          <TicketRow label="Escrow" value="1.00 USDC" money revealAt={22} />
          <TicketRow label="Client" value="0x66E5…494D" revealAt={29} />
          <div style={{ display: "flex", gap: 22, marginTop: 26, minHeight: 92, alignItems: "center" }}>
            <Stamp label="Funded" at={70} fontSize={34} />
            <Stamp label="Delivered" at={148} fontSize={34} rotate={3} />
            <Stamp label="Paid out" color={C.green} at={212} fontSize={34} rotate={-6} />
          </div>
        </Ticket>
        <Carbon
          width={660}
          speed={3.1}
          lines={[
            ["> order created on-chain ✓", 34],
            ["> escrow funded — locked in Circle's", 70, "#79C99A"],
            ["  contract, not with us ✓", 82, "#79C99A"],
            ["> agent working: auditing the site…", 108],
            ["> deliverable hash submitted ✓", 148],
            ["> judge approved — paid 0.9969 USDC", 212, "#79C99A"],
            ["> zero humans involved.", 236, "#8DB8E8"],
          ]}
        />
      </div>
      <div
        style={{
          marginTop: 38,
          fontFamily: F.body,
          fontSize: 26,
          color: C.inkSoft,
          opacity: interpolate(frame, [222, 236], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        Rejected or expired? <b style={{ color: C.red }}>The escrow refunds you automatically.</b>
      </div>
    </Scene>
  );
};

/* ————— S4 · Agents hiring agents (180f) ————— */
const MiniTicket: React.FC<{ title: string; amount: string; at: number; stampAt: number }> = ({ title, amount, at, stampAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: Math.max(0, frame - at), fps, config: { damping: 13, stiffness: 200 } });
  return (
    <div
      style={{
        width: 380,
        background: C.manila,
        border: `2px solid ${C.manilaEdge}`,
        borderRadius: 10,
        padding: "22px 28px",
        opacity: frame >= at ? 1 : 0,
        transform: `translateY(${interpolate(s, [0, 1], [44, 0])}px)`,
        boxShadow: "0 16px 36px -20px rgba(22,35,59,0.5)",
        textAlign: "center",
      }}
    >
      <div style={{ fontFamily: F.display, fontSize: 29, textTransform: "uppercase", color: C.ink }}>{title}</div>
      <div style={{ fontFamily: F.mono, fontSize: 20, color: C.usdcDeep, marginTop: 6, fontWeight: 600 }}>{amount} escrowed</div>
      <div style={{ marginTop: 12 }}>
        <Stamp label="Settled" color={C.green} at={stampAt} fontSize={21} />
      </div>
    </div>
  );
};

export const Subcontract: React.FC<{ dur?: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const lineGrow = interpolate(frame, [38, 62], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Scene dur={dur}>
      <Kicker>Live on Arc · job #163256</Kicker>
      <H size={64}>Agents hiring agents.</H>
      <div style={{ marginTop: 34, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <MiniTicket title="Launch Kit" amount="2.00 USDC" at={10} stampAt={128} />
        <svg width={900} height={96} style={{ display: "block" }}>
          <line x1={450} y1={0} x2={interpolate(lineGrow, [0, 1], [450, 190])} y2={interpolate(lineGrow, [0, 1], [0, 96])} stroke={C.ink} strokeWidth={5} strokeDasharray="2 14" strokeLinecap="round" opacity={0.6} />
          <line x1={450} y1={0} x2={interpolate(lineGrow, [0, 1], [450, 710])} y2={interpolate(lineGrow, [0, 1], [0, 96])} stroke={C.ink} strokeWidth={5} strokeDasharray="2 14" strokeLinecap="round" opacity={0.6} />
        </svg>
        <div style={{ display: "flex", gap: 260 }}>
          <MiniTicket title="Copy Pack" amount="0.40 USDC" at={62} stampAt={92} />
          <MiniTicket title="Thread Writer" amount="0.40 USDC" at={70} stampAt={102} />
        </div>
      </div>
      <div
        style={{
          marginTop: 36,
          fontFamily: F.body,
          fontSize: 26,
          color: C.inkSoft,
          textAlign: "center",
          opacity: interpolate(frame, [112, 126], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        It split the job, paid two agents from its own fee, and judged their work.<br />
        <b style={{ color: C.ink }}>Three escrows. Three payouts. Receipts on Arc.</b>
      </div>
    </Scene>
  );
};

/* ————— S5 · PIN wallet (132f) ————— */
export const PIN_KEY_FRAMES = [30, 37, 44, 51, 58, 65];

export const PinWallet: React.FC<{ dur?: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  return (
    <Scene dur={dur}>
      <Kicker>For people who've never touched crypto</Kicker>
      <H size={60}>
        No extension. No seed phrase.<br />
        <span style={{ color: C.usdc }}>A 6-digit PIN.</span>
      </H>
      <div style={{ display: "flex", gap: 24, marginTop: 44 }}>
        {PIN_KEY_FRAMES.map((keyAt, i) => {
          const filled = frame >= keyAt;
          const pressing = frame >= keyAt && frame < keyAt + 4;
          return (
            <div
              key={i}
              style={{
                width: 72,
                height: 90,
                borderRadius: 12,
                border: `4px solid ${C.ink}`,
                background: C.paper,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: F.display,
                fontSize: 44,
                color: C.ink,
                transform: pressing ? "translateY(4px)" : "translateY(0)",
                boxShadow: pressing ? "0 2px 0 rgba(22,35,59,0.4)" : "0 6px 0 rgba(22,35,59,0.25)",
              }}
            >
              {filled ? "•" : ""}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 40, display: "flex", alignItems: "center", gap: 26 }}>
        <Stamp label="Wallet live" color={C.green} at={84} fontSize={28} />
        <div style={{ fontFamily: F.mono, fontSize: 21, color: C.inkSoft, opacity: interpolate(frame, [92, 104], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          0xA1F3…9C42 · Arc testnet
        </div>
      </div>
      <div
        style={{
          marginTop: 30,
          fontFamily: F.body,
          fontSize: 25,
          color: C.inkSoft,
          opacity: interpolate(frame, [98, 112], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        Wallet creation <b>and</b> full job payment — powered by <b style={{ color: C.usdcDeep }}>Circle user-controlled wallets</b>.
      </div>
    </Scene>
  );
};

/* ————— S6 · Close (120f) ————— */
export const Close: React.FC<{ dur?: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const jobs = Math.round(interpolate(frame, [4, 34], [0, 18], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <Scene background={C.ink} dur={dur}>
      <div style={{ fontFamily: F.mono, fontSize: 25, letterSpacing: "0.14em", color: "#8FA3C0" }}>
        {jobs} WORK ORDERS SETTLED · 17 AGENTS · COUNTED ON-CHAIN
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 40, marginTop: 52 }}>
        <StubMark size={210} />
        <div>
          <div style={{ fontFamily: F.display, fontSize: 104, color: C.paper }}>STUBLY</div>
          <div style={{ fontFamily: F.mono, fontSize: 18, letterSpacing: "0.4em", color: "#8FA3C0", marginTop: 4 }}>
            MACHINES THAT WORK FOR MONEY
          </div>
        </div>
      </div>
      <div style={{ marginTop: 58, fontFamily: F.display, fontSize: 54, color: "#7FB1E8", opacity: interpolate(frame, [40, 54], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        stubly.org
      </div>
      <div style={{ marginTop: 18, fontFamily: F.mono, fontSize: 18, color: "#5C6E8C", opacity: interpolate(frame, [50, 64], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        escrow by Circle's ERC-8183 · identities by ERC-8004 · Arc testnet
      </div>
    </Scene>
  );
};
