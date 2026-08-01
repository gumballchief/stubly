"use strict";

/**
 * Synthesizes the video's sound effects as WAV files — no stock assets, no
 * licenses, the sounds are literally ours. 44.1kHz mono 16-bit.
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
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  const dir = path.join(__dirname, "public");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
  console.log(`${name}  ${(buf.length / 1024).toFixed(1)} KB`);
}

const secs = (s) => Math.floor(s * SR);
const rnd = () => Math.random() * 2 - 1;

/* stamp: a rubber stamp hitting paper — noise slap + low thud */
{
  const n = secs(0.28);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const slap = t < 0.02 ? rnd() * Math.exp(-t * 260) * 0.9 : 0;
    const thud = Math.sin(2 * Math.PI * (135 - t * 90) * t) * Math.exp(-t * 22) * 0.95;
    out[i] = slap + thud;
  }
  writeWav("stamp.wav", out);
}

/* pop: a card landing — quick pitch-drop sine */
{
  const n = secs(0.13);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 320 - 180 * (t / 0.13);
    out[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 42) * 0.7;
  }
  writeWav("pop.wav", out);
}

/* click: tiny mechanical tick */
{
  const n = secs(0.045);
  const out = new Array(n).fill(0);
  let hp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const raw = rnd() * Math.exp(-t * 320);
    hp = raw - hp * 0.15; // crude high-pass character
    out[i] = hp * 0.55 + Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t * 400) * 0.25;
  }
  writeWav("click.wav", out);
}

/* whoosh: paper sliding — shaped, smoothed noise */
{
  const n = secs(0.42);
  const out = new Array(n).fill(0);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.sin(Math.PI * Math.min(1, t / 0.42)) ** 1.6;
    const smooth = 0.82 + 0.13 * (t / 0.42); // opens up slightly toward the end
    prev = prev * smooth + rnd() * (1 - smooth);
    out[i] = prev * env * 2.2;
  }
  writeWav("whoosh.wav", out);
}

/* ding: settlement chime — soft two-partial bell */
{
  const n = secs(0.5);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] =
      (Math.sin(2 * Math.PI * 880 * t) * 0.6 + Math.sin(2 * Math.PI * 1318 * t) * 0.3) *
      Math.exp(-t * 7) * 0.5;
  }
  writeWav("ding.wav", out);
}
