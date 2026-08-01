"use strict";

/**
 * Local stand-in for Vercel (gold/dev-server.js pattern): serves the static
 * site AND the /api functions together so the whole flow can be exercised
 * before any deploy.   node site/dev-server.js   → http://localhost:8791
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
// Local only: load the project .env so api/ functions see CIRCLE_API_KEY etc.
// (On Vercel these come from the dashboard's environment settings instead.)
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const PORT = 8791;
const ROOT = __dirname;
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".md": "text/markdown" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z-]/g, "");
    const file = path.join(ROOT, "api", `${name}.js`);
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("no such api"); }
    try {
      const handler = require(file);
      return await handler(req, res);
    } catch (e) {
      res.statusCode = 500; return res.end(JSON.stringify({ error: e.message }));
    }
  }

  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  if (!path.extname(p)) p += ".html"; // cleanUrls behaviour like vercel.json
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});

server.listen(PORT, () => console.log(`dev server → http://localhost:${PORT}`));
