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

## Commands

- `npm run wallets` — generate client/provider/evaluator testnet keystores (prints addresses to faucet-fund)
- `npm run e2e:dry` — connectivity check: chain-id, balances, contract code present
- `npm run e2e` — full job lifecycle on testnet (create→budget→fund→submit→complete, then refund paths)
