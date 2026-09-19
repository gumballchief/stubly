# Stubly moves to Robinhood Chain

Owner decisions (2026-09-19): Stubly MOVES to Robinhood Chain, Arc is retired. Buyers pay in
**USDG**. A **new $STUBLY** will be launched on Robinhood Chain by the owner and accepted as
payment; the Arc $STUBLY (0xF7ca…4CcE) is dead and must not appear anywhere. No ETH payments.
Branch: `robinhood` (cut from `stubly-ca`). Nothing here is pushed or deployed until he says so.

Why: no hire-with-escrow marketplace exists on Robinhood Chain mainnet (HoodAgents is offline,
Virtuals ACP settles on Base only, MeshGateway is pay-per-call with 512 USDG all-time). 313 agents
sit in the ERC-8004 registry with 4 reviews. Arbitrum Open House buildathon closes **2026-10-04**
with one top-three slot held for a Robinhood Chain build.

## Verified chain facts (by RPC, 2026-09-19)

| Thing | Value |
|---|---|
| Chain id | 4663 (Arbitrum Orbit), gas paid in **ETH**, about 0.07 gwei |
| Public RPC | https://rpc.mainnet.chain.robinhood.com (eth_getLogs from block 0 works) |
| USDG | 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 6 decimals |
| WETH | 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 |
| Permit2 | 0x000000000022D473030F116dDEE9F6B43aC78BA3 (has code) |
| ERC-8004 identity / reputation | 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 / 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63 |
| Explorer | robinhoodchain.blockscout.com, behind a Cloudflare bot check: servers get 403, use RPC logs |
| Job escrow (ERC-8183) | none on mainnet. We deploy our own, same as Arc |

## Approach

Because this is a move, Robinhood Chain takes over the existing **mainnet slot** (the site and
worker already read every mainnet value from env). No third chain slot. Arc testnet stays as the
free sandbox only if it costs nothing to keep; otherwise it goes too.

## Stages (each ends with something proven)

1. **Escrow deploy script speaks Robinhood.** `chain/deploy-escrow.js` main(): chain 4663, USDG,
   ETH gas wording and minimum balance in ETH. Byte-identity proof against the stored build stays.
   Proof: `npm run escrow:deploy -- --dry-run` prints a price in ETH against chain 4663.
2. **Money path on ETH gas.** `chain/jobs.js`, `worker/sweep.js`, `chain/mainnet-check.js`,
   `worker/health-check.js`: float checks become "USDG balance + ETH for gas" instead of one USDC
   number. Proof: mocked suites green (refund-sim, money-path), plus mainnet:check reads 4663.
3. **Wording and wallet add.** Every "USDC" the buyer sees becomes USDG, "Arc" becomes Robinhood
   Chain; wallet_addEthereumChain uses ETH as native currency. Circle PIN wallets and the
   add/send/withdraw page come off (Circle does not support chain 4663); browser wallets only.
   Old Arc token section, token.json and CA come out. Proof: local site, full hire flow in the
   preview up to the wallet prompt, no "Arc" or "USDC" left in visible text.
4. **Cards and identities.** New cards at `site/agents/robinhood/`, `CARD_PATH` to match. Chain
   desk agents stay off while the explorer blocks servers. Proof: cards validate, registry dry run.
5. **Owner's turn (real money, his terminal):** make fresh wallets, fund deployer/provider/evaluator
   with a few dollars of ETH and provider with a little USDG, run escrow:deploy, then the flip.
6. **First real order.** He hires one agent for 1 USDG. Proof: Completed on chain, report served.
7. **New $STUBLY.** After he launches it and pastes the CA: point tokenpay at it (Permit2 and the
   Uniswap quote path need re-checking on 4663), 20% off + burn as before.
8. **Announce + buildathon entry** before Oct 4. Eligibility (US, existing project) still unverified.

## Open risks

- Demand is unproven: the busiest agent payment rail on the chain has settled 512 USDG in total.
- USDG is Paxos-issued; check it has no transfer restrictions that would break escrow payouts
  (stage 2: simulate fund + complete against a fork or with 1 USDG).
- Render wipes state.json on deploy; the chain-derived recovery already handles this.
