"use strict";

/**
 * Render the preview frames to PNG.
 *
 * The frames are authored as SVG because that is what GitHub renders crisply in a
 * README. Everywhere else wants a raster: X rejects SVG uploads outright, and so
 * do most places you would paste one.
 *
 * Chrome does the rendering. It is already on this machine, it draws the SVG with
 * the same engine that will show it to a reader, and it saves adding an image
 * dependency to a project that otherwise has none.
 *
 *   npm run shots
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => fs.existsSync(p));

const DIR = path.join(__dirname, "..", "docs", "screenshots");
const OUT = path.join(DIR, "png");

function main() {
  if (!CHROME) throw new Error("no Chrome found — add its path to CHROME in this file");
  fs.mkdirSync(OUT, { recursive: true });

  const frames = fs.readdirSync(DIR).filter((f) => f.endsWith(".svg"));
  if (!frames.length) throw new Error("no .svg frames in " + DIR);

  for (const f of frames) {
    const name = path.basename(f, ".svg");
    const src = "file:///" + path.join(DIR, f).split(path.sep).join("/").split(" ").join("%20");
    execFileSync(CHROME, [
      "--headless", "--disable-gpu", "--hide-scrollbars",
      "--window-size=1200,750",
      "--screenshot=" + path.join(OUT, name + ".png"),
      src,
    ], { stdio: "ignore" });
    const size = fs.statSync(path.join(OUT, name + ".png")).size;
    console.log("  " + name.padEnd(12) + Math.round(size / 1024) + "KB");
  }
  console.log("\n" + frames.length + " frame(s) → docs/screenshots/png");
}

if (require.main === module) {
  try { main(); } catch (e) { console.error("FAILED:", e.message); process.exit(1); }
}
