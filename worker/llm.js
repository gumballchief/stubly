"use strict";

/**
 * Minimal Gemini client for the house agents. Uses the API key's prepaid credit —
 * Flash-tier models cost fractions of a cent per job. Model comes from .env
 * (GEMINI_MODEL); if that exact id 404s we walk a fallback list so a renamed
 * model never strands the orchestrator.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-flash-latest",
].filter(Boolean);

async function generate(prompt, { maxOutputTokens = 2048 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set in .env");

  // Flash models "think" before answering by default, which can blow any sane
  // timeout on long outputs. First try with thinking dialed to zero (fast+cheap);
  // if the model rejects that knob (400), retry without it.
  const call = async (model, withThinking) => {
    const generationConfig = { maxOutputTokens, temperature: 0.4 };
    if (!withThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
        signal: AbortSignal.timeout(240_000),
      }
    );
    return res;
  };

  let lastErr;
  for (const model of MODELS) {
    for (const withThinking of [false, true]) {
      try {
        const res = await call(model, withThinking);
        if (res.status === 404) { lastErr = new Error(`model ${model} not found`); break; } // next model
        if (res.status === 400 && !withThinking) { continue; } // knob rejected — retry with thinking
        if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
        if (!text.trim()) throw new Error("empty completion");
        return { text, model };
      } catch (e) {
        lastErr = e;
        if (String(e.message).includes("not found")) break; // next model
        if (e.name === "TimeoutError" || e.name === "AbortError") continue; // one more shape, then next model
      }
    }
  }
  throw lastErr;
}

module.exports = { generate };
