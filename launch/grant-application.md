# Circle Developer Grant Application — Stubly

*Draft for circle.questbook.app. Paste per-field; adjust anything that doesn't sound like you.*

---

## Project name
Stubly

## One-liner
A marketplace where anyone can hire AI agents for real jobs, with USDC held in Circle's ERC-8183 escrow on Arc — work gets judged, the agent gets paid, or the client gets refunded automatically.

## Live product
- **Site:** https://stubly.org
- **Escrow (Circle's ERC-8183, Arc testnet):** 0x0747EEf0706327138c69792bF28Cd525089e4583
- **Agent identities (Circle's ERC-8004 IdentityRegistry):** 17 registered agents, ids #856068–#856136
- **Proof of agent-to-agent commerce:** work order #163256 — an agent (Launch Kit) autonomously opened, funded, judged and settled two sub-orders (#163258, #163261) with two other agents, paying them from its own fee. Every hop is a public transaction on Arc.

## The problem
The agentic economy has rails but no shop floor. Circle shipped escrowed agent jobs (ERC-8183), agent identity (ERC-8004), agent wallets and nanopayments — but a person still can't *hire* an agent and trust the outcome, and an agent still can't safely hire another agent. Hackathon demos proved the primitives; nobody turned them into a working marketplace with real buyers.

## What Stubly does
- **For people:** browse 17 working agents (chain analysis, research, writing, due diligence), pay 1–2 USDC into escrow, get the deliverable or an automatic refund. No crypto knowledge needed: Circle user-controlled wallets let a buyer pay with a 6-digit PIN — no extension, no seed phrase.
- **For agents:** every Stubly agent holds an ERC-8004 identity NFT resolving to a live metadata card. Our Agent Lookup service does due diligence on any registered agent — the report one AI buys before hiring another.
- **Agents hiring agents, today:** the Launch Kit agent decomposes a job and subcontracts pieces through its own escrowed orders — recursive agentic commerce with receipts, live on Arc now.

## Circle products as load-bearing pieces
| Circle product | How Stubly uses it |
|---|---|
| Arc (testnet) | The only chain we run on; USDC-as-gas makes per-job economics legible |
| ERC-8183 escrowed jobs (Circle's deployment) | Every payment in the marketplace — we deliberately built on Circle's contract instead of forking our own |
| ERC-8004 registries (Circle's deployment) | Identity for all 17 agents + our Agent Lookup product reads it |
| Circle user-controlled wallets (Web SDK) | The PIN-wallet flow: wallet creation AND full job payment via PIN challenges |
| USDC / faucet | The only currency; onboarding funnels through faucet.circle.com |
| Planned (M2) | x402 + Nanopayments so agents can buy Stubly services programmatically |

## Traction (all verifiable on-chain)
- 18+ settled work orders, 4 independent hirer wallets on Arc testnet
- Two real end-to-end purchases by a human buyer: one via MetaMask, one entirely via Circle PIN wallet
- First (to our knowledge) recursive agent-subcontract settled on Circle's ERC-8183 deployment
- Built and shipped in 48 hours by a solo builder, pre-mainnet

## Milestones (proposed, $15,000 total)
**M1 — Open shelf ($5,000):** self-serve agent onboarding: an outside builder registers via ERC-8004, lists on Stubly, and receives an escrowed payout to their own wallet. Success: 5 third-party agents listed, 1 external payout settled.
**M2 — Agents as customers ($5,000):** a public API + x402 payment path so agents can buy Stubly jobs programmatically; Chain desk reports purchasable per-call via Nanopayments. Success: 100 agent-initiated orders.
**M3 — Mainnet ($5,000):** deploy on Arc mainnet at launch with a platform-fee switch, hosted worker redundancy, and the first 50 mainnet orders. Success: live on day one of mainnet beta.

## Team
Solo builder (US), self-taught, ships fast with AI-assisted development:
- **Slovey** — company-context layer for AI coding agents, live SaaS, public on npm (`slovey`) — https://slovey.dev
- **Gold Protocol** — Solidity fee-distribution protocol with a 25-test suite + mainnet-proven airdrop tooling — https://gldfi.net
- **Portfolio:** https://yousof.dev · GitHub: https://github.com/gumballchief

## Why fund this
Stubly is the missing application layer for exactly the stack Circle built: it's where ERC-8183, ERC-8004, user-controlled wallets and USDC-as-gas stop being primitives and become a purchase. Every milestone creates net-new USDC activity on Arc from both humans and machines.
