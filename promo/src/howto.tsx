import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, F, Scene, Stamp, StubMark } from "./brand";

/* ————— shared bits ————— */

const StepBadge: React.FC<{ n: string; label: string }> = ({ n, label }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 16 }}>
    <div style={{ fontFamily: F.display, fontSize: 28, color: C.paper, background: C.usdc, borderRadius: 10, padding: "9px 18px", lineHeight: 1 }}>
      {n}
    </div>
    <div style={{ fontFamily: F.mono, fontSize: 18, letterSpacing: ".22em", textTransform: "uppercase", color: C.inkSoft }}>{label}</div>
  </div>
);

const Title: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 48 }) => (
  <div style={{ fontFamily: F.display, fontSize: size, color: C.ink, textTransform: "uppercase", marginBottom: 22, lineHeight: 1.05 }}>
    {children}
  </div>
);

const Line: React.FC<{ children: React.ReactNode; at: number; size?: number; strong?: boolean; indent?: number }> = ({
  children, at, size = 28, strong, indent = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 15, stiffness: 180 } });
  return (
    <div style={{
      fontFamily: F.body, fontSize: size, fontWeight: strong ? 700 : 400,
      color: strong ? C.ink : C.inkSoft, lineHeight: 1.45, marginBottom: 12,
      marginLeft: indent, opacity: s, transform: `translateX(${interpolate(s, [0, 1], [-22, 0])}px)`, maxWidth: "95%",
    }}>{children}</div>
  );
};

const Box: React.FC<{ children: React.ReactNode; at: number; tone?: "say" | "do" | "warn" }> = ({ children, at, tone = "do" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 14, stiffness: 170 } });
  const style =
    tone === "say"
      ? { background: C.manila, border: `2px solid ${C.manilaEdge}`, borderLeft: `10px solid ${C.usdc}` }
      : tone === "warn"
      ? { background: "#FDECEA", border: `2px solid ${C.red}` }
      : { background: C.paper, border: `3px solid ${C.ink}` };
  return (
    <div style={{
      ...style, borderRadius: 10, padding: "20px 24px", margin: "16px 0", maxWidth: "92%",
      opacity: s, transform: `translateY(${interpolate(s, [0, 1], [18, 0])}px)`,
    }}>{children}</div>
  );
};

const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{
    display: "inline-block", fontFamily: F.mono, fontSize: 22, fontWeight: 600, color: C.ink,
    background: C.paper, border: `3px solid ${C.ink}`, borderRadius: 8, padding: "4px 14px",
    margin: "0 5px", boxShadow: `0 4px 0 ${C.ink}`,
  }}>{children}</span>
);

const Cmd: React.FC<{ text: string; at: number }> = ({ text, at }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const shown = Math.min(text.length, Math.floor((frame - at) * 2.6));
  return (
    <div style={{
      background: C.ink, color: "#8FE3B0", fontFamily: F.mono, fontSize: 20, padding: "20px 24px",
      borderRadius: 10, lineHeight: 1.5, wordBreak: "break-all", margin: "14px 0", maxWidth: "92%",
    }}>
      {text.slice(0, shown)}{shown < text.length ? <span style={{ opacity: 0.8 }}>▌</span> : null}
    </div>
  );
};

const Pane: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ width: "86%" }}>{children}</div>
);

/* ═════ 1 · intro ═════ */
export const Intro: React.FC<{ dur?: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 13, stiffness: 200 } });
  return (
    <Scene dur={dur}>
      <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.7, 1])})`, opacity: pop }}>
        <StubMark size={160} />
      </div>
      <div style={{ fontFamily: F.display, fontSize: 60, color: C.ink, textTransform: "uppercase", marginTop: 24, textAlign: "center" }}>
        How to make your video
      </div>
      <div style={{ fontFamily: F.body, fontSize: 32, color: C.inkSoft, marginTop: 20, textAlign: "center", maxWidth: "72%" }}>
        You will not have to open a single code file.
        <br />
        <b style={{ color: C.ink }}>Everything you say is written out for you.</b>
      </div>
      <div style={{ marginTop: 34 }}>
        <Stamp label="Watch this once, then start" color={C.green} at={70} fontSize={26} rotate={-4} />
      </div>
    </Scene>
  );
};

/* ═════ 2 · what you're making ═════ */
export const WhatItIs: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <Pane>
      <StepBadge n="?" label="First, what this video even is" />
      <Title>You're recording your screen while you talk</Title>
      <Line at={12}>Circle asks every applicant for one video. It has to show two things:</Line>
      <Line at={38} strong indent={30}>1. Your product actually working</Line>
      <Line at={56} strong indent={30}>2. The code where Circle's stuff is plugged in</Line>
      <Line at={80}>It must be <b style={{ color: C.ink }}>under 5 minutes</b>. Nobody edits it. Nobody sees your face.</Line>
      <Box at={104} tone="say">
        <div style={{ fontFamily: F.mono, fontSize: 15, letterSpacing: ".18em", textTransform: "uppercase", color: C.usdcDeep, marginBottom: 10 }}>
          The thing that makes this easy
        </div>
        <div style={{ fontSize: 27, color: C.ink, lineHeight: 1.5 }}>
          I made you a page that has the code <b>and</b> the exact words to say underneath it.
          You open that page, scroll down slowly, and read out loud. That's the whole hard part.
        </div>
      </Box>
    </Pane>
  </Scene>
);

/* ═════ 3 · open the guide ═════ */
export const OpenGuide: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <Pane>
      <StepBadge n="01" label="Setup · two minutes" />
      <Title>Open your guide page</Title>
      <Line at={12}>In Chrome, open a new tab and type this in the address bar:</Line>
      <Cmd at={34} text={"C:\\Users\\youso\\Claude Code\\agent-market\\launch\\recording-guide.html"} />
      <Line at={112}>Or just find that file in your folders and double-click it.</Line>
      <Box at={132}>
        <div style={{ fontFamily: F.mono, fontSize: 15, letterSpacing: ".18em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 10 }}>
          What you'll see on that page
        </div>
        <div style={{ fontSize: 25, color: C.ink, lineHeight: 1.6 }}>
          <b style={{ color: C.usdcDeep }}>Blue boxes</b> = read these out loud, word for word.<br />
          <b>White boxes</b> = do this thing with your mouse.<br />
          <b>Black boxes</b> = the code. Just let it sit on screen while you read.
        </div>
      </Box>
    </Pane>
  </Scene>
);

/* ═════ 4 · get ready ═════ */
export const GetReady: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <Pane>
      <StepBadge n="02" label="Setup · three minutes" />
      <Title>Three things before you record</Title>
      <Line at={12} strong>One — start the worker.</Line>
      <Line at={30} size={26} indent={30}>Open a terminal and run this. Leave the window open the whole time.</Line>
      <Cmd at={48} text={'cd "C:\\Users\\youso\\Claude Code\\agent-market" && npm run watch'} />
      <Line at={116} size={26} indent={30}>If you skip this, the job you buy on camera will never finish.</Line>
      <Line at={140} strong>Two — open two browser tabs.</Line>
      <Line at={158} size={26} indent={30}>Tab 1: <b style={{ color: C.ink }}>stubly.org</b> · Tab 2: <b style={{ color: C.ink }}>your guide page</b></Line>
      <Line at={182} strong>Three — close anything private.</Line>
      <Line at={200} size={26} indent={30}>Messages, email, anything you don't want on camera.</Line>
    </Pane>
  </Scene>
);

/* ═════ 5 · how to record ═════ */
export const HowToRecord: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <Pane>
      <StepBadge n="03" label="Recording · the buttons" />
      <Title>How to actually start recording</Title>
      <Line at={12} strong>Hold the Windows key and press G.</Line>
      <Line at={32} size={26}>
        <Key>⊞ Win</Key> + <Key>G</Key> — a dark bar appears across your screen. That's Xbox Game Bar. It records anything.
      </Line>
      <Line at={64} strong>Find the small box called “Capture”.</Line>
      <Line at={84} size={26} indent={30}>It has a camera icon and a round record button — the big circle.</Line>
      <Line at={110} strong>Click the round record button.</Line>
      <Line at={128} size={26} indent={30}>A small timer appears in the corner. You are now recording. Click anywhere to hide the bar.</Line>
      <Box at={156} tone="warn">
        <div style={{ fontSize: 25, color: C.ink, lineHeight: 1.5 }}>
          <b style={{ color: C.red }}>Make sure your microphone is on.</b> There's a little microphone
          icon next to the record button — if it has a line through it, click it so it doesn't.
          A silent video is a wasted video.
        </div>
      </Box>
    </Pane>
  </Scene>
);

/* ═════ 6 · part one of the recording ═════ */
export const RecPart1: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <Pane>
      <StepBadge n="04" label="Recording · first 90 seconds" />
      <Title>Part one — show the product</Title>
      <Line at={12}>Go to the <b style={{ color: C.ink }}>stubly.org</b> tab. Start talking. Your first line is:</Line>
      <Box at={36} tone="say">
        <div style={{ fontSize: 28, color: C.ink, lineHeight: 1.55 }}>
          “Hi, I'm Yousof. This is Stubly, and it's live on Arc testnet. You hire an AI agent to do a
          job, your USDC sits in escrow while it works, and you either get the work or you get your
          money back.”
        </div>
      </Box>
      <Line at={96}>Then follow your guide page — it walks you through scrolling to the agents, hiring
        Site Audit, paying with your PIN, and watching the stamps land. Every sentence is written there.</Line>
      <Line at={140} strong>You do not need to remember any of it. Read it.</Line>
    </Pane>
  </Scene>
);

/* ═════ 7 · part two ═════ */
export const RecPart2: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <Pane>
      <StepBadge n="05" label="Recording · the middle 2½ minutes" />
      <Title>Part two — the code, without touching code</Title>
      <Line at={12} strong>Switch to your guide page tab. That's it. That's the whole trick.</Line>
      <Line at={36}>The page shows the real code from your project in big black boxes, and under each one
        is exactly what to say about it.</Line>
      <Box at={70}>
        <div style={{ fontFamily: F.mono, fontSize: 15, letterSpacing: ".18em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 10 }}>
          Your loop, five times
        </div>
        <div style={{ fontSize: 26, color: C.ink, lineHeight: 1.6 }}>
          Scroll until a black code box fills the screen → pause →
          read the blue box under it out loud → scroll to the next one.
        </div>
      </Box>
      <Line at={116} size={26}>Scroll <b style={{ color: C.ink }}>slowly</b>. They need to see the code, not a blur.</Line>
      <Line at={140} size={26}>If you stumble on a word like “ERC-8183”, just say it your way and keep going.
        It's a real person talking, not a commercial.</Line>
    </Pane>
  </Scene>
);

/* ═════ 8 · part three + stop ═════ */
export const RecPart3: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <Pane>
      <StepBadge n="06" label="Recording · last 30 seconds" />
      <Title>Part three — finish and stop</Title>
      <Line at={12}>The last blue box on the guide page is your closing lines about what's next.
        Read it, then stop talking.</Line>
      <Line at={48} strong>To stop recording:</Line>
      <Line at={66} size={26} indent={30}>
        Press <Key>⊞ Win</Key> + <Key>G</Key> again, then click the <b style={{ color: C.ink }}>stop</b> button (the square).
      </Line>
      <Line at={96} strong>Where your video went:</Line>
      <Line at={114} size={26} indent={30}>
        <b style={{ color: C.ink }}>This PC → Videos → Captures</b>. It's the newest file in there.
      </Line>
      <Box at={146} tone="warn">
        <div style={{ fontSize: 25, color: C.ink, lineHeight: 1.5 }}>
          <b style={{ color: C.red }}>Do not add music, titles, or an outro.</b> They want it plain.
          Long and honest beats short and polished here.
        </div>
      </Box>
    </Pane>
  </Scene>
);

/* ═════ 9 · upload ═════ */
export const Upload: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <Pane>
      <StepBadge n="07" label="After recording · five minutes" />
      <Title>Put it on YouTube, unlisted</Title>
      <Line at={12} strong>Go to youtube.com and sign in with your Google account.</Line>
      <Line at={36} strong>Click the camera icon with a “+” at the top right → “Upload video”.</Line>
      <Line at={62} strong>Drag your video file in from Videos → Captures.</Line>
      <Line at={88} strong>Title it: Stubly — Circle Grant Demo</Line>
      <Box at={112} tone="warn">
        <div style={{ fontSize: 26, color: C.ink, lineHeight: 1.5 }}>
          <b style={{ color: C.red }}>The important part:</b> on the visibility step, choose
          <b> Unlisted</b> — not Public, not Private. Unlisted means only people with the link can
          watch it. Private would block the Circle reviewers from seeing it.
        </div>
      </Box>
      <Line at={158} strong>Then copy the video link.</Line>
    </Pane>
  </Scene>
);

/* ═════ 10 · paste and submit ═════ */
export const PasteSubmit: React.FC<{ dur?: number }> = ({ dur }) => (
  <Scene dur={dur}>
    <Pane>
      <StepBadge n="08" label="The finish line" />
      <Title>Paste it in and submit</Title>
      <Line at={12}>Go back to the Circle grant tab. Your draft is still there — everything else is
        already filled in.</Line>
      <Line at={44} strong>Scroll to the bottom. Two empty boxes:</Line>
      <Line at={64} size={26} indent={30}>“Video demo of the product” → paste your YouTube link</Line>
      <Line at={84} size={26} indent={30}>“Please upload your investor deck” → paste your Google Drive link</Line>
      <Line at={112}>Then read the whole form top to bottom. It's written in your voice —
        if a sentence doesn't sound like you, change it.</Line>
      <Line at={148} strong size={32}>Then you press Submit. That one's yours.</Line>
    </Pane>
  </Scene>
);

/* ═════ 11 · outro ═════ */
export const Outro: React.FC<{ dur?: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  return (
    <Scene background={C.ink} dur={dur}>
      <div style={{ fontFamily: F.mono, fontSize: 20, letterSpacing: ".2em", color: "#8FA3C0", textTransform: "uppercase" }}>
        Remember
      </div>
      <div style={{ fontFamily: F.display, fontSize: 54, color: C.paper, textTransform: "uppercase", marginTop: 22, textAlign: "center", lineHeight: 1.12 }}>
        Open the guide page.<br />Press record.<br />Read the blue boxes.
      </div>
      <div style={{
        fontFamily: F.body, fontSize: 29, color: "#8FA3C0", marginTop: 34, textAlign: "center", maxWidth: "70%",
        opacity: interpolate(frame, [40, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      }}>
        You built all of this. Talking about it for four minutes is the easy part.
      </div>
      <div style={{
        marginTop: 40, fontFamily: F.body, fontSize: 25, color: "#7FB1E8", textAlign: "center",
        opacity: interpolate(frame, [70, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      }}>
        Stuck anywhere? Tell me which step and I'll do it with you.
      </div>
    </Scene>
  );
};
