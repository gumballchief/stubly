"use strict";

/**
 * Create the MAINNET signing wallets as encrypted keystores, interactively.
 *
 *   npm run wallets:mainnet                        provider_mainnet + evaluator_mainnet
 *   npm run wallets:mainnet -- --with-client       also client_mainnet (only for test orders)
 *   npm run wallets:mainnet -- --with-deployer     also deployer_mainnet, which deploys the escrow once (npm run escrow:deploy)
 *   npm run wallets:mainnet -- --copy provider_mainnet
 *        copies that keystore, still encrypted, as base64 to the clipboard for the
 *        host's PROVIDER_MAINNET_KEYSTORE_B64 setting. Nothing is printed.
 *
 * How this differs from make-wallets.js, which is for testnet faucet money:
 *  - Nothing comes from .env. The password is typed here, hidden, and may not be
 *    the testnet KEYSTORE_PASSWORD. On a host it is KEYSTORE_PASSWORD_MAINNET.
 *  - Each wallet is either a new one made in memory (recommended) or an existing
 *    private key pasted here (hidden). The plaintext key is never printed or written.
 *  - A testnet wallet, the sweep's cold wallet, or one key for two roles is refused.
 *  - Every keystore is decrypted before it is written and read back after, so a
 *    file on disk is known to open with the password that was typed.
 *  - Existing keystores are never overwritten.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Wallet } = require("ethers");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");

const ROLES = ["provider_mainnet", "evaluator_mainnet"];
const ALL_MAINNET = [...ROLES, "client_mainnet", "deployer_mainnet"];
const TESTNET = ["client", "provider", "evaluator"];
/* The testnet provider and evaluator, as published in site/api/_shared.js, so they
   are refused even on a machine that no longer has their keystore files. */
const TESTNET_ADDRESSES = ["0x15b9F8a8658E10DaD42ec08CEf158Ca1392a8944", "0x6F5A2E61DA4C779c6b4119F3BfEC8ec53Db488C7"];
const MIN_PASSWORD = 16;
const ROLE_HELP = {
  provider_mainnet: "the agents' wallet: sets prices, delivers work, gets paid",
  evaluator_mainnet: "approves or rejects work, and refunds buyers",
  client_mainnet: "a buyer wallet, only for test orders",
  deployer_mainnet: "deploys Stubly's escrow once, then gives up all control of it; needs about 1 USDC",
};

const fileFor = (name, dir = __dirname) => path.join(dir, `${name}.keystore.json`);

/* The address a keystore belongs to, from its public field. No password needed. */
function keystoreAddress(file) {
  try {
    const a = JSON.parse(fs.readFileSync(file, "utf8")).address;
    return a ? ("0x" + String(a).replace(/^0x/i, "")).toLowerCase() : null;
  } catch { return null; }
}

function ask(question, input = process.stdin, output = process.stdout) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: true });
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

/* Readline redraws the whole line, prompt plus everything typed so far, on a
   backspace, on wrapping past the window width, on Ctrl+L and on a resize. So the
   echo is rebuilt from scratch every time: the prompt, then one star per character.
   The typed text itself never reaches the screen. Nothing is trimmed here, because
   a password with a trailing space must stay exactly as typed. */
function askHidden(question, input = process.stdin, output = process.stdout) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: true });
    const orig = rl._writeToOutput.bind(rl);
    rl.question(question, (ans) => { rl._writeToOutput = orig; rl.close(); output.write("\n"); resolve(ans); });
    rl._writeToOutput = (str) => {
      if (str.startsWith(question)) orig(question + "*".repeat(rl.line.length));
      else if (str !== "\r\n") orig("*".repeat(str.length));
    };
  });
}

/* A pasted key becomes a Wallet. Errors never repeat what was typed, because some
   ethers parse errors quote the value they rejected. */
function walletFromKey(raw) {
  const hex = String(raw || "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("that is not a private key (expected 64 hex characters)");
  try { return new Wallet("0x" + hex); }
  catch { throw new Error("that private key was rejected"); }
}

async function saveKeystore(name, wallet, password, dir = __dirname) {
  const file = fileFor(name, dir);
  if (fs.existsSync(file)) throw new Error(`${file} already exists and is never overwritten`);
  const json = await wallet.encrypt(password);
  const back = await Wallet.fromEncryptedJson(json, password);
  if (back.address !== wallet.address) throw new Error("the keystore did not decrypt back to the same wallet");
  fs.writeFileSync(file, json, { mode: 0o600, flag: "wx" });
  /* The check above ran on the text in memory. A write cut short would leave a file
     that opens nothing while the only copy of a new key disappears with this process,
     so the file is compared byte for byte before it counts as saved. */
  let onDisk = "";
  try { onDisk = fs.readFileSync(file, "utf8"); } catch {}
  if (onDisk !== json) {
    try { fs.unlinkSync(file); } catch {}
    throw new Error(`${name} did not save correctly. Nothing was sent to that wallet, so just run this again`);
  }
  return file;
}

function keystoreB64(name, dir = __dirname) {
  const file = fileFor(name, dir);
  if (!fs.existsSync(file)) throw new Error(`no ${name} keystore at ${file}`);
  const json = fs.readFileSync(file, "utf8");
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error(`${file} is not an encrypted keystore`); }
  if (!parsed.address || !(parsed.crypto || parsed.Crypto)) throw new Error(`${file} is not an encrypted keystore`);
  return Buffer.from(json, "utf8").toString("base64");
}

/* Straight into clip.exe's stdin, never through a PowerShell pipe, which would
   re-encode the text on the way. */
function copyToClipboard(text) {
  if (process.platform !== "win32") throw new Error("--copy uses the Windows clipboard");
  const r = spawnSync("clip.exe", { input: text, windowsHide: true });
  if (r.error || r.status !== 0) throw new Error("could not reach the clipboard");
}

const CLIPBOARD_ADVICE = [
  "  After pasting anything from this setup (key, password or keystore): press Win+V, then Clear all.",
  "  And check Settings > System > Clipboard > Sync across devices is off.",
];

/* All mainnet keystores share one password, because a host has one
   KEYSTORE_PASSWORD_MAINNET. So if any mainnet keystore exists, the password
   typed must open it, whichever roles this run is creating. */
async function choosePassword(anyExisting) {
  if (anyExisting.length) {
    const pw = await askHidden("Mainnet wallet password, the one you chose before (hidden): ");
    try { await Wallet.fromEncryptedJson(fs.readFileSync(fileFor(anyExisting[0]), "utf8"), pw); }
    catch { throw new Error(`that password does not open ${anyExisting[0]}. All mainnet wallets share one password`); }
    return pw;
  }
  console.log(`Choose the password for the mainnet wallets. Let your password manager generate 24+ random characters.`);
  const pw = await askHidden(`Password, ${MIN_PASSWORD}+ characters (hidden): `);
  if (pw !== pw.trim()) throw new Error("the password starts or ends with a space, which is easy to lose when pasting it into a dashboard");
  if (pw.length < MIN_PASSWORD) throw new Error(`use at least ${MIN_PASSWORD} characters`);
  if (process.env.KEYSTORE_PASSWORD && pw === process.env.KEYSTORE_PASSWORD) {
    throw new Error("that is the testnet password; mainnet needs a different one");
  }
  const pw2 = await askHidden("Same password again (hidden): ");
  if (pw !== pw2) throw new Error("the passwords do not match");
  return pw;
}

async function main() {
  const args = process.argv.slice(2);

  const copyAt = args.indexOf("--copy");
  if (copyAt !== -1) {
    const name = args[copyAt + 1] || "";
    if (!ALL_MAINNET.includes(name)) throw new Error("usage: npm run wallets:mainnet -- --copy provider_mainnet");
    copyToClipboard(keystoreB64(name));
    console.log(`Copied ${name} (still encrypted) to the clipboard.`);
    console.log(`Paste it as ${name.toUpperCase()}_KEYSTORE_B64 in the host's environment settings.`);
    console.log(CLIPBOARD_ADVICE.join("\n"));
    return;
  }

  if (!process.stdin.isTTY) throw new Error("run this in a terminal window; it needs to hide what you type");

  const roles = [...ROLES, ...(args.includes("--with-client") ? ["client_mainnet"] : []), ...(args.includes("--with-deployer") ? ["deployer_mainnet"] : [])];
  const anyExisting = ALL_MAINNET.filter((r) => fs.existsSync(fileFor(r)));
  for (const r of anyExisting) {
    if (!keystoreAddress(fileFor(r))) throw new Error(`${fileFor(r)} is unreadable. Move it out of the chain folder and run this again`);
  }
  for (const r of roles.filter((x) => anyExisting.includes(x))) console.log(`${r}: already set up (${keystoreAddress(fileFor(r))}), leaving it alone`);
  const todo = roles.filter((r) => !anyExisting.includes(r));
  if (!todo.length) { console.log("Nothing to do."); return; }

  /* Addresses that may not become a mainnet hot wallet: the testnet wallets, the
     cold wallet the sweep sends earnings to, and any mainnet wallet already made. */
  const taken = new Map();
  for (const a of TESTNET_ADDRESSES) taken.set(a.toLowerCase(), "a testnet wallet");
  for (const n of TESTNET) { const a = keystoreAddress(fileFor(n)); if (a) taken.set(a, `the testnet ${n} wallet`); }
  if (/^0x[0-9a-fA-F]{40}$/.test(process.env.SWEEP_TO || "")) taken.set(process.env.SWEEP_TO.toLowerCase(), "the cold wallet in SWEEP_TO");
  for (const n of anyExisting) taken.set(keystoreAddress(fileFor(n)), n);

  console.log([
    "",
    "Stubly mainnet wallets",
    "Run this in its own Windows Terminal window, not inside the Claude app.",
    "These wallets sign real transactions from the hosted worker, so they must exist only",
    "for Stubly: never your personal wallet or anything from your own seed phrase.",
    "Everything secret you type shows as stars.",
    "",
  ].join("\n"));

  const password = await choosePassword(anyExisting);
  const made = [];

  for (const name of todo) {
    console.log(`\n${name}: ${ROLE_HELP[name]}`);
    console.log("  2 makes a brand-new wallet (recommended). Don't copy any key until it asks for it.");
    const choice = await ask("  1 = paste an existing private key, 2 = make a brand-new wallet [2]: ");
    if (choice.length > 2) {
      throw new Error("that answer was long enough to be a key, and this question does not hide what you type. If it was a key, treat it as exposed and use a different one");
    }
    let wallet;
    if (choice === "1") wallet = walletFromKey(await askHidden("  Private key (hidden): "));
    else if (choice === "" || choice === "2") wallet = Wallet.createRandom();
    else throw new Error(`answer 1 or 2. Nothing saved for ${name}`);

    const addr = wallet.address.toLowerCase();
    if (taken.has(addr)) throw new Error(`that key is ${taken.get(addr)}; each mainnet role needs its own new wallet. Nothing saved for ${name}`);

    console.log("  Encrypting and checking it opens again (a few seconds)...");
    const file = await saveKeystore(name, wallet, password);
    taken.set(addr, name);
    made.push({ name, address: wallet.address, file });
    console.log(`  Saved. Address: ${wallet.address}`);
  }

  const width = Math.max(...made.map((m) => m.name.length));
  console.log([
    "",
    "Done. New mainnet wallets:",
    ...made.map((m) => `  ${m.name.padEnd(width)}  ${m.address}`),
    "",
    "Before sending any USDC to these addresses:",
    "  1. Put the password in your password manager. Without it nobody, including you, can open these files.",
    "  2. Back up the .keystore.json files from the chain folder (a password manager attachment works).",
    "     They are gitignored, so they never go to GitHub.",
    ...CLIPBOARD_ADVICE,
    "",
    "Launch day, not before. In Render and Vercel (Vercel: mark each one Sensitive, Production only):",
    "  KEYSTORE_PASSWORD_MAINNET        the password, typed into the dashboard",
    "  PROVIDER_MAINNET_KEYSTORE_B64    run: npm run wallets:mainnet -- --copy provider_mainnet, then paste",
    "  EVALUATOR_MAINNET_KEYSTORE_B64   run: npm run wallets:mainnet -- --copy evaluator_mainnet, then paste",
    "  MAINNET_PROVIDER_WALLET / MAINNET_EVALUATOR_WALLET   the addresses above",
  ].join("\n"));
}

if (require.main === module) {
  main().catch((e) => { console.error("\nSTOPPED:", e.message); process.exit(1); });
}

module.exports = { walletFromKey, saveKeystore, keystoreB64, keystoreAddress, fileFor, askHidden, copyToClipboard };
