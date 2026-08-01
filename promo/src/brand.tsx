import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadArchivo } from "@remotion/google-fonts/ArchivoBlack";
import { loadFont as loadPublic } from "@remotion/google-fonts/PublicSans";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";

const archivo = loadArchivo();
const publicSans = loadPublic();
const mono = loadMono();

export const F = {
  display: archivo.fontFamily,
  body: publicSans.fontFamily,
  mono: mono.fontFamily,
};

export const C = {
  desk: "#E8EBEF",
  deskDeep: "#DDE2E8",
  ink: "#16233B",
  inkSoft: "#4D5A70",
  manila: "#F6EEDC",
  manilaEdge: "#DDCDA4",
  usdc: "#2775CA",
  usdcDeep: "#1D5DA6",
  stampBlue: "#26518F",
  green: "#1E7A4A",
  red: "#B23A2F",
  paper: "#FCFCFA",
  dash: "rgba(22,35,59,0.28)",
};

/** The stub logomark. */
export const StubMark: React.FC<{ size?: number }> = ({ size = 120 }) => (
  <svg width={size} height={(size * 180) / 260} viewBox="0 0 260 180">
    <path
      d="M 30 10 H 59 A 13 13 0 0 0 85 10 H 230 Q 250 10 250 30 V 150 Q 250 170 230 170 H 85 A 13 13 0 0 0 59 170 H 30 Q 10 170 10 150 V 30 Q 10 10 30 10 Z"
      fill={C.manila}
      stroke={C.ink}
      strokeWidth={9}
      strokeLinejoin="round"
    />
    <line x1={72} y1={32} x2={72} y2={148} stroke={C.ink} strokeWidth={5} strokeLinecap="round" strokeDasharray="0.1 14" opacity={0.55} />
    <g transform="rotate(-7 160 90)">
      <text x={160} y={124} textAnchor="middle" fontFamily={F.display} fontSize={104} fill={C.usdc} opacity={0.94}>
        S
      </text>
    </g>
  </svg>
);

/** Rubber stamp that thunks in with a spring. */
export const Stamp: React.FC<{
  label: string;
  color?: string;
  at: number; // frame at which it lands (relative to current sequence)
  fontSize?: number;
  rotate?: number;
  style?: React.CSSProperties;
}> = ({ label, color = C.stampBlue, at, fontSize = 34, rotate = -5, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 11, stiffness: 210, mass: 0.6 } });
  const scale = interpolate(s, [0, 1], [1.9, 1]);
  const opacity = interpolate(s, [0, 0.35, 1], [0, 0.95, 0.88]);
  return (
    <div
      style={{
        display: "inline-block",
        fontFamily: F.display,
        textTransform: "uppercase",
        fontSize,
        letterSpacing: "0.12em",
        lineHeight: 1,
        padding: `${fontSize * 0.32}px ${fontSize * 0.5}px`,
        border: `${Math.max(3, fontSize * 0.11)}px solid ${color}`,
        borderRadius: 8,
        color,
        transform: `rotate(${rotate}deg) scale(${scale})`,
        opacity,
        ...style,
      }}
    >
      {label}
    </div>
  );
};

/** Manila ticket card with perforated left strip. */
export const Ticket: React.FC<{
  width?: number;
  children: React.ReactNode;
  title?: string;
  no?: string;
  style?: React.CSSProperties;
}> = ({ width = 640, children, title = "Work order", no = "", style }) => (
  <div
    style={{
      width,
      background: C.manila,
      border: `2px solid ${C.manilaEdge}`,
      borderRadius: 10,
      boxShadow: "0 18px 44px -22px rgba(22,35,59,0.5)",
      padding: "34px 36px 30px 62px",
      position: "relative",
      ...style,
    }}
  >
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width: 36,
        borderRight: `2px dashed ${C.dash}`,
        backgroundImage: `radial-gradient(circle 6px, ${C.desk} 98%, transparent 100%)`,
        backgroundSize: "36px 34px",
        backgroundPosition: "6px 16px",
        backgroundRepeat: "repeat-y",
      }}
    />
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        borderBottom: `3px solid ${C.ink}`,
        paddingBottom: 12,
        marginBottom: 16,
      }}
    >
      <span style={{ fontFamily: F.display, fontSize: 22, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink }}>{title}</span>
      <span style={{ fontFamily: F.mono, fontSize: 20, color: C.inkSoft }}>{no}</span>
    </div>
    {children}
  </div>
);

export const TicketRow: React.FC<{ label: string; value: React.ReactNode; money?: boolean; revealAt?: number }> = ({
  label,
  value,
  money,
  revealAt = 0,
}) => {
  const frame = useCurrentFrame();
  const visible = frame >= revealAt;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 24,
        padding: "13px 0",
        borderBottom: `2px dashed ${C.dash}`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        transition: "none",
      }}
    >
      <span style={{ fontFamily: F.mono, fontSize: 15, letterSpacing: "0.16em", textTransform: "uppercase", color: C.inkSoft, paddingTop: 4 }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: money ? F.mono : F.body,
          fontWeight: money ? 600 : 700,
          fontSize: 21,
          color: money ? C.usdcDeep : C.ink,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
};

/** Dark console log with typewriter lines. lines[i] = [text, frameWhenItStartsTyping, color?] */
export const Carbon: React.FC<{ lines: Array<[string, number, string?]>; width?: number; fontSize?: number }> = ({
  lines,
  width = 640,
  fontSize = 19,
}) => {
  const frame = useCurrentFrame();
  const CHARS_PER_FRAME = 1.6;
  return (
    <div
      style={{
        width,
        background: C.ink,
        borderRadius: 10,
        padding: "26px 30px",
        fontFamily: F.mono,
        fontSize,
        lineHeight: 2,
        color: "#CFD8E6",
        boxShadow: "0 18px 44px -22px rgba(22,35,59,0.6)",
        minHeight: 120,
      }}
    >
      {lines.map(([text, start, color], i) => {
        if (frame < start) return null;
        const shown = Math.min(text.length, Math.floor((frame - start) * CHARS_PER_FRAME));
        return (
          <div key={i} style={{ color: color ?? "#CFD8E6" }}>
            {text.slice(0, shown)}
            {shown < text.length ? <span style={{ opacity: 0.7 }}>▌</span> : null}
          </div>
        );
      })}
    </div>
  );
};

/** Full-frame scene wrapper: desk background + gentle fade/slide in. */
export const Scene: React.FC<{ children: React.ReactNode; background?: string }> = ({ children, background = C.desk }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
};

export const Kicker: React.FC<{ children: React.ReactNode; light?: boolean }> = ({ children, light }) => (
  <div
    style={{
      fontFamily: F.mono,
      fontSize: 20,
      letterSpacing: "0.3em",
      textTransform: "uppercase",
      color: light ? "#8FA3C0" : C.inkSoft,
      marginBottom: 22,
    }}
  >
    {children}
  </div>
);

export const H: React.FC<{ children: React.ReactNode; size?: number; color?: string }> = ({ children, size = 72, color = C.ink }) => (
  <div
    style={{
      fontFamily: F.display,
      fontSize: size,
      textTransform: "uppercase",
      lineHeight: 1.04,
      color,
      textAlign: "center",
      letterSpacing: "-0.01em",
    }}
  >
    {children}
  </div>
);
