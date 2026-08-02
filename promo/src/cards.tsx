import React from "react";
import { AbsoluteFill } from "remotion";
import { C, F, StubMark } from "./brand";

/**
 * Phone-readable script cards (1080×1920). One moment per card, big type,
 * meant to be saved to a phone's photos and swiped through while recording.
 */

const Card: React.FC<{
  step: string;
  kicker: string;
  title: string;
  children: React.ReactNode;
  tone?: "do" | "say" | "warn";
}> = ({ step, kicker, title, children, tone = "do" }) => {
  const accent = tone === "say" ? C.usdc : tone === "warn" ? C.red : C.ink;
  return (
    <AbsoluteFill style={{ background: C.desk, padding: 84, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22, marginBottom: 40 }}>
        <div style={{ fontFamily: F.display, fontSize: 40, color: C.paper, background: accent, borderRadius: 14, padding: "14px 26px", lineHeight: 1 }}>
          {step}
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 26, letterSpacing: ".2em", textTransform: "uppercase", color: C.inkSoft }}>
          {kicker}
        </div>
      </div>

      <div style={{ fontFamily: F.display, fontSize: 68, color: C.ink, textTransform: "uppercase", lineHeight: 1.05, marginBottom: 44 }}>
        {title}
      </div>

      <div style={{ flex: 1 }}>{children}</div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `3px solid ${C.ink}`, paddingTop: 26 }}>
        <StubMark size={92} />
        <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: ".2em", color: C.inkSoft, textTransform: "uppercase" }}>
          Recording script
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Say: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ background: C.manila, border: `3px solid ${C.manilaEdge}`, borderLeft: `16px solid ${C.usdc}`, borderRadius: 16, padding: "36px 40px", marginBottom: 30 }}>
    <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: ".18em", textTransform: "uppercase", color: C.usdcDeep, marginBottom: 20 }}>
      Say this out loud
    </div>
    <div style={{ fontFamily: F.body, fontSize: 42, lineHeight: 1.45, color: C.ink }}>{children}</div>
  </div>
);

const Do: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ background: C.paper, border: `4px solid ${C.ink}`, borderRadius: 16, padding: "34px 38px", marginBottom: 30 }}>
    <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: ".18em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 18 }}>
      Do this
    </div>
    <div style={{ fontFamily: F.body, fontSize: 40, lineHeight: 1.5, color: C.ink }}>{children}</div>
  </div>
);

const Warn: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ background: "#FDECEA", border: `4px solid ${C.red}`, borderRadius: 16, padding: "34px 38px", marginBottom: 30 }}>
    <div style={{ fontFamily: F.body, fontSize: 40, lineHeight: 1.45, color: C.ink }}>{children}</div>
  </div>
);

export const CARD_COUNT = 12;

export const ScriptCard: React.FC<{ i?: number }> = ({ i = 0 }) => {
  switch (i) {
    case 0:
      return (
        <Card step="✓" kicker="Before you start" title="Three things first">
          <Do>1. Start the worker — the black window that says “orchestrator watching”. If it's not running, the job you buy on camera never finishes.</Do>
          <Do>2. Open two Chrome tabs: <b>stubly.org</b> and your <b>guide page</b>.</Do>
          <Do>3. Windows key + G → click the round record button. Check the microphone icon isn't crossed out.</Do>
        </Card>
      );
    case 1:
      return (
        <Card step="1" kicker="Part 1 · stubly.org" title="Open with this" tone="say">
          <Say>“Hi, I'm Yousof. This is Stubly, and it's live on Arc testnet. You hire an AI agent to do a job, your USDC sits in escrow while it works, and you either get the work or you get your money back.”</Say>
        </Card>
      );
    case 2:
      return (
        <Card step="2" kicker="Part 1 · scroll to the agents" title="Then say" tone="say">
          <Do>Scroll down slowly until you can see the green badges on the agent cards.</Do>
          <Say>“There are seventeen agents here. Every one has an on-chain identity registered in Circle's ERC-8004 registry — that's the green badge. Anyone can click it and verify the agent before they pay it.”</Say>
        </Card>
      );
    case 3:
      return (
        <Card step="3" kicker="Part 1 · start the purchase" title="Click, then say" tone="say">
          <Do>Click <b>Hire an agent</b> → pick <b>Site Audit</b> → type any website → click <b>Use PIN wallet</b>.</Do>
          <Say>“I'm paying with a Circle user-controlled wallet. It was created with a six-digit PIN — no browser extension, no seed phrase. This is the part that matters for normal people.”</Say>
        </Card>
      );
    case 4:
      return (
        <Card step="4" kicker="Part 1 · the three PINs" title="While typing your PIN" tone="say">
          <Do>Click <b>Create work order</b>. Circle asks for your PIN three times.</Do>
          <Say>“Three confirmations. One creates the work order, one approves the USDC, one funds the escrow. Circle's SDK does the signing — I never touch the user's keys.”</Say>
        </Card>
      );
    case 5:
      return (
        <Card step="5" kicker="Part 1 · the stamps land" title="When it settles" tone="say">
          <Do>Wait for FUNDED → DELIVERED → PAID OUT. If it's slow, open <b>stubly.org/job?id=163256</b> and show that one instead.</Do>
          <Say>“Funded, delivered, paid out. Every one of those stamps is a real transaction on Arc, and the money was never in my hands — it was in Circle's escrow contract the whole time.”</Say>
        </Card>
      );
    case 6:
      return (
        <Card step="6" kicker="Part 2 · the code" title="Switch tabs. That's the trick.">
          <Do>Switch to your <b>guide page</b> tab.</Do>
          <Do>The code is already printed on that page in black boxes. You don't open any files.</Do>
          <Do>Your loop, five times: scroll until a black box fills the screen → pause → read the blue box under it → scroll on.</Do>
        </Card>
      );
    case 7:
      return (
        <Card step="7" kicker="Part 2 · code box 1 & 2" title="Escrow" tone="say">
          <Say>“That address is Circle's ERC-8183 escrow contract. I did not write my own escrow — every payment goes through Circle's contract. The second one is USDC, which on Arc is also the gas token.”</Say>
          <Say>“These six calls move a job from created to settled. The evaluator either completes it — which pays the agent — or rejects it, which refunds the buyer.”</Say>
        </Card>
      );
    case 8:
      return (
        <Card step="8" kicker="Part 2 · code box 3 & 4" title="Identity & wallets" tone="say">
          <Say>“This registers each agent in Circle's ERC-8004 identity registry. It mints an identity NFT, so a buyer — or another agent — can check what they're paying for before they pay.”</Say>
          <Say>“And this is Circle Wallets. My API key stays on the server; the browser only gets a short-lived token. Circle signs the transaction after the user approves it with their PIN.”</Say>
        </Card>
      );
    case 9:
      return (
        <Card step="9" kicker="Part 2 · the big one" title="Agents hiring agents" tone="say">
          <Say>“This is the part I'm most proud of. Launch Kit doesn't do the work — it hires other agents. It opens its own escrowed work orders with two other agents, funds them out of its own fee, judges what they deliver, and pays them.”</Say>
          <Do>Then switch to the browser: <b>stubly.org/job?id=163256</b> → scroll to “Subcontracted work”.</Do>
        </Card>
      );
    case 10:
      return (
        <Card step="10" kicker="Part 3 · closing" title="Finish and stop" tone="say">
          <Say>“Right now those seventeen agents are mine. The next milestone opens it up so outside builders register their own agent and get paid out of the same escrow. After that, agents become the customers. Then mainnet on day one. Thanks for watching.”</Say>
          <Do>Stop talking. Windows + G → stop button. No outro, no music.</Do>
        </Card>
      );
    default:
      return (
        <Card step="!" kicker="Two rules" title="Don't break these" tone="warn">
          <Warn>Never open the file called <b>.env</b> on camera. Those are passwords. If you do, stop and re-record.</Warn>
          <Warn>Upload to YouTube as <b>Unlisted</b> — not Private. Private blocks the reviewers from watching it.</Warn>
          <Do>Your file is saved in <b>This PC → Videos → Captures</b>.</Do>
        </Card>
      );
  }
};
