# Junk Bonds

A raccoon auction house on NEAR. Five raccoons with their own wallets auction junk. Each piece of junk pays its holder $TRASH every round until it rots. You outbid them.

Built at NEAR HACKATHON, November 2026. Tracks: `games`, `nfts`, `memecoins`.

| | |
| --- | --- |
| Play | https://sanchay117.github.io/junk-bonds/ |
| Contract | [`junkbonds.testnet`](https://testnet.nearblocks.io/address/junkbonds.testnet) on NEAR testnet |
| Code | one Rust contract in `contract/`, one static page in `web/`, no server |

## What it is

The whole game is one contract. It is the auction house, the token, the NFT collection and the five opponents.

- **$TRASH** is an NEP-141 token. 1,000 are minted every round and split by weight between all living junk. Every winning bid is burned. There is no other faucet and no admin.
- **A junk bond** is an NEP-171 token. Its token id is a NEAR account, for example `bond-103.junkbonds.testnet`. Its coupons land in that account every round. Sell the token and the account's balance goes with it in the same transaction.
- **The raccoons** (Duchess, Pockets, Flip, Yolo, Snatch) are NEAR accounts with real $TRASH balances. Their bidding rules are code inside the contract, in one readable file. Nobody can patch them or switch them off.
- **You** play with no wallet. The page asks the contract for a named NEAR account and you are bidding about three seconds later.

## Try it

Open the Play link. You do not need a wallet, an extension or testnet tokens.

1. Type a name and press **Jump in**. See: your name in the top right as a link to a new NEAR account, `<name>.junkbonds.testnet`, holding 2,000 $TRASH.
2. Watch a lot. See: raccoons bid every 2.5 seconds, each with a reason ("Completes my set.", "Money to burn."). The clock calls "Going once", "Going twice".
3. Press **Dibs at N**. See: "You have dibs". Your $TRASH is held, not spent. If a raccoon beats you it is freed.
4. Win a lot. See: a SOLD stamp, your bid burned (the Burned counter at the top rises by your bid), and the junk under **Your junk**, already holding its first coupon.
5. Press **Fast-forward**. See: the raccoons run a batch of auctions in one transaction, the round counter jumps, and "+N" appears on your junk as each coupon lands.
6. Press **Collect**. See: the coupons move from the junk's account to yours.
7. Press **Sell** on a piece of junk. See: what each raccoon would pay for it right now. List it at or under the best offer and a raccoon buys it between lots.
8. Scroll down. See: the price of every recent lot against the 1,000 minted that round, and the supply curve.

Every action is a transaction. The page lists yours under "Check it yourself" with explorer links.

To check the same things without the page:

```sh
near view junkbonds.testnet get_rules '{}' --networkId testnet
near view junkbonds.testnet get_world '{}' --networkId testnet
near view junkbonds.testnet ft_balance_of '{"account_id":"duchess.junkbonds.testnet"}' --networkId testnet
near view junkbonds.testnet nft_tokens '{"limit":3}' --networkId testnet
```

## How NEAR fits

Each of these is something the product depends on, not a logo.

| NEAR feature | What it does here | Where |
| --- | --- | --- |
| Sub-accounts and named accounts | Every raccoon, every player and every piece of junk a player holds is an account under `junkbonds.testnet`. Only the contract can create names in that space, so an account id ending in `.junkbonds.testnet` that `nft_token` knows cannot be an impostor. | `contract/src/lib.rs`: `join`, `ensure_account`, `holder` |
| Function-call access keys | The "doorbell". The page ships a public key pair that can call `join` and `refuel` on the contract and nothing else. That is how a guest gets a named account in one click with no wallet, no faucet and no backend. | `scripts/deploy.mjs`, `web/src/game.js`: `join` |
| Contract-created accounts | `join` creates `<name>.junkbonds.testnet` with the guest's own key and gas money, then enrolls them in a callback only if the creation succeeded. | `contract/src/lib.rs`: `join`, `on_join` |
| Block timestamps in views | Raccoon bids are a pure function of block time. A view call and a transaction run the same function, so the page shows bids that no transaction has stored yet and the chain agrees when one arrives. No keeper and no server. | `contract/src/lib.rs`: `advance`; `contract/src/views.rs`: `get_world` |
| NEP-141, NEP-145, NEP-148 | $TRASH, with a no-fee storage interface | `contract/src/token.rs` |
| NEP-171, NEP-177, NEP-181 | Junk bonds, with metadata computed from live state on every read | `contract/src/nft.rs` |
| NEP-297 events | Every mint, burn and transfer of both tokens | `contract/src/token.rs`, `contract/src/nft.rs` |

## How it maps to the tracks

**Games With Real Economies** (`games`)

| The track asks for | Here |
| --- | --- |
| A game loop | Every 30 seconds: one auction, with a real decision (bid, wait, or let it go). Every few minutes: collect coupons, complete a set, flip junk to a raccoon that wants it. Every session: grow your net worth against five opponents whose wallets you can read. |
| NPCs with wallets | Five accounts with $TRASH balances that rise and fall. A broke raccoon cannot outbid you. A flush one overpays. |
| Player-owned markets | Any holder can list junk at any price. Raccoons and players buy from it. |
| An economy that evolves without a dev patch | Raccoon moods adapt to wins and dry spells, and their appraisals scale with their wallets. The contract has no setter. |
| Players never notice the chain | No wallet, no popup, no gas prompt. The guest key lives in the tab and signs silently. |
| Pricing rules in one readable file | `contract/src/rules.rs` |

**NFTs That Do Something** (`nfts`): each junk bond is an account that owns money, earns a coupon every round, and hands both over on transfer. See "Junk as accounts" below.

**Memecoins With Mechanics** (`memecoins`): the mechanic is in the contract, every parameter is a constant that `get_rules` returns, and there is no admin key in the contract. See "The money" below.

## The money

All of it is in `contract/src/rules.rs`.

| Rule | Value |
| --- | --- |
| Minted per round | 1,000 $TRASH, split by weight between all living junk and the residents' scavenging (each resident counts as 4 weight units) |
| Burned | every winning bid, and 5% of every market sale |
| Other mints | 3,000 to each resident at genesis, 2,000 to each new player |
| Junk | weight 2 to 6, lives 14 to 36 rounds, then rots |
| A set | three of one kind held by one account: each earns 3/2 |
| A lot | 20 seconds, a bid in the last 7 seconds extends it, hard cap 90 seconds |
| A raise | at least 8% and at least 10 |

What stops the supply running away: a raccoon holding more than its comfort level feels flush. Its appraisals rise 50% for every extra comfort level it holds (capped at 2.5x) and it stops haggling and opens high. Flush raccoons overpay, which burns more than a round mints. Broke raccoons underbid, which burns less.

The unit test `raccoons_alone_keep_the_supply_in_check` runs 600 rounds of raccoons alone and prints this. Supply starts at 15,000 and settles near 35,000 while the average winning bid settles near the 1,000 minted per round:

```
round  supply  crowd  alive  avg price (last 50)  raccoon wallets
   60   28514    255     22                  738  [1429, 4351, 5463, 692, 4241]
  182   32887    210     23                 1042  [2291, 5198, 7215, 742, 4847]
  300   36144    275     23                  928  [1643, 7703, 6748, 370, 8092]
  420   35838    261     25                  986  [2106, 3037, 6960, 454, 8295]
  601   36068    237     23                  989  [2049, 7556, 7440, 981, 6796]
```

Before that rule existed the same test showed supply climbing without limit, past 270,000 by round 600. The test now fails if supply leaves 5,000 to 80,000 or one raccoon hoards more than 40,000.

## The raccoons

| Account | Title | How it bids | When it sells |
| --- | --- | --- | --- |
| `duchess` | Old Money | Pays up to 80% of its appraisal, at most 35% of its wallet. Loves gnomes and disco balls. | Dumps junk with 4 rounds or fewer left |
| `pockets` | The Hoarder | Pays up to 95%. Values the piece that completes a set 90% higher. Loves socks. | Never |
| `flip` | The Flipper | Only counts the next 12 rounds of income, so it buys short-lived junk and bargains. | Lists everything at 135% of book, dropping 5 points a round to 100% |
| `yolo` | The Degen | Pays up to 105%, swings 30% either way per lot, leaps halfway to its limit, risks 90% of its wallet. | Fire sale when its wallet is under 500 |
| `snatch` | The Sniper | Waits for the last two slots before it bids. Loves dead TVs. | Never |

`appraise_junk` returns what each of them would pay for any piece right now and why.

## Junk as accounts

The token id of a piece of junk is the id of the NEAR account that it is. What that means precisely:

- The account is created by the contract the moment a player comes to own the junk (by winning it, buying it or receiving it), or when anyone calls `open_account`. Junk that only raccoons have ever held is a ledger entry under the same reserved name until then. Creating an account costs about three times the gas of the rest of a round, which is why it is not done for every lot.
- The account has **no access keys and no code**. Nobody can ever sign as it.
- Its $TRASH balance (`ft_balance_of("bond-103.junkbonds.testnet")`) is the junk's wallet. Coupons are minted straight into it. Anyone can send $TRASH to it.
- The only way money leaves it is `sweep`, which checks the token's current owner in the same receipt that moves the money, or rot, which pays the owner at that moment.

**Every way a seller could try to keep the money, and why each fails**

| Attempt | Why it fails |
| --- | --- |
| Keep a key to the junk's account | It never had one. `view_access_key_list` on a junk account returns an empty list. |
| Sweep just after the sale | `sweep` only pays the caller for junk the caller owns now. The test `a_sale_in_the_middle_of_a_payout_moves_the_wallet_with_the_junk` sells junk with a coupon inside and shows the seller's sweep returns 0 and the buyer's returns the coupon. |
| Race the transfer | Ownership and wallet are fields of one record, changed in one receipt. There is no cross-contract call between "check the owner" and "move the money". This is the "make the collection the actor" advice in the House of Stake [sharded NFT items draft](https://github.com/houseofstake/tla-contracts/blob/main/docs/sharded-nft-items.md). |
| Leave a listing behind | Any transfer cancels the listing (`nft_transfer_hands_over_the_wallet_and_cancels_the_listing`). |
| Get the junk back through a failed `nft_transfer_call` | The token only returns if the receiver refuses it, and it returns with its wallet (`a_refused_nft_transfer_call_comes_back`). |

What this is not: the junk's account cannot hold or spend anything except $TRASH in a useful way, because it has no code. Native NEAR sent to it is stuck. A version where each item runs a small wallet contract as a NEAR global contract, as the House of Stake draft describes, is the next step and is not built.

## Run it yourself

Requirements: Rust with the `wasm32-unknown-unknown` target (the repo pins `stable` in `contract/rust-toolchain.toml`; near-sdk 5.30 needs Rust 1.95 or newer), and Node 20 or newer.

**Tests.** 36 unit tests, no network needed, about 30 seconds.

```sh
cd contract
cargo test
cargo test raccoons_alone -- --nocapture   # prints the 600-round table above
```

**Build the contract.**

```sh
cd contract
cargo build --target wasm32-unknown-unknown --release
```

`contract/.cargo/config.toml` sets `--cfg near` for the wasm target. Without it near-sdk compiles panics as a bare WebAssembly trap and a failed `require!` reaches the chain with no message. `cargo near build` sets it for you; this repo uses plain `cargo build`.

**Check the live contract end to end.** This does what a guest does in the browser, on testnet, and prints a transaction hash for each step. It needs no account and no tokens.

```sh
cd web && npm install && cd ..
node scripts/e2e.mjs
```

The output of a run on 12 November 2026 is in `evidence/e2e-testnet.txt`: 17 checks, 19 transactions, 0.016 NEAR of gas.

**Run the page locally** against the live contract:

```sh
cd web
npm run dev        # http://localhost:5199
```

**Deploy your own copy.** Creates the account from the testnet faucet, deploys, initialises, adds the doorbell keys and writes `web/src/config.json`.

```sh
node scripts/deploy.mjs <yourname>.testnet
node scripts/warmup.mjs 60      # optional: 60 rounds of history for the charts
cd web && npm run build         # static site in docs/
```

## The live deployment

- Contract: `junkbonds.testnet`. Deployed and initialised in [`B56HJKtqibbfrJuKAqSdby4b871rTq16pMVy34mwB7xH`](https://testnet.nearblocks.io/txns/B56HJKtqibbfrJuKAqSdby4b871rTq16pMVy34mwB7xH).
- A guest joining through the doorbell: [`CyprGS6x...`](https://testnet.nearblocks.io/txns/CyprGS6xALTpA8r5sDhUopwfyozM8fWHZedQBwuyP1Ws)
- A lot settling to a player, which burns the bid, mints the junk and creates its account: [`95HxCnw4...`](https://testnet.nearblocks.io/txns/95HxCnw4qDbdvaLcCuoSRGA1bus2dzDijXQb5mmSFWF3)
- Five rounds of raccoons in one transaction: [`5HYSzZ2H...`](https://testnet.nearblocks.io/txns/5HYSzZ2HoDLep9CGY2VaL9tjrbL2X9RDnQAsZbm1m8TV)
- Sweeping a coupon out of `bond-103.junkbonds.testnet`: [`9nqKw88f...`](https://testnet.nearblocks.io/txns/9nqKw88fGhnFjJQd1TqRCAEX4fjVfzfFhDqyPHYbRBHR)

**The doorbell keys in `web/src/config.json` are public on purpose.** They are function-call access keys limited to `join` and `refuel` on this contract, each with a 3 NEAR gas allowance. They cannot move funds, deploy code or call any other method (the end-to-end script checks that a call to `poke` with one is refused). The contract allows 30 joins and refuels per 10 minutes in total, so the most the public key can cost the contract is 7.5 testnet NEAR per 10 minutes.

## Limits, stated plainly

- **Testnet only.** $TRASH is worth nothing.
- **The stipend is not sybil-resistant.** Anyone can make as many guests as the doorbell's rate limit allows, and each gets 2,000 $TRASH. On mainnet the stipend would have to go or be gated. The only brake today is that stipend money still has to be burned to become junk.
- **The raccoons can be read.** Their appraisals are a function of public state, so a player who reads the contract can compute exactly what each will pay. `appraise_junk` exposes this for the market on purpose. For a live lot the page does not show it.
- **Lot attributes use `env::random_seed`.** A block producer could in principle bias a lot. Nothing of value depends on it.
- **The contract has no owner, but the account still has a full-access key.** Nothing in the contract reads who deployed it and there is no setter or upgrade method. The key that deployed it could still redeploy the code. `scripts/lock.mjs` deletes that key. It has not been run, so that a bug found during judging can still be fixed.
- **No NFT approvals.** `nft_transfer` and `nft_transfer_call` work. `nft_approve` is not implemented; the built-in market replaces it.
- **Fast-forward runs 3 to 5 rounds per transaction**, not 12. A NEAR receipt may log 16,384 bytes, and every round logs a mint event entry for each living piece of junk.
- **A lot nobody settles stays closed.** If no player is online the alley sleeps, and the next visitor's first transaction settles it.

## Layout

```
contract/src/rules.rs    every number and every raccoon rule
contract/src/lib.rs      state, the auction clock, settlement, the market, the doorbell
contract/src/token.rs    $TRASH (NEP-141)
contract/src/nft.rs      junk bonds (NEP-171)
contract/src/views.rs    read-only views, including get_world
contract/src/tests.rs    36 unit tests
web/src/lib/near.js      a small NEAR client: keys, borsh, signing, JSON-RPC
web/src/game.js          state and actions
web/src/app.jsx          the screen
web/src/art.jsx          the junk, the raccoons and the certificate, drawn in SVG
scripts/                 deploy, warm up, end-to-end check, top up, lock
docs/                    the built page (GitHub Pages serves this folder)
evidence/                output of the end-to-end run against the live contract
```

## Disclosures

- All code in this repository was written inside the hackathon window, starting on 12 November 2026. There is no earlier baseline.
- Libraries: `near-sdk` 5.30 (contract); `preact`, `@noble/curves`, `@noble/hashes`, `vite` (page). Fonts from Google Fonts: Bodoni Moda, IBM Plex Mono, Schibsted Grotesk, UnifrakturCook. All artwork is hand-written SVG in `web/src/art.jsx`. No wallet SDK, no template, no indexer.
- The code was written with Claude Code.

## License

MIT. See `LICENSE`.
