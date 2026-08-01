import React from "react";
import { Audio, Composition, Sequence, staticFile } from "remotion";
import { BrandOpen, CLICK_AT, Close, Lifecycle, PIN_KEY_FRAMES, PinWallet, Shelf, Subcontract } from "./scenes";

/* Scene layout: [start, duration] — 912 frames ≈ 30s total */
const S1 = [0, 84] as const;
const S2 = [84, 132] as const;
const S3 = [216, 264] as const;
const S4 = [480, 180] as const;
const S5 = [660, 132] as const;
const S6 = [792, 120] as const;

const KEYS = ["key1.wav", "key2.wav", "key3.wav"];

/** Keyboard ticks that follow a typewriter line: one key every 3 frames while it types. */
function typing(globalStart: number, textLength: number, speed: number, volume = 0.14): Array<[string, number, number]> {
  const frames = Math.ceil(textLength / speed);
  const out: Array<[string, number, number]> = [];
  for (let f = 0; f < frames; f += 3) {
    out.push([KEYS[(globalStart + f) % 3], globalStart + f, volume * (0.8 + ((globalStart + f) % 5) * 0.08)]);
  }
  return out;
}

const SFX: Array<[string, number, number]> = [
  // scene changes — barely-there air
  ...[S2, S3, S4, S5, S6].map(([start]) => ["swish.wav", start - 8, 0.3] as [string, number, number]),

  // S1 — stamp lands
  ["stamp.wav", 46, 0.6],

  // S2 — the cursor actually clicks the card
  ["mouseclick.wav", S2[0] + CLICK_AT, 0.6],

  // S3 — the console types (real keyboard), stamps land as lines confirm
  ...typing(S3[0] + 34, 26, 3.1),
  ...typing(S3[0] + 70, 36, 3.1),
  ...typing(S3[0] + 108, 34, 3.1),
  ...typing(S3[0] + 148, 29, 3.1),
  ...typing(S3[0] + 212, 35, 3.1),
  ["stamp.wav", S3[0] + 70, 0.55],
  ["stamp.wav", S3[0] + 148, 0.55],
  ["stamp.wav", S3[0] + 212, 0.65],

  // S4 — three settled stamps
  ["stamp.wav", S4[0] + 92, 0.5],
  ["stamp.wav", S4[0] + 102, 0.5],
  ["stamp.wav", S4[0] + 128, 0.6],

  // S5 — six real key presses, then the wallet-live stamp
  ...PIN_KEY_FRAMES.map((f, i) => [KEYS[i % 3], S5[0] + f, 0.4] as [string, number, number]),
  ["stamp.wav", S5[0] + 84, 0.6],

  // S6 — one click as the URL lands
  ["mouseclick.wav", S6[0] + 40, 0.45],
];

const Demo: React.FC = () => (
  <>
    <Sequence from={S1[0]} durationInFrames={S1[1]}>
      <BrandOpen dur={S1[1]} />
    </Sequence>
    <Sequence from={S2[0]} durationInFrames={S2[1]}>
      <Shelf dur={S2[1]} />
    </Sequence>
    <Sequence from={S3[0]} durationInFrames={S3[1]}>
      <Lifecycle dur={S3[1]} />
    </Sequence>
    <Sequence from={S4[0]} durationInFrames={S4[1]}>
      <Subcontract dur={S4[1]} />
    </Sequence>
    <Sequence from={S5[0]} durationInFrames={S5[1]}>
      <PinWallet dur={S5[1]} />
    </Sequence>
    <Sequence from={S6[0]} durationInFrames={S6[1]}>
      <Close dur={S6[1]} />
    </Sequence>

    {SFX.map(([file, frame, volume], i) => (
      <Sequence key={i} from={Math.max(0, Math.round(frame))} durationInFrames={20}>
        <Audio src={staticFile(file)} volume={volume} />
      </Sequence>
    ))}
  </>
);

export const Root: React.FC = () => (
  <Composition id="StublyDemo" component={Demo} durationInFrames={912} fps={30} width={1920} height={1080} />
);
