# agent-market — Stubly, the agent-hire marketplace (moving to Robinhood Chain)

People pay a dollar stablecoin to hire AI agents for jobs. Money sits in an ERC-8183 escrow: job
delivered → agent paid; rejected/expired → client refunded. We build the marketplace + orchestrator +
house agents, NOT the escrow standard. The escrow is Stubly's own deployment of the CC0 reference
code (byte-identical to the one Circle runs on Arc testnet) with every admin role renounced.

**2026-09-19: Stubly is MOVING from Arc to Robinhood Chain.** The owner considers Arc and the Arc
$STUBLY dead. Work lives on branch `robinhood`; staged plan in `PLAN-ROBINHOOD.md` and
`~/.claude/plans/immutable-soaring-pebble.md`. Robinhood Chain takes over the code's **mainnet slot**
(everything reads MAINNET_* env). Arc testnet stays only as an unpromoted sandbox behind `?chain=testnet`.
Never show the old Arc token address anywhere. A new $STUBLY on Robinhood Chain comes later.

## Hard facts

| Thing | Value |
|---|---|
| Live chain | **Robinhood Chain**, chain-id **4663** (Arbitrum Orbit). Gas = **ETH**, not the dollar token |
| RPC | https://rpc.mainnet.chain.robinhood.com (public, eth_getLogs from block 0 works) |
| Dollar token | **USDG** `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals (Paxos; can freeze/pause). Code keys are still named USDC |
| Escrow | none existed; `npm run escrow:deploy` deploys ours and writes `chain/escrow-robinhood.json` |
| ERC-8004 identity / reputation | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` / `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` (has code) |
| Explorer | https://robinhoodchain.blockscout.com — behind a Cloudflare bot check, servers get 403; read logs by RPC |
| Per-chain words | `CFG.CURRENCY`, `CFG.CHAIN_NAME`, `CFG.GAS_COIN`, `CFG.GAS_IN_PAYMENT_TOKEN` in `chain/config.js`: never hardcode "USDC"/"Arc" in text a customer reads |
| Sandbox | Arc testnet, chain-id 5042002, gas = USDC, Circle escrow `0x0747EEf0706327138c69792bF28Cd525089e4583`, USDC `0x3600…0000`, explorer testnet.arcscan.app, faucet.circle.com |
| Retired | Arc mainnet 5042: our escrow `0x21285e5F3D79717bAA73F1Fccdc101DfE0be4B9D` (`chain/escrow-mainnet.json`), cards in `site/agents/mainnet`, data under `5042/` in Blob |

## ERC-8183 flow (from Circle's quickstart)

createJob(provider, evaluator, expiredAt, description, hook) → provider setBudget(jobId, amount, optParams)
→ client USDC.approve + fund(jobId, optParams) → provider submit(jobId, bytes32 deliverable, optParams)
→ evaluator complete(jobId, reason, optParams) | reject(...). Status enum: 0 Open, 1 Funded,
2 Submitted, 3 Completed, 4 Rejected, 5 Expired. Exact reject/refund signatures: confirm from the
verified ABI (chain/abi.js fetches + caches it from Blockscout).

## House rules

- Style follows `gold/protocol` (solc 0.8.26 if we ever write contracts; ethers v6; keeper-style
  workers: staticCall first, DRY_RUN default, crash-safe state.json).
- Keys: encrypted keystores only, never plaintext in .env. Testnet keystores come from
  `chain/make-wallets.js` and may use KEYSTORE_PASSWORD from .env. Mainnet keystores come from
  `npm run wallets:mainnet` (typed password, never in .env) and open only with
  KEYSTORE_PASSWORD_MAINNET, which lives in the host's dashboard because a hosted worker must
  sign unattended. That is deliberate: do not "fix" it back to an interactive prompt on hosts.
- Site: static HTML + `api/` Vercel serverless, no framework (gold pattern). No AI-slop design.
- Stage tracker: S0 foundations ✅/… S1 money-loop e2e, S2 orchestrator+house agents,
  S3 marketplace site, S4 Circle embedded wallets, S5 ERC-8004 registry + open supply,
  S6 naming (vet BEFORE showing candidates) + launch + grant application.

## Circle SDK bundle (Stage 4)

`site/assets/circle-sdk.js` is a vendored browser build of `@circle-fin/w3s-pw-web-sdk`
(CJS + Node deps, so it must be bundled; esbuild native binary is blocked by this
machine's npm script policy — use esbuild-wasm). Rebuild with:

```
npx --yes esbuild-wasm node_modules/@circle-fin/w3s-pw-web-sdk/dist/src/index.js --bundle --format=iife --global-name=CircleW3S --outfile=site/assets/circle-sdk.js --minify --platform=browser --alias:buffer=buffer --alias:crypto=crypto-browserify --alias:stream=stream-browserify --alias:util=util --alias:events=events --alias:string_decoder=string_decoder --alias:vm=./shims/empty.js --inject:./shims/node-globals.js --define:global=window --define:process.env.NODE_ENV='"production"'
```

Circle env: CIRCLE_APP_ID (public, set) + CIRCLE_API_KEY (secret, user pastes into .env
from console.circle.com → API & Client Keys → Standard/Testnet).

## Commands

- `npm run wallets` — generate client/provider/evaluator testnet keystores (prints addresses to faucet-fund)
- `npm run escrow:deploy -- --dry-run` — proves the stored escrow build is Circle's code and prices the Robinhood Chain deploy in ETH; without --dry-run it deploys from deployer_mainnet (typed password) and gives up admin
- `npm run rehearse` — the whole money path (deploy, paid order, rejected order, abandoned order) on a private Hardhat fork of Robinhood Chain with the real USDG code; needs Hardhat from `../gold/protocol`
- `npm run mainnet:check` — read-only readiness list for Robinhood Chain (escrow, USDG, wallets' USDG and ETH, cards)
- `npm run mainnet:flip -- --dry-run` — shows every step of the move (Arc wind-down check, Vercel env, deploy, identities, worker)
- `npm run e2e:dry` — connectivity check: chain-id, balances, contract code present
- `npm run e2e` — full job lifecycle on testnet (create→budget→fund→submit→complete, then refund paths)
- `npm run site` — local stand-in for Vercel on :8791 (static + `api/`); needed by the crew script
- `npm run crew:dry "…"` — plan a crew from a sentence, no chain writes
- `npm run crew "…"` — the same crew for real: one escrow per agent, created, funded and settled
- `npm run crew -- --break=2 "…"` — same, but step 2 is funded and never delivered, then its
  deadline is run out and the refund claimed: the partial-refund proof, one paid + one refunded

## Crews (multi-agent jobs)

`/crew` + `POST /api/plan` turn one sentence into 1–5 agents. **Each agent gets its own
ERC-8183 work order** — deliberately not one order for the whole crew. ERC-8183 pays out
in full or refunds in full, so a single order cannot express "four delivered, refund the
fifth"; separate orders can, and a failed step is refunded to the buyer by Circle's
contract with nothing of ours ever holding the money. The cost is one wallet confirmation
per agent, softened by the standing USDC allowance (approve once, then fund only).
`launch-kit` is excluded from crews — it is itself a fixed 2-agent bundle, and the planner
replaces it.

Crew size is not left to the model alone. At temperature 0 the same sentence came back as
two agents one minute and one the next, so `keywordAll()` in `site/api/_shared.js` adds any
agent the request names outright that the model missed (flagged `fromWords`). The model can
still only name catalog keys, prices still come from the catalog, and every row on `/crew`
has a **remove** control — nothing is forced into a crew and nothing is charged until the
buyer funds each order themselves.

`chain/jobs.js` decodes ERC-8183's custom errors, so a revert now reads `WrongStatus()`
rather than "unknown custom error", and named reverts are no longer retried three times.

## Videos (promo/)

`promo/` is a Remotion project, gitignored, and lives only on this machine. Films are code:
`src/<name>-film.tsx`, registered as a `<Composition>` in `src/Root.tsx`.

**The sound rule, and it is the whole thing.** One real music track, and the picture is cut TO it.
No click, typing or whoosh effects as the soundtrack — the older films (`mainnet-film.tsx`,
`helpdesk-film.tsx`) use them and that is exactly what made them feel cheap. Pick the tempo first,
then set every scene length in beats. Never rip a track from a reference video.

`node gen-music.js` writes `public/stubly-track.wav`: an original 22s track synthesised to the
film's own grid (A minor, 120 BPM, pad and riser in, drop at 3.0s under the logo, the sub lifting
for an eighth before each cut, a 1.5s fade out). It is ours, so there is no licence to buy and no
track to wait on. A bought track replaces it by matching its tempo in the film's SC table. I cannot
hear audio — I can only write it to the grid — so the owner judges any track by ear.

**The reference he approved** (2026-09-19): Claimr's 21.6s launch film — soft kinetic type, one idea
per screen, 3-6 words, words entering with blur, one accent word that swaps, real brand logos, a
count-up number, a stamp beat, logo reveal at both ends. Match its quality, never clone its layout
or colors.

**Shape:** 15-25s, 1920x1080, about 9 scenes. `robinhood-film.tsx` is the current template:
120 BPM, 1 bar = 60 frames = 2s at 30fps, every scene boundary on a bar line, the logo landing on
the drop (frame 90), a fast cross-dissolve at every cut, and no audio of its own so a track can be
dropped in with `<Audio src={staticFile("track.mp3")} />` in `Root.tsx`.

**Working method:** check framing with stills BEFORE a full render, it catches layout bugs in
seconds instead of minutes.

```
npx remotion still src/index.ts <Id> out/x.png --frame=N     # one frame, ~10s
npx remotion render src/index.ts <Id> out/<name>.mp4         # ~25s per 14s of 1080p
```

**Logos are never redrawn** (house rule): the Robinhood feather in `promo/public/` is Robinhood's
own SVG from their CDN. Any film that puts our mark next to theirs uses an arrow, never an "x", and
carries "not affiliated with Robinhood" — we have no partnership.

**X upload is manual.** Video upload cannot be automated: X's composer never reads a file set by
automation and the upload silently never starts. The owner attaches every video by hand.
