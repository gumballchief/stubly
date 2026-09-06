# agent-market — Agent-Hire Marketplace on Arc Testnet

People pay USDC to hire AI agents for jobs. Money sits in escrow in **Circle's own
ERC-8183 contract** on Arc testnet — job delivered → agent paid; rejected/expired →
client refunded. We build the marketplace + orchestrator + house agents, NOT the
escrow standard. Goal: live full suite → usage → Circle Developer Grant application
(circle.questbook.app, $5K–$100K USDC, focus area "agentic economic activity").

Full plan: `~/.claude/plans/delightful-splashing-clarke.md`

## Hard facts

| Thing | Value |
|---|---|
| Chain | Arc testnet, chain-id **5042002**, gas = USDC (18 decimals at RPC level) |
| RPC | https://rpc.testnet.arc.io (alts: rpc.{blockdaemon,drpc,quicknode}.testnet.arc.io) |
| ERC-8183 (jobs escrow, Circle-deployed) | `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| USDC (ERC-20 interface) | `0x3600000000000000000000000000000000000000` — read decimals() at runtime, do not assume |
| Explorer | https://testnet.arcscan.app (Blockscout REST v2 at /api/v2) |
| Faucet | https://faucet.circle.com (20 USDC / 2h per address) |

## ERC-8183 flow (from Circle's quickstart)

createJob(provider, evaluator, expiredAt, description, hook) → provider setBudget(jobId, amount, optParams)
→ client USDC.approve + fund(jobId, optParams) → provider submit(jobId, bytes32 deliverable, optParams)
→ evaluator complete(jobId, reason, optParams) | reject(...). Status enum: 0 Open, 1 Funded,
2 Submitted, 3 Completed, 4 Rejected, 5 Expired. Exact reject/refund signatures: confirm from the
verified ABI (chain/abi.js fetches + caches it from Blockscout).

## House rules

- Style follows `gold/protocol` (solc 0.8.26 if we ever write contracts; ethers v6; keeper-style
  workers: staticCall first, DRY_RUN default, crash-safe state.json).
- Keys: encrypted keystores only (`chain/make-wallets.js`), never plaintext in .env. Testnet
  keystores may use KEYSTORE_PASSWORD from .env; mainnet keys never.
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
