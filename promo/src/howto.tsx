import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, F, Scene, Stamp, StubMark } from "./brand";

/* ————— shared bits ————— */

const StepBadge: React.FC<{ n: string; label: string }> = ({ n, label }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 18 }}>
    <div
      style={{
        fontFamily: F.display,
        fontSize: 30,
        color: C.paper,
        background: C.usdc,
        borderRadius: 10,
        padding: "10px 20px",
        lineHeight: 1,
      }}
    >
      {n}
    </div>
    <div style={{ fontFamily: F.mono, fontSize: 19, letterSpacing: ".24em", textTransform: "uppercase", color: C.inkSoft }}>
      {label}
    </div>
  </div>
);

const Line: React.FC<{ children: React.ReactNode; at: number; size?: number; strong?: boolean }> = ({
  children,
  at,
  size = 30,
  strong,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: Math.max(0, frame - at), fps, config: { damping: 15, stiffness: 170 } });
  if (frame < at) return null;
  return (
    <div
      style={{
        fontFamily: F.body,
        fontSize: size,
        fontWeight: strong ? 700 : 400,
        color: strong ? C.ink : C.inkSoft,
        lineHeight: 1.45,
        marginBottom: 14,
        opacity: s,
        transform: `translateX(${interpolate(s, [0, 1], [-24, 0])}px)`,
        maxWidth: "94%",
      }}
    >
      {children}
    </div>
  );
};

/** A dark terminal/command box. */
const Cmd: React.FC<{ text: string; at: number; label?: string }> = ({ text, at, label }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const shown = Math.min(text.length, Math.floor((frame - at) * 2.4));
  return (
    <div style={{ marginTop: 10 }}>
      {label ? (
        <div style={{ fontFamily: F.mono, fontSize: 15, letterSpacing: ".18em", color: C.inkSoft, marginBottom: 8, textTransform: "uppercase" }}>
          {label}
        </div>
      ) : null}
      <div
        style={{
          background: C.ink,
          color: "#8FE3B0",
          fontFamily: F.mono,
          fontSize: 21,
          padding: "22px 26px",
          borderRadius: 10,
          lineHeight: 1.5,
          wordBreak: "break-all",
          boxShadow: "0 16px 40px -24px rgba(22,35,59,.6)",
        }}
      >
        {text.slice(0, shown)}
        {shown < text.length ? <span style={{ opacity: 0.8 }}>▌</span> : null}
      </div>
    </div>
  );
};

/** A key on a keyboard, for Ctrl+P style instructions. */
const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      display: "inline-block",
      fontFamily: F.mono,
      fontSize: 24,
      fontWeight: 600,
      color: C.ink,
      background: C.paper,
      border: `3px solid ${C.ink}`,
      borderRadius: 8,
      padding: "6px 16px",
      margin: "0 6px",
      boxShadow: `0 4px 0 ${C.ink}`,
    }}
  >
    {children}
  </span>
);

/* ————— S1 · what's left (0–120) ————— */
export const Intro: React.FC<{ dur?: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 13, stiffness: 200 } });
  return (
    <Scene dur={dur}>
      <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.7, 1])})`, opacity: pop }}>
        <StubMark size={180} />
      </div>
      <div style={{ fontFamily: F.display, fontSize: 68, color: C.ink, textTransform: "uppercase", marginTop: 26, textAlign: "center" }}>
        Everything is built.
      </div>
      <div style={{ fontFamily: F.body, fontSize: 34, color: C.inkSoft, marginTop: 20, textAlign: "center", maxWidth: "70%" }}>
        The grant form is filled in and saved as a draft.
        <br />
        <b style={{ color: C.ink }}>Four things left, and they're all yours.</b>
      </div>
      <div style={{ marginTop: 40 }}>
        <Stamp label="About 1 hour total" color={C.green} at={62} fontSize={28} rotate={-4} />
      </div>
    </Scene>
  );
};

/* ————— S2 · step 1, GitHub (120–330) ————— */
export const StepGithub: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <div style={{ width: "82%" }}>
      <StepBadge n="01" label="Two minutes" />
      <div style={{ fontFamily: F.display, fontSize: 52, color: C.ink, textTransform: "uppercase", marginBottom: 24 }}>
        Put the code on GitHub
      </div>
      <Line at={14}>The form points at a repo that doesn't exist yet. I already wrote the README and checked that no keys are in it.</Line>
      <Line at={40} strong>Open a terminal and paste this one line:</Line>
      <Cmd
        at={56}
        text={'cd "C:\\Users\\youso\\Claude Code\\agent-market" && gh repo create stubly --public --source=. --remote=origin --push'}
      />
      <Line at={140} size={26}>That's it. It creates github.com/gumballchief/stubly and uploads everything.</Line>
    </div>
  </Scene>
);

/* ————— S3 · step 2, the deck (330–540) ————— */
export const StepDeck: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <div style={{ width: "82%" }}>
      <StepBadge n="02" label="Three minutes" />
      <div style={{ fontFamily: F.display, fontSize: 52, color: C.ink, textTransform: "uppercase", marginBottom: 24 }}>
        Turn the deck into a PDF
      </div>
      <Line at={14}>I built you a 9-slide deck. It's a web page — Chrome turns it into a PDF for you.</Line>
      <Line at={40} strong>Open this file in Chrome:</Line>
      <Cmd at={54} text={"agent-market\\launch\\deck.html"} />
      <Line at={110} strong>
        Then press <Key>Ctrl</Key> + <Key>P</Key>
      </Line>
      <Line at={132} size={26}>Destination: <b style={{ color: C.ink }}>Save as PDF</b> · Margins: <b style={{ color: C.ink }}>None</b> · Background graphics: <b style={{ color: C.ink }}>ON</b></Line>
      <Line at={158} size={26}>Upload it to Google Drive, set sharing to "anyone with the link", copy that link.</Line>
    </div>
  </Scene>
);

/* ————— S4 · step 3, the video (540–840) ————— */
export const StepVideo: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <div style={{ width: "84%" }}>
      <StepBadge n="03" label="The big one · 45 minutes" />
      <div style={{ fontFamily: F.display, fontSize: 52, color: C.ink, textTransform: "uppercase", marginBottom: 22 }}>
        Record your screen, talking
      </div>
      <Line at={12}>Circle requires it: <b style={{ color: C.ink }}>under 5 minutes</b>, showing your real code and the product working. The promo video does <b style={{ color: C.ink }}>not</b> count.</Line>
      <Line at={44} strong>Press Windows + G to start recording. Then, in order:</Line>
      <Line at={66} size={26}>→ 90 seconds on stubly.org — buy a job with the PIN wallet, let it settle</Line>
      <Line at={88} size={26}>→ 2½ minutes opening 4 files and saying what each does:</Line>
      <div style={{ marginLeft: 34 }}>
        <Line at={104} size={24}><code style={{ fontFamily: F.mono, color: C.usdc }}>chain/jobs.js</code> — "this is Circle's escrow, I didn't write my own"</Line>
        <Line at={122} size={24}><code style={{ fontFamily: F.mono, color: C.usdc }}>chain/registry.js</code> — "this registers agents in Circle's registry"</Line>
        <Line at={140} size={24}><code style={{ fontFamily: F.mono, color: C.usdc }}>site/api/circle.js</code> — "this is Circle's PIN wallets"</Line>
        <Line at={158} size={24}><code style={{ fontFamily: F.mono, color: C.usdc }}>worker/agents/launch-kit.js</code> — "the agent that hires agents"</Line>
      </div>
      <Line at={182} size={26}>→ 30 seconds on what's next. Then stop. No outro.</Line>
      <Line at={210} strong size={28}>
        Before you record: run <code style={{ fontFamily: F.mono, color: C.usdc }}>npm run watch</code>, and never open <code style={{ fontFamily: F.mono, color: C.red }}>.env</code> on camera.
      </Line>
      <Line at={240} size={26}>Upload to YouTube as <b style={{ color: C.ink }}>Unlisted</b>. Copy the link.</Line>
    </div>
  </Scene>
);

/* ————— S5 · step 4, submit (840–1020) ————— */
export const StepSubmit: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <div style={{ width: "82%" }}>
      <StepBadge n="04" label="Ten minutes" />
      <div style={{ fontFamily: F.display, fontSize: 52, color: C.ink, textTransform: "uppercase", marginBottom: 24 }}>
        Paste two links. Read. Submit.
      </div>
      <Line at={14}>Go back to the Questbook tab — your draft is still there, everything else is already filled.</Line>
      <Line at={44} strong>Paste the YouTube link into "Video demo of the product".</Line>
      <Line at={68} strong>Paste the Drive link into "Please upload your investor deck".</Line>
      <Line at={94} size={27}>Then read every answer top to bottom. It's written in your voice — if a sentence doesn't sound like you, change it.</Line>
      <Line at={126} strong size={32}>Then you hit Submit. Not me.</Line>
    </div>
  </Scene>
);

/* ————— S6 · close (1020–1140) ————— */
export const Outro: React.FC<{ dur?: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  return (
    <Scene background={C.ink} dur={dur}>
      <div style={{ fontFamily: F.mono, fontSize: 22, letterSpacing: ".2em", color: "#8FA3C0", textTransform: "uppercase" }}>
        That's the whole list
      </div>
      <div style={{ fontFamily: F.display, fontSize: 60, color: C.paper, textTransform: "uppercase", marginTop: 26, textAlign: "center", lineHeight: 1.1 }}>
        Repo. Deck. Video.<br />Submit.
      </div>
      <div
        style={{
          fontFamily: F.body,
          fontSize: 30,
          color: "#8FA3C0",
          marginTop: 34,
          textAlign: "center",
          maxWidth: "68%",
          opacity: interpolate(frame, [40, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        Stuck on any step? Ask me and I'll walk you through that one.
      </div>
      <div
        style={{
          marginTop: 44,
          fontFamily: F.display,
          fontSize: 40,
          color: "#7FB1E8",
          opacity: interpolate(frame, [66, 84], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        stubly.org
      </div>
    </Scene>
  );
};
