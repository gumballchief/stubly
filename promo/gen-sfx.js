"use strict";

/**
 * UI-demo sound kit, synthesized: a real mouse click (press+release transients),
 * three keyboard thocks for typing variation, a dry paper stamp, and a very soft
 * air swish for scene changes. Short percussive transients — no toy sine tones.
 *
 *   node gen-sfx.js   → writes public/*.wav
 */

const fs = require("fs");
const path = require("path");
const SR = 44100;

function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  fs.mkdirSync(path.join(__dirname, "public"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "public", name), buf);
  console.log(name);
}

const secs = (s) => Math.floor(s * SR);
const rnd = () => Math.random() * 2 - 1;

/** sharp broadband transient with band character — the core of every real UI sound */
function transient(out, atSec, { amp = 1, decay = 900, tone = 3800, toneAmp = 0.25, toneDecay = 1400 }) {
  const start = secs(atSec);
  let hp = 0;
  for (let i = start; i < out.length; i++) {
    const t = (i - start) / SR;
    const noise = rnd() * Math.exp(-t * decay);
    hp = noise - hp * 0.35;
    out[i] += hp * amp + Math.sin(2 * Math.PI * tone * t) * Math.exp(-t * toneDecay) * toneAmp * amp;
  }
}

/* mouse click: press + softer release 30ms later — the sound every screen demo has */
{
  const out = new Array(secs(0.07)).fill(0);
  transient(out, 0, { amp: 0.85, decay: 1100, tone: 4200, toneAmp: 0.2 });
  transient(out, 0.03, { amp: 0.45, decay: 1400, tone: 3600, toneAmp: 0.15 });
  writeWav("mouseclick.wav", out);
}

/* three keyboard thocks — noise tap + short low knock, pitch varied per key */
for (const [name, knock] of [["key1.wav", 155], ["key2.wav", 185], ["key3.wav", 132]]) {
  const out = new Array(secs(0.06)).fill(0);
  transient(out, 0, { amp: 0.5, decay: 1500, tone: 2600, toneAmp: 0.12 });
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] += Math.sin(2 * Math.PI * knock * t) * Math.exp(-t * 160) * 0.35;
  }
  writeWav(name, out);
}

/* stamp: dry paper hit — slap + very short knock, no boom */
{
  const out = new Array(secs(0.12)).fill(0);
  transient(out, 0, { amp: 1.0, decay: 500, tone: 1900, toneAmp: 0.1 });
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] += Math.sin(2 * Math.PI * 105 * t) * Math.exp(-t * 90) * 0.5;
  }
  writeWav("stamp.wav", out);
}

/* swish: barely-there air for scene changes */
{
  const n = secs(0.22);
  const out = new Array(n).fill(0);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.sin(Math.PI * Math.min(1, t / 0.22)) ** 2;
    lp = lp * 0.94 + rnd() * 0.06;
    out[i] = lp * env * 1.6;
  }
  writeWav("swish.wav", out);
}
