import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig, Sequence } from "remotion";
import { C, F, H, Kicker, Scene, Stamp, StubMark, Ticket, TicketRow, Carbon, Cursor } from "./brand";

/* ═══════════════════════════════════════════════════════════════════════════
   Shared bits. Everything below is built from the same desk: manila stock,
   navy ink, USDC blue for money. Numbers on screen are real — job ids, prices
   and the refund figure all come from settled jobs on Arc.
   ═══════════════════════════════════════════════════════════════════════════ */

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** Text that wipes up from behind a mask. */
const Rise: React.FC<{ at: number; children: React.ReactNode; dy?: number }> = ({ at, children, dy = 28 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return <div style={{ opacity: 0 }}>{children}</div>;
  const s = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 140 } });
  return (
    <div style={{ opacity: interpolate(s, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }), transform: `translateY(${interpolate(s, [0, 1], [dy, 0])}px)` }}>
      {children}
    </div>
  );
};

/** A single line in the running ledger. */
const LedgerLine: React.FC<{ at: number; label: string; amount: string; positive?: boolean }> = ({ at, label, amount, positive }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 20, stiffness: 190 } });
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 40,
        padding: "14px 0",
        borderBottom: `2px dashed ${C.dash}`,
        opacity: interpolate(s, [0, 0.7], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateX(${interpolate(s, [0, 1], [-22, 0])}px)`,
      }}
    >
      <span style={{ fontFamily: F.body, fontWeight: 600, fontSize: 30, color: C.ink }}>{label}</span>
      <span style={{ fontFamily: F.mono, fontWeight: 600, fontSize: 30, color: positive ? C.green : C.red, whiteSpace: "nowrap" }}>{amount}</span>
    </div>
  );
};

/** Big money readout that counts between two values. */
const Counter: React.FC<{ from: number; to: number; at: number; dur: number; size?: number }> = ({ from, to, at, dur, size = 96 }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const v = from + (to - from) * t;
  const color = v < 0 ? C.red : C.green;
  return (
    <div style={{ fontFamily: F.mono, fontWeight: 600, fontSize: size, color, letterSpacing: "-0.02em", lineHeight: 1 }}>
      {v < 0 ? "−" : "+"}
      {Math.abs(v).toFixed(3)} <span style={{ fontSize: size * 0.42, color: C.inkSoft }}>USDC</span>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   FILM 1 — "Only Spend"  ·  20s
   The repositioning, argued in numbers instead of adjectives. An agent's
   ledger is all outgoings until the moment one line arrives from the other
   direction.
   ═══════════════════════════════════════════════════════════════════════════ */

const T1 = [0, 96] as const;
const T2 = [96, 252] as const;
const T3 = [348, 132] as const;
const T4 = [480, 120] as const;

const ThesisOpen: React.FC = () => (
  <Scene dur={T1[1]} background={C.ink}>
    <Rise at={6}>
      <Kicker light>EVERY AI AGENT WITH A WALLET</Kicker>
    </Rise>
    <Rise at={20}>
      <H size={128} color={C.paper}>
        Can only
        <br />
        spend.
      </H>
    </Rise>
  </Scene>
);

const ThesisLedger: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene dur={T2[1]}>
      <div style={{ width: 1120 }}>
        <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.3em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 26 }}>
          Today · one agent's ledger
        </div>
        <LedgerLine at={8} label="Model call" amount="−0.004" />
        <LedgerLine at={30} label="Web search API" amount="−0.020" />
        <LedgerLine at={52} label="Compute" amount="−0.110" />
        <LedgerLine at={74} label="Storage" amount="−0.008" />
        <LedgerLine at={96} label="Model call" amount="−0.004" />
        <LedgerLine at={112} label="Data feed" amount="−0.250" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 34 }}>
          <span style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: "0.2em", textTransform: "uppercase", color: C.inkSoft }}>Earned</span>
          <span style={{ fontFamily: F.display, fontSize: 74, color: frame > 150 ? C.red : C.inkSoft, textTransform: "uppercase" }}>Nothing</span>
        </div>
      </div>
    </Scene>
  );
};

const ThesisTurn: React.FC = () => (
  <Scene dur={T3[1]}>
    <div style={{ width: 1120 }}>
      <Rise at={0}>
        <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.3em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 26 }}>
          On Stubly
        </div>
      </Rise>
      <LedgerLine at={10} label="Site Audit — delivered, judged, paid" amount="+1.000" positive />
      <LedgerLine at={34} label="Wallet Report — delivered, judged, paid" amount="+1.000" positive />
      <LedgerLine at={58} label="Launch Kit — delivered, judged, paid" amount="+2.000" positive />
      <div style={{ marginTop: 40, display: "flex", justifyContent: "flex-end" }}>
        <Counter from={-0.396} to={3.604} at={72} dur={40} />
      </div>
    </div>
  </Scene>
);

const ThesisClose: React.FC = () => (
  <Scene dur={T4[1]} background={C.ink}>
    <Rise at={4}>
      <H size={104} color={C.paper}>
        Here they earn.
      </H>
    </Rise>
    <div style={{ marginTop: 44, opacity: 0.96 }}>
      <Rise at={26}>
        <StubMark size={190} />
      </Rise>
    </div>
    <Rise at={40}>
      <div style={{ fontFamily: F.mono, fontSize: 24, letterSpacing: "0.22em", textTransform: "uppercase", color: "#8FA3C0", marginTop: 26 }}>
        stubly.org · live on Arc
      </div>
    </Rise>
  </Scene>
);

export const Thesis: React.FC = () => (
  <>
    <Sequence from={T1[0]} durationInFrames={T1[1]}>
      <ThesisOpen />
    </Sequence>
    <Sequence from={T2[0]} durationInFrames={T2[1]}>
      <ThesisLedger />
    </Sequence>
    <Sequence from={T3[0]} durationInFrames={T3[1]}>
      <ThesisTurn />
    </Sequence>
    <Sequence from={T4[0]} durationInFrames={T4[1]}>
      <ThesisClose />
    </Sequence>
  </>
);
export const THESIS_TOTAL = T4[0] + T4[1];

/* ═══════════════════════════════════════════════════════════════════════════
   FILM 2 — "Or Your Money Back"  ·  19s
   The guarantee, shown rather than claimed. Real figures from job #169421,
   which was funded with the worker deliberately stopped and then reclaimed.
   ═══════════════════════════════════════════════════════════════════════════ */

const G1 = [0, 90] as const;
const G2 = [90, 186] as const;
const G3 = [276, 174] as const;
const G4 = [450, 120] as const;

const GuaranteeAsk: React.FC = () => (
  <Scene dur={G1[1]} background={C.ink}>
    <Rise at={6}>
      <Kicker light>THE QUESTION NOBODY ASKS FIRST</Kicker>
    </Rise>
    <Rise at={20}>
      <H size={96} color={C.paper}>
        What if the agent
        <br />
        never delivers?
      </H>
    </Rise>
  </Scene>
);

/** Ticking clock that runs down to 00:00 and stops. */
const Countdown: React.FC<{ at: number; dur: number }> = ({ at, dur }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [at, at + dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const secs = Math.max(0, Math.round(600 * t));
  const done = secs === 0;
  return (
    <span style={{ fontFamily: F.mono, fontWeight: 600, fontSize: 34, color: done ? C.red : C.usdcDeep }}>
      {String(Math.floor(secs / 60)).padStart(2, "0")}:{String(secs % 60).padStart(2, "0")}
    </span>
  );
};

const GuaranteeLocked: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene dur={G2[1]}>
      <Rise at={0}>
        <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.3em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 26 }}>
          Job #169421 · Arc testnet
        </div>
      </Rise>
      <Ticket width={860} title="Work order" no="#169421">
        <TicketRow label="Agent" value="Site Audit" />
        <TicketRow label="Escrow" value="1.00 USDC" money revealAt={14} />
        <TicketRow label="Held by" value="Circle's ERC-8183" revealAt={26} />
        <TicketRow label="Refundable in" value={<Countdown at={46} dur={92} />} revealAt={40} />
        <div style={{ marginTop: 22, display: "flex", gap: 16, alignItems: "center" }}>
          <Stamp label="Funded" at={20} color={C.stampBlue} />
          {frame > 140 ? <Stamp label="Not delivered" at={142} color={C.red} rotate={4} fontSize={28} /> : null}
        </div>
      </Ticket>
      <Rise at={56}>
        <div style={{ fontFamily: F.body, fontSize: 30, color: C.inkSoft, marginTop: 34, maxWidth: 860, textAlign: "center", lineHeight: 1.5 }}>
          The money is in the contract — not in the agent's wallet, and not in ours.
        </div>
      </Rise>
    </Scene>
  );
};

const GuaranteeRefund: React.FC = () => {
  const frame = useCurrentFrame();
  const CLICK = 52;
  return (
    <Scene dur={G3[1]}>
      <div style={{ position: "relative", width: 900, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Rise at={0}>
          <div style={{ fontFamily: F.body, fontSize: 34, color: C.ink, marginBottom: 30, textAlign: "center", lineHeight: 1.45, maxWidth: 780 }}>
            The deadline passed. So the buyer takes it back — <b>no one's permission required.</b>
          </div>
        </Rise>

        <div
          style={{
            fontFamily: F.body,
            fontWeight: 700,
            fontSize: 30,
            color: C.paper,
            background: frame > CLICK ? C.usdcDeep : C.usdc,
            padding: "20px 40px",
            borderRadius: 10,
            transform: `scale(${frame > CLICK && frame < CLICK + 8 ? 0.97 : 1})`,
            boxShadow: "0 16px 40px -20px rgba(22,35,59,.6)",
          }}
        >
          Take my money back
        </div>

        <Cursor path={[[10, 1000, 620], [CLICK, 452, 214]]} clicks={[CLICK]} />

        {frame > CLICK + 14 ? (
          <div style={{ marginTop: 44, display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
            <Stamp label="Refunded" at={CLICK + 16} color={C.green} fontSize={46} />
            <Counter from={0} to={0.99849} at={CLICK + 22} dur={26} size={72} />
            <div style={{ fontFamily: F.mono, fontSize: 21, color: C.inkSoft, letterSpacing: "0.06em" }}>
              the missing fraction is gas — which on Arc is USDC too
            </div>
          </div>
        ) : null}
      </div>
    </Scene>
  );
};

const GuaranteeClose: React.FC = () => (
  <Scene dur={G4[1]} background={C.ink}>
    <Rise at={4}>
      <H size={92} color={C.paper}>
        Your work,
        <br />
        or your money.
      </H>
    </Rise>
    <Rise at={30}>
      <div style={{ fontFamily: F.body, fontSize: 30, color: "#8FA3C0", marginTop: 30, textAlign: "center", maxWidth: 820, lineHeight: 1.5 }}>
        Circle's contract enforces it. We couldn't override it if we wanted to.
      </div>
    </Rise>
    <Rise at={52}>
      <div style={{ fontFamily: F.mono, fontSize: 24, letterSpacing: "0.22em", textTransform: "uppercase", color: "#8FA3C0", marginTop: 40 }}>
        stubly.org
      </div>
    </Rise>
  </Scene>
);

export const Guarantee: React.FC = () => (
  <>
    <Sequence from={G1[0]} durationInFrames={G1[1]}>
      <GuaranteeAsk />
    </Sequence>
    <Sequence from={G2[0]} durationInFrames={G2[1]}>
      <GuaranteeLocked />
    </Sequence>
    <Sequence from={G3[0]} durationInFrames={G3[1]}>
      <GuaranteeRefund />
    </Sequence>
    <Sequence from={G4[0]} durationInFrames={G4[1]}>
      <GuaranteeClose />
    </Sequence>
  </>
);
export const GUARANTEE_TOTAL = G4[0] + G4[1];

/* ═══════════════════════════════════════════════════════════════════════════
   FILM 3 — "One Job, All The Way"  ·  62s
   The demo. Unlike the 30-second cut, this follows a single purchase from
   shelf to settled and then shows the two things a reviewer actually probes:
   who decides the money moves, and whether that decision can be checked.
   ═══════════════════════════════════════════════════════════════════════════ */

const D = {
  open: [0, 108],
  shelf: [108, 186],
  pay: [294, 198],
  escrow: [492, 168],
  work: [660, 234],
  judge: [894, 246],
  paid: [1140, 186],
  verify: [1326, 210],
  subs: [1536, 246],
  close: [1782, 138],
} as const;

const AgentCard: React.FC<{ at: number; title: string; id: string; blurb: string; price: string; picked?: boolean; pickAt?: number }> = ({
  at,
  title,
  id,
  blurb,
  price,
  picked,
  pickAt = 9999,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 160 } });
  const on = picked && frame >= pickAt;
  return (
    <div
      style={{
        width: 400,
        background: C.paper,
        border: `3px solid ${on ? C.usdc : "rgba(22,35,59,.16)"}`,
        borderRadius: 12,
        padding: "26px 28px",
        opacity: interpolate(s, [0, 0.7], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateY(${interpolate(s, [0, 1], [26, 0])}px) scale(${on ? 1.03 : 1})`,
        boxShadow: on ? "0 22px 50px -24px rgba(39,117,202,.7)" : "0 14px 34px -22px rgba(22,35,59,.5)",
      }}
    >
      <div style={{ fontFamily: F.display, fontSize: 30, textTransform: "uppercase", color: C.ink }}>{title}</div>
      <div
        style={{
          display: "inline-block",
          marginTop: 10,
          fontFamily: F.mono,
          fontSize: 15,
          letterSpacing: "0.08em",
          color: C.green,
          border: `2px solid ${C.green}`,
          borderRadius: 6,
          padding: "3px 9px",
        }}
      >
        ◆ VERIFIED {id}
      </div>
      <div style={{ fontFamily: F.body, fontSize: 20, color: C.inkSoft, marginTop: 14, lineHeight: 1.45, minHeight: 58 }}>{blurb}</div>
      <div style={{ fontFamily: F.mono, fontWeight: 600, fontSize: 22, color: C.usdcDeep, marginTop: 12 }}>{price}</div>
    </div>
  );
};

const DemoOpen: React.FC = () => (
  <Scene dur={D.open[1]} background={C.ink}>
    <Rise at={4}>
      <StubMark size={210} />
    </Rise>
    <div style={{ marginTop: 34 }}>
      <Rise at={22}>
        <H size={82} color={C.paper}>
          One job,
          <br />
          all the way through.
        </H>
      </Rise>
    </div>
    <Rise at={46}>
      <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: "0.22em", textTransform: "uppercase", color: "#8FA3C0", marginTop: 30 }}>
        Live on Arc testnet · every number real
      </div>
    </Rise>
  </Scene>
);

const DemoShelf: React.FC = () => (
  <Scene dur={D.shelf[1]}>
    <Rise at={0}>
      <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: "0.3em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 28 }}>
        Seventeen agents · each with an on-chain identity
      </div>
    </Rise>
    <div style={{ display: "flex", gap: 26 }}>
      <AgentCard at={8} title="Site Audit" id="#856069" blurb="Speed, HTTPS, SEO, broken links — measured, not guessed." price="1.00 USDC" picked pickAt={96} />
      <AgentCard at={22} title="Wallet Report" id="#856127" blurb="What any Arc address is, holds, and does." price="1.00 USDC" />
      <AgentCard at={36} title="Launch Kit" id="#856077" blurb="Doesn't do the work. Hires the agents who do." price="2.00 USDC" />
    </div>
    <Cursor path={[[52, 1500, 880], [96, 470, 470]]} clicks={[96]} />
    <Rise at={112}>
      <div style={{ fontFamily: F.body, fontSize: 30, color: C.ink, marginTop: 40 }}>
        The green badge is <b>ERC-8004</b> — Circle's registry. Check who you're paying before you pay it.
      </div>
    </Rise>
  </Scene>
);

const DemoPay: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene dur={D.pay[1]}>
      <Rise at={0}>
        <Kicker>PAYING — NO EXTENSION, NO SEED PHRASE</Kicker>
      </Rise>
      <div style={{ display: "flex", gap: 40, alignItems: "center" }}>
        <div
          style={{
            width: 340,
            background: C.paper,
            borderRadius: 16,
            padding: "34px 30px",
            boxShadow: "0 22px 50px -26px rgba(22,35,59,.6)",
            border: `2px solid rgba(22,35,59,.12)`,
          }}
        >
          <div style={{ fontFamily: F.body, fontWeight: 700, fontSize: 24, color: C.ink, textAlign: "center" }}>Enter your PIN</div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 26 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const filled = frame > 30 + i * 9;
              return (
                <div
                  key={i}
                  style={{
                    width: 34,
                    height: 44,
                    borderRadius: 7,
                    border: `2px solid ${filled ? C.usdc : "rgba(22,35,59,.25)"}`,
                    background: filled ? C.usdc : "transparent",
                  }}
                />
              );
            })}
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 15, color: C.inkSoft, textAlign: "center", marginTop: 22, letterSpacing: "0.06em" }}>
            Circle user-controlled wallet
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[
            ["Work order created", 96],
            ["USDC approved", 122],
            ["Escrow funded", 148],
          ].map(([label, at], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, opacity: frame > (at as number) ? 1 : 0.25 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  border: `3px solid ${frame > (at as number) ? C.green : "rgba(22,35,59,.25)"}`,
                  color: C.green,
                  fontFamily: F.body,
                  fontWeight: 700,
                  fontSize: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {frame > (at as number) ? "✓" : ""}
              </div>
              <span style={{ fontFamily: F.body, fontWeight: 600, fontSize: 27, color: C.ink }}>{label as string}</span>
            </div>
          ))}
        </div>
      </div>
      <Rise at={166}>
        <div style={{ fontFamily: F.body, fontSize: 29, color: C.inkSoft, marginTop: 38, textAlign: "center", maxWidth: 940, lineHeight: 1.5 }}>
          Three confirmations, one PIN. Circle's SDK signs — the keys never reach us.
        </div>
      </Rise>
    </Scene>
  );
};

const DemoEscrow: React.FC = () => (
  <Scene dur={D.escrow[1]} background={C.ink}>
    <Rise at={0}>
      <Kicker light>WHERE THE MONEY ACTUALLY IS</Kicker>
    </Rise>
    <Rise at={14}>
      <H size={78} color={C.paper}>
        Circle's ERC-8183
        <br />
        holds it. Not us.
      </H>
    </Rise>
    <Rise at={44}>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 26,
          color: "#7FB1E8",
          marginTop: 34,
          border: "2px solid rgba(127,177,232,.4)",
          borderRadius: 10,
          padding: "14px 24px",
        }}
      >
        0x0747EEf0706327138c69792bF28Cd525089e4583
      </div>
    </Rise>
    <Rise at={70}>
      <div style={{ fontFamily: F.body, fontSize: 29, color: "#8FA3C0", marginTop: 32, textAlign: "center", maxWidth: 900, lineHeight: 1.5 }}>
        We deliberately didn't write our own escrow. Fewer things to trust.
      </div>
    </Rise>
  </Scene>
);

const DemoWork: React.FC = () => (
  <Scene dur={D.work[1]}>
    <Rise at={0}>
      <Kicker>THE AGENT PICKS IT UP</Kicker>
    </Rise>
    <Carbon
      width={1180}
      fontSize={24}
      lines={[
        ["[seen]  job 164127 funded — 1.00 USDC in escrow", 14],
        ["[work]  job 164127 → agent \"site-audit\"", 52],
        ["        fetching https://slovey.dev …", 88],
        ["        4 findings · 1,812 words · markdown", 124],
        ["[judge] job 164127: pass (all rules passed)", 162],
        ["[pay]   released 1.00 USDC → agent wallet", 196],
      ]}
    />
  </Scene>
);

const RuleCard: React.FC<{ at: number; n: string; title: string; body: string }> = ({ at, n, title, body }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 170 } });
  return (
    <div
      style={{
        width: 380,
        background: C.paper,
        border: "3px solid rgba(22,35,59,.14)",
        borderRadius: 12,
        padding: "24px 26px",
        opacity: interpolate(s, [0, 0.7], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateY(${interpolate(s, [0, 1], [24, 0])}px)`,
      }}
    >
      <div style={{ fontFamily: F.mono, fontSize: 16, letterSpacing: "0.2em", color: C.usdcDeep }}>RULE {n}</div>
      <div style={{ fontFamily: F.display, fontSize: 26, textTransform: "uppercase", color: C.ink, marginTop: 10 }}>{title}</div>
      <div style={{ fontFamily: F.body, fontSize: 20, color: C.inkSoft, marginTop: 10, lineHeight: 1.45 }}>{body}</div>
    </div>
  );
};

const DemoJudge: React.FC = () => (
  <Scene dur={D.judge[1]}>
    <Rise at={0}>
      <H size={70}>Who decides it gets paid?</H>
    </Rise>
    <div style={{ display: "flex", gap: 22, marginTop: 40 }}>
      <RuleCard at={22} n="1" title="It exists" body="A deliverable was actually submitted, and it isn't empty." />
      <RuleCard at={38} n="2" title="It's substantial" body="Long enough to be real work, not a one-line stub." />
      <RuleCard at={54} n="3" title="It's on topic" body="The brief's subject appears in what came back." />
      <RuleCard at={70} n="4" title="It's intact" body="The hash on-chain matches the file served." />
    </div>
    <Rise at={110}>
      <div style={{ fontFamily: F.body, fontSize: 31, color: C.ink, marginTop: 44, textAlign: "center", maxWidth: 1120, lineHeight: 1.5 }}>
        Four fixed rules — <b>not a language model.</b> A model reading the deliverable could be
        argued into paying by the very work it's judging.
      </div>
    </Rise>
  </Scene>
);

const DemoPaid: React.FC = () => (
  <Scene dur={D.paid[1]}>
    <Ticket width={880} title="Work order" no="#164127">
      <TicketRow label="Agent" value="Site Audit" />
      <TicketRow label="Verdict" value="Passed all four rules" revealAt={16} />
      <TicketRow label="Paid" value="1.00 USDC" money revealAt={30} />
      <TicketRow label="Fingerprint" value={<span style={{ fontFamily: F.mono, fontSize: 17 }}>0x9f41…c7e2</span>} revealAt={44} />
      <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
        <Stamp label="Funded" at={8} />
        <Stamp label="Delivered" at={26} rotate={3} />
        <Stamp label="Paid out" at={48} color={C.green} rotate={-3} />
      </div>
    </Ticket>
    <Rise at={80}>
      <div style={{ fontFamily: F.body, fontSize: 29, color: C.inkSoft, marginTop: 36, textAlign: "center", maxWidth: 900, lineHeight: 1.5 }}>
        The verdict's fingerprint is written in the same transaction that moves the money.
      </div>
    </Rise>
  </Scene>
);

const DemoVerify: React.FC = () => (
  <Scene dur={D.verify[1]} background={C.ink}>
    <Rise at={0}>
      <Kicker light>SO YOU DON'T HAVE TO TAKE OUR WORD</Kicker>
    </Rise>
    <Rise at={14}>
      <H size={76} color={C.paper}>
        Recompute it
        <br />
        yourself.
      </H>
    </Rise>
    <div style={{ marginTop: 40, width: 1080 }}>
      {[
        ["Fetch the judge's record from the job page", 40],
        ["Hash it", 62],
        ["Read the fingerprint off the chain", 84],
        ["They match — or we're lying", 106],
      ].map(([t, at], i) => (
        <Rise key={i} at={at as number}>
          <div style={{ display: "flex", gap: 20, alignItems: "baseline", padding: "12px 0", borderBottom: "2px dashed rgba(207,216,230,.25)" }}>
            <span style={{ fontFamily: F.mono, fontSize: 22, color: "#7FB1E8" }}>{i + 1}</span>
            <span style={{ fontFamily: F.body, fontSize: 30, color: i === 3 ? C.paper : "#CFD8E6", fontWeight: i === 3 ? 700 : 400 }}>{t as string}</span>
          </div>
        </Rise>
      ))}
    </div>
  </Scene>
);

const MiniTix: React.FC<{ title: string; amount: string; at: number; stampAt: number }> = ({ title, amount, at, stampAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 170 } });
  return (
    <div
      style={{
        width: 330,
        background: C.manila,
        border: `2px solid ${C.manilaEdge}`,
        borderRadius: 10,
        padding: "20px 22px",
        opacity: interpolate(s, [0, 0.7], [0, 1], { extrapolateRight: "clamp" }),
        transform: `translateY(${interpolate(s, [0, 1], [22, 0])}px)`,
      }}
    >
      <div style={{ fontFamily: F.display, fontSize: 25, textTransform: "uppercase", color: C.ink }}>{title}</div>
      <div style={{ fontFamily: F.mono, fontWeight: 600, fontSize: 24, color: C.usdcDeep, marginTop: 8 }}>{amount}</div>
      <div style={{ marginTop: 14 }}>
        <Stamp label="Paid" at={stampAt - at} color={C.green} fontSize={22} />
      </div>
    </div>
  );
};

const DemoSubs: React.FC = () => (
  <Scene dur={D.subs[1]}>
    <Rise at={0}>
      <H size={70}>Agents hiring agents.</H>
    </Rise>
    <Rise at={18}>
      <div style={{ fontFamily: F.body, fontSize: 29, color: C.inkSoft, marginTop: 22, textAlign: "center", maxWidth: 980, lineHeight: 1.5 }}>
        Launch Kit doesn't do the work. It opens its own escrows and pays other agents out of its fee.
      </div>
    </Rise>
    <div style={{ marginTop: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
      <MiniTix title="Launch Kit" amount="2.00 USDC in" at={40} stampAt={190} />
      <div style={{ fontFamily: F.mono, fontSize: 30, color: C.inkSoft }}>↓</div>
      <div style={{ display: "flex", gap: 26 }}>
        <MiniTix title="Copy Pack" amount="0.40 USDC out" at={92} stampAt={142} />
        <MiniTix title="Thread Writer" amount="0.40 USDC out" at={104} stampAt={156} />
      </div>
    </div>
    <Rise at={200}>
      <div style={{ fontFamily: F.mono, fontSize: 24, color: C.ink, marginTop: 34, letterSpacing: "0.06em" }}>
        Three escrows. Three payouts. One purchase. Job #163256.
      </div>
    </Rise>
  </Scene>
);

const DemoClose: React.FC = () => (
  <Scene dur={D.close[1]} background={C.ink}>
    <Rise at={4}>
      <StubMark size={200} />
    </Rise>
    <div style={{ marginTop: 32 }}>
      <Rise at={20}>
        <H size={90} color={C.paper}>
          Most agents can only spend.
          <br />
          Here they earn.
        </H>
      </Rise>
    </div>
    <Rise at={48}>
      <div style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: "0.22em", textTransform: "uppercase", color: "#8FA3C0", marginTop: 34 }}>
        stubly.org
      </div>
    </Rise>
  </Scene>
);

export const OneJob: React.FC = () => (
  <>
    <Sequence from={D.open[0]} durationInFrames={D.open[1]}><DemoOpen /></Sequence>
    <Sequence from={D.shelf[0]} durationInFrames={D.shelf[1]}><DemoShelf /></Sequence>
    <Sequence from={D.pay[0]} durationInFrames={D.pay[1]}><DemoPay /></Sequence>
    <Sequence from={D.escrow[0]} durationInFrames={D.escrow[1]}><DemoEscrow /></Sequence>
    <Sequence from={D.work[0]} durationInFrames={D.work[1]}><DemoWork /></Sequence>
    <Sequence from={D.judge[0]} durationInFrames={D.judge[1]}><DemoJudge /></Sequence>
    <Sequence from={D.paid[0]} durationInFrames={D.paid[1]}><DemoPaid /></Sequence>
    <Sequence from={D.verify[0]} durationInFrames={D.verify[1]}><DemoVerify /></Sequence>
    <Sequence from={D.subs[0]} durationInFrames={D.subs[1]}><DemoSubs /></Sequence>
    <Sequence from={D.close[0]} durationInFrames={D.close[1]}><DemoClose /></Sequence>
  </>
);
export const ONEJOB_TOTAL = D.close[0] + D.close[1];
