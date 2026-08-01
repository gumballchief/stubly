import React from "react";
import { Audio, Composition, Sequence, staticFile } from "remotion";
import { BrandOpen, Close, Lifecycle, PinWallet, Shelf, Subcontract } from "./scenes";

/* Scene layout: [start, duration] */
const S1 = [0, 150] as const;
const S2 = [150, 270] as const;
const S3 = [420, 480] as const;
const S4 = [900, 390] as const;
const S5 = [1290, 270] as const;
const S6 = [1560, 180] as const;

/* One flat audio timeline in GLOBAL frames: [file, frame, volume] */
const SFX: Array<[string, number, number]> = [
  // scene transitions — paper whoosh just before each boundary
  ...[S2, S3, S4, S5, S6].map(([start]) => ["whoosh.wav", start - 10, 0.4] as [string, number, number]),

  // S1 — brand open
  ["pop.wav", 6, 0.55],
  ["click.wav", 22, 0.35],
  ["stamp.wav", 92, 0.85],

  // S2 — shelf: three cards land, footer line clicks in
  ["pop.wav", 176, 0.5],
  ["pop.wav", 192, 0.5],
  ["pop.wav", 208, 0.5],
  ["click.wav", 262, 0.3],

  // S3 — lifecycle: ticket rows tick in, stamps thunk, settlement dings
  ["click.wav", 440, 0.35],
  ["click.wav", 454, 0.35],
  ["click.wav", 468, 0.35],
  ["click.wav", 480, 0.35],
  ["stamp.wav", 570, 0.85],
  ["stamp.wav", 688, 0.85],
  ["stamp.wav", 800, 0.9],
  ["ding.wav", 806, 0.45],

  // S4 — subcontract: tickets land, three settled stamps
  ["pop.wav", 930, 0.55],
  ["pop.wav", 1070, 0.5],
  ["pop.wav", 1090, 0.5],
  ["stamp.wav", 1110, 0.75],
  ["stamp.wav", 1140, 0.75],
  ["stamp.wav", 1230, 0.85],
  ["ding.wav", 1236, 0.4],

  // S5 — PIN pad: six key clicks (first dot appears at scene frame 72), wallet-live stamp
  ["click.wav", 1362, 0.45],
  ["click.wav", 1374, 0.45],
  ["click.wav", 1386, 0.45],
  ["click.wav", 1398, 0.45],
  ["click.wav", 1410, 0.45],
  ["click.wav", 1422, 0.45],
  ["stamp.wav", 1440, 0.85],
  ["ding.wav", 1446, 0.4],

  // S6 — close: counter ticks, lockup lands, URL ding
  ["click.wav", 1572, 0.28],
  ["click.wav", 1582, 0.28],
  ["click.wav", 1592, 0.28],
  ["click.wav", 1602, 0.28],
  ["click.wav", 1612, 0.28],
  ["pop.wav", 1630, 0.55],
  ["ding.wav", 1644, 0.5],
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
      <Sequence key={i} from={Math.max(0, frame)} durationInFrames={30}>
        <Audio src={staticFile(file)} volume={volume} />
      </Sequence>
    ))}
  </>
);

export const Root: React.FC = () => (
  <Composition id="StublyDemo" component={Demo} durationInFrames={1740} fps={30} width={1920} height={1080} />
);
