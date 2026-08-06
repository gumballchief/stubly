import React from "react";
import { Audio, Composition, Sequence, staticFile } from "remotion";
import { BrandOpen, CLICK_AT, Close, Lifecycle, PIN_KEY_FRAMES, PinWallet, Shelf, Subcontract } from "./scenes";
import { GetReady, HowToRecord, Intro, OpenGuide, Outro, PasteSubmit, RecPart1, RecPart2, RecPart3, Upload, WhatItIs } from "./howto";
import { CARD_COUNT, ScriptCard } from "./cards";
import { Guarantee, GUARANTEE_TOTAL, OneJob, ONEJOB_TOTAL, Thesis, THESIS_TOTAL } from "./films";

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

/* ————— How-to video: making the grant video, assuming zero code knowledge ————— */
const HS: Array<[React.FC<{ dur?: number }>, number]> = [
  [Intro, 150],
  [WhatItIs, 270],
  [OpenGuide, 240],
  [GetReady, 300],
  [HowToRecord, 300],
  [RecPart1, 270],
  [RecPart2, 300],
  [RecPart3, 270],
  [Upload, 300],
  [PasteSubmit, 270],
  [Outro, 180],
];

const STARTS = HS.reduce<number[]>((acc, [, d], i) => [...acc, i === 0 ? 0 : acc[i - 1] + HS[i - 1][1]], []);
const HOWTO_TOTAL = STARTS[STARTS.length - 1] + HS[HS.length - 1][1];

const HOWTO_SFX: Array<[string, number, number]> = [
  // a soft swish on every scene change
  ...STARTS.slice(1).map((s) => ["swish.wav", s - 8, 0.28] as [string, number, number]),
  ["stamp.wav", 70, 0.55],
  // the two commands type themselves
  ...Array.from({ length: 16 }, (_, i) => [KEYS[i % 3], STARTS[2] + 36 + i * 5, 0.12] as [string, number, number]),
  ...Array.from({ length: 14 }, (_, i) => [KEYS[i % 3], STARTS[3] + 50 + i * 5, 0.12] as [string, number, number]),
  // clicks where the video tells him to click something
  ["mouseclick.wav", STARTS[4] + 112, 0.42],
  ["mouseclick.wav", STARTS[7] + 68, 0.42],
  ["mouseclick.wav", STARTS[8] + 38, 0.36],
  ["mouseclick.wav", STARTS[8] + 64, 0.36],
  ["mouseclick.wav", STARTS[9] + 66, 0.36],
  ["mouseclick.wav", STARTS[9] + 86, 0.36],
  ["stamp.wav", STARTS[9] + 150, 0.6],
];

const HowTo: React.FC = () => (
  <>
    {HS.map(([Comp, dur], i) => (
      <Sequence key={i} from={STARTS[i]} durationInFrames={dur}>
        <Comp dur={dur} />
      </Sequence>
    ))}
    {HOWTO_SFX.map(([file, frame, volume], i) => (
      <Sequence key={`s${i}`} from={Math.max(0, Math.round(frame))} durationInFrames={20}>
        <Audio src={staticFile(file)} volume={volume} />
      </Sequence>
    ))}
  </>
);

/* ————— The three newer films: two marketing cuts and a longer demo ————— */

const withSfx = (Film: React.FC, sfx: Array<[string, number, number]>): React.FC => () => (
  <>
    <Film />
    {sfx.map(([file, frame, volume], i) => (
      <Sequence key={`x${i}`} from={Math.max(0, Math.round(frame))} durationInFrames={20}>
        <Audio src={staticFile(file)} volume={volume} />
      </Sequence>
    ))}
  </>
);

/* Ledger lines land like paper on a desk; the turn to positive gets the ding. */
const THESIS_SFX: Array<[string, number, number]> = [
  ...[96, 348, 480].map((s) => ["swish.wav", s - 8, 0.3] as [string, number, number]),
  ...[8, 30, 52, 74, 96, 112].map((f) => ["pop.wav", 96 + f, 0.16] as [string, number, number]),
  ...[10, 34, 58].map((f) => ["pop.wav", 348 + f, 0.3] as [string, number, number]),
  ["ding.wav", 348 + 74, 0.4],
  ["stamp.wav", 480 + 26, 0.5],
];

const GUARANTEE_SFX: Array<[string, number, number]> = [
  ...[90, 276, 450].map((s) => ["swish.wav", s - 8, 0.3] as [string, number, number]),
  ["stamp.wav", 90 + 20, 0.55],
  ["stamp.wav", 90 + 142, 0.5],
  ["mouseclick.wav", 276 + 52, 0.6],
  ["stamp.wav", 276 + 68, 0.62],
  ["ding.wav", 276 + 74, 0.34],
];

const ONEJOB_SFX: Array<[string, number, number]> = [
  ...[108, 294, 492, 660, 894, 1140, 1326, 1536, 1782].map((s) => ["swish.wav", s - 8, 0.28] as [string, number, number]),
  ["mouseclick.wav", 108 + 96, 0.6],
  // the six PIN digits
  ...[0, 1, 2, 3, 4, 5].map((i) => [KEYS[i % 3], 294 + 32 + i * 9, 0.18] as [string, number, number]),
  ...[96, 122, 148].map((f) => ["pop.wav", 294 + f, 0.3] as [string, number, number]),
  // the worker console typing itself
  ...typing(660 + 14, 44, 3.0),
  ...typing(660 + 52, 38, 3.0),
  ...typing(660 + 88, 34, 3.0),
  ...typing(660 + 124, 38, 3.0),
  ...typing(660 + 162, 42, 3.0),
  ...typing(660 + 196, 38, 3.0),
  // four judge rules
  ...[22, 38, 54, 70].map((f) => ["pop.wav", 894 + f, 0.26] as [string, number, number]),
  // the three stamps on the settled ticket
  ["stamp.wav", 1140 + 8, 0.55],
  ["stamp.wav", 1140 + 26, 0.55],
  ["stamp.wav", 1140 + 48, 0.62],
  ["ding.wav", 1140 + 52, 0.3],
  // subcontract payouts
  ["stamp.wav", 1536 + 142, 0.5],
  ["stamp.wav", 1536 + 156, 0.5],
  ["stamp.wav", 1536 + 190, 0.6],
];

const ThesisFilm = withSfx(Thesis, THESIS_SFX);
const GuaranteeFilm = withSfx(Guarantee, GUARANTEE_SFX);
const OneJobFilm = withSfx(OneJob, ONEJOB_SFX);

export const Root: React.FC = () => {
  const { LogoStill, XBanner, OgImage } = require("./stills");
  return (
    <>
      <Composition id="OneJob" component={OneJobFilm} durationInFrames={ONEJOB_TOTAL} fps={30} width={1920} height={1080} />
      <Composition id="Thesis" component={ThesisFilm} durationInFrames={THESIS_TOTAL} fps={30} width={1920} height={1080} />
      <Composition id="Guarantee" component={GuaranteeFilm} durationInFrames={GUARANTEE_TOTAL} fps={30} width={1920} height={1080} />
      <Composition id="StublyDemo" component={Demo} durationInFrames={912} fps={30} width={1920} height={1080} />
      <Composition id="HowTo" component={HowTo} durationInFrames={HOWTO_TOTAL} fps={30} width={1920} height={1080} />
      <Composition
        id="ScriptCard"
        component={ScriptCard}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ i: 0 }}
      />
      <Composition id="LogoStill" component={LogoStill} durationInFrames={1} fps={30} width={1024} height={1024} />
      <Composition id="XBanner" component={XBanner} durationInFrames={1} fps={30} width={1500} height={500} />
      <Composition id="OgImage" component={OgImage} durationInFrames={1} fps={30} width={1200} height={630} />
    </>
  );
};
