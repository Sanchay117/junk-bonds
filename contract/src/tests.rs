//! Unit tests. Run with `cargo test`. They need no network and no WebAssembly toolchain.

use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken, PromiseResult, PublicKey, VMContext};

use crate::*;

const T0: u64 = 1_700_000_000 * SEC;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn house() -> AccountId {
    acct("junk.testnet")
}

fn ctx(now: u64, who: &AccountId, yocto: u128) -> VMContext {
    let mut seed = [0u8; 32];
    for (i, chunk) in seed.chunks_mut(8).enumerate() {
        chunk.copy_from_slice(&mix(now, i as u64).to_le_bytes());
    }
    VMContextBuilder::new()
        .current_account_id(house())
        .predecessor_account_id(who.clone())
        .signer_account_id(who.clone())
        .block_timestamp(now)
        .random_seed(seed)
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .account_balance(NearToken::from_near(50))
        .build()
}

/// Set the block time and the caller for the next call.
fn at(now: u64, who: &AccountId, yocto: u128) {
    testing_env!(ctx(now, who, yocto));
}

fn with_promise_result(now: u64, who: &AccountId, result: PromiseResult) {
    testing_env!(ctx(now, who, 0), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

fn fresh() -> Contract {
    at(T0, &house(), 0);
    Contract::new()
}

fn key() -> PublicKey {
    "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap()
}

/// Put a piece of junk straight into the world.
fn junk(c: &mut Contract, owner: &AccountId, kind: u8, weight: u8, life: u16) -> String {
    let id = c.next_bond;
    c.next_bond += 1;
    c.bonds.push(Bond { id, kind, weight, life, born: c.round, owner: owner.clone(), wallet: 0, earned: 0, ask: 0, listed: 0, has_account: false });
    Contract::junk_account(id).to_string()
}

/// Every $TRASH in existence: raccoon wallets, junk wallets and the given players.
fn ledger_total(c: &Contract, humans: &[AccountId]) -> u128 {
    c.npcs.iter().map(|n| n.wallet).sum::<u128>() + c.bonds.iter().map(|b| b.wallet).sum::<u128>() + humans.iter().map(|h| c.balance_of(h)).sum::<u128>()
}

fn wallet_of(c: &Contract, token: &str) -> u128 {
    c.ft_balance_of(acct(token)).0
}

/// Weight units the five residents' scavenging always adds to the crowd.
const DENS: u128 = NPCS as u128 * SCAVENGE_UNITS;

/// One round's pay for `units` of weight when the junk in the alley totals `junk_units`.
fn pay(units: u128, junk_units: u128) -> u128 {
    EMISSION * units / (junk_units + DENS)
}

// ---------------------------------------------------------------------------
// Genesis
// ---------------------------------------------------------------------------

#[test]
fn the_alley_opens_mid_economy() {
    let c = fresh();
    assert_eq!(c.supply, NPCS as u128 * NPC_GENESIS_WALLET);
    assert_eq!(c.ft_total_supply().0, c.supply);
    assert_eq!(c.bonds.len(), NPCS * GENESIS_JUNK_PER_NPC);
    assert_eq!(c.nft_total_supply().0, c.bonds.len() as u128);
    assert_eq!(c.round, 1);
    assert_eq!(c.lot.opens, T0 + INTERMISSION_NS);
    assert_eq!(c.lot.closes, c.lot.opens + LOT_NS);
    assert!(c.lot.reserve >= RESERVE_MIN);
    assert_eq!(ledger_total(&c, &[]), c.supply);
    // The raccoons are real accounts under the contract, and they hold their own money.
    assert_eq!(c.ft_balance_of(acct("duchess.junk.testnet")).0, NPC_GENESIS_WALLET);
    assert_eq!(c.who_is(acct("yolo.junk.testnet")), "resident:Yolo");
    assert_eq!(c.who_is(acct("bond-1.junk.testnet")), "junk");
    assert_eq!(c.who_is(acct("bond-999.junk.testnet")), "rotted");
}

#[test]
fn every_rule_is_readable() {
    let c = fresh();
    let r = c.get_rules();
    assert_eq!(r.emission as u128, EMISSION);
    assert_eq!(r.personas.len(), NPCS);
    assert_eq!(r.kinds.len(), KINDS);
    assert_eq!(r.personas[2].account, "flip.junk.testnet");
}

// ---------------------------------------------------------------------------
// The auction clock
// ---------------------------------------------------------------------------

#[test]
fn a_view_and_a_transaction_agree_on_raccoon_bids() {
    let mut c = fresh();
    let alice = acct("alice.testnet");
    let mut settled = 0;
    let mut t = T0;
    for _ in 0..400 {
        t += 1_700_000_000; // deliberately out of step with the 2.5 s raccoon slots
        at(t, &alice, 0);
        let seen = c.get_world(None);
        let round = c.round;
        c.poke();
        if c.round == round {
            assert_ne!(seen.lot.phase, "done");
            assert_eq!(seen.lot.bids.len(), c.lot.bids.len());
            for (v, b) in seen.lot.bids.iter().zip(&c.lot.bids) {
                assert_eq!(v.who, b.who.as_str());
                assert_eq!(v.amount as u128, b.amount);
                assert_eq!(v.at_ms, b.at / 1_000_000);
            }
            assert_eq!(seen.lot.closes_ms, c.lot.closes / 1_000_000);
        } else {
            assert_eq!(seen.lot.phase, "done");
            let rec = c.get_history(Some(1)).pop().unwrap();
            assert_eq!(rec.round, round);
            assert_eq!(rec.price, seen.lot.high);
            assert_eq!(rec.winner, seen.lot.leader.unwrap_or_default());
            settled += 1;
        }
    }
    assert!(settled >= 5, "only {settled} lots settled");
}

#[test]
fn playing_out_twice_changes_nothing() {
    let mut c = fresh();
    let t = c.lot.opens + 13 * SEC;
    at(t, &house(), 0);
    c.play_out(t);
    let bids = c.lot.bids.len();
    let closes = c.lot.closes;
    c.play_out(t);
    assert_eq!(c.lot.bids.len(), bids);
    assert_eq!(c.lot.closes, closes);
}

#[test]
fn a_late_bid_pushes_the_close_out_but_never_past_the_cap() {
    let (alice, bob) = (acct("alice.testnet"), acct("bob.testnet"));
    let mut lot = Lot::placeholder();
    lot.opens = T0;
    lot.closes = T0 + LOT_NS;
    lot.place(alice.clone(), 100, T0 + 5 * SEC, WHY_HUMAN);
    assert_eq!(lot.closes, T0 + LOT_NS, "an early bid does not move the close");
    lot.place(bob, 120, T0 + 18 * SEC, WHY_HUMAN);
    assert_eq!(lot.closes, T0 + 18 * SEC + SNIPE_NS);
    lot.closes = T0 + LOT_MAX_NS - SEC;
    lot.place(alice, 150, T0 + LOT_MAX_NS - 2 * SEC, WHY_HUMAN);
    assert_eq!(lot.closes, T0 + LOT_MAX_NS);
}

#[test]
fn the_next_bid_must_beat_the_last_by_the_raise() {
    assert_eq!(next_bid(40, 0), 40);
    assert_eq!(next_bid(40, 40), 50, "small bids go up by the minimum raise");
    assert_eq!(next_bid(40, 1_000), 1_080, "large bids go up by 8%");
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

#[test]
fn a_player_bids_wins_and_the_bid_is_burned() {
    let mut c = fresh();
    let alice = acct("alice.testnet");
    at(T0, &alice, 0);
    assert!(c.register());
    assert!(!c.register(), "registering twice does nothing");
    assert_eq!(c.balance_of(&alice), STIPEND);

    let early = c.bid(U128(1_000));
    assert!(!early.ok);
    assert_eq!(early.reason, "not open yet");

    let open = c.lot.opens;
    at(open + SEC, &alice, 0);
    let low = c.bid(U128(c.lot.reserve - 1));
    assert_eq!(low.reason, "outbid");

    // Deep pockets, so no raccoon can follow (test only).
    c.credit(&alice, 50_000);
    c.supply += 50_000;
    c.minted += 50_000;
    let won = c.bid(U128(20_000));
    assert!(won.ok, "{}", won.reason);
    assert_eq!(c.locked(&alice), 20_000);
    assert_eq!(c.bid(U128(30_000)).reason, "you already have dibs");

    let (round, life, burned) = (c.round, c.lot.life, c.burned);
    at(c.lot.closes + SEC, &alice, 0);
    c.poke();

    assert_eq!(c.round, round + 1);
    let mine: Vec<&Bond> = c.bonds.iter().filter(|b| b.owner == alice).collect();
    assert_eq!(mine.len(), 1);
    assert!(mine[0].wallet > 0, "new junk is paid in the round it is won");
    assert_eq!(mine[0].life, life - 1);
    assert!(mine[0].has_account, "a player's junk is a real account from the moment it is won");
    assert_eq!(c.balance_of(&alice), STIPEND + 50_000 - 20_000);
    assert!(c.burned >= burned + 20_000);
    assert_eq!(c.players.get(&alice).unwrap().wins, 1);
    let rec = c.get_history(Some(1)).pop().unwrap();
    assert!(rec.human);
    assert_eq!(rec.price, 20_000);
    assert_eq!(rec.winner, "alice.testnet");
    assert_eq!(ledger_total(&c, &[alice]), c.supply);
    assert_eq!(c.minted - c.burned, c.supply);
}

#[test]
fn a_bid_after_the_close_settles_the_lot_and_says_sold() {
    let mut c = fresh();
    let alice = acct("alice.testnet");
    at(T0, &alice, 0);
    c.register();
    let round = c.round;
    // Raccoon bids can push the close out, but never past the cap.
    at(c.lot.opens + LOT_MAX_NS + SEC, &alice, 0);
    let late = c.bid(U128(1_000));
    assert!(!late.ok);
    assert_eq!(late.reason, "sold");
    assert_eq!(c.round, round + 1);
    assert_eq!(c.balance_of(&alice), STIPEND, "a late bid costs nothing");
}

#[test]
#[should_panic(expected = "join the alley first")]
fn strangers_cannot_bid() {
    let mut c = fresh();
    at(c.lot.opens + SEC, &acct("stranger.testnet"), 0);
    c.bid(U128(100));
}

#[test]
#[should_panic(expected = "not enough $TRASH")]
fn a_standing_bid_locks_the_money() {
    let mut c = fresh();
    let alice = acct("alice.testnet");
    at(T0, &alice, 0);
    c.register();
    at(c.lot.opens + SEC, &alice, 1);
    assert!(c.bid(U128(c.lot.reserve)).ok);
    c.ft_transfer(acct("bob.testnet"), U128(STIPEND), None);
}

#[test]
fn being_outbid_frees_the_money() {
    let mut c = fresh();
    let (alice, bob) = (acct("alice.testnet"), acct("bob.testnet"));
    at(T0, &alice, 0);
    c.register();
    at(T0, &bob, 0);
    c.register();
    let open = c.lot.opens;
    at(open + SEC, &alice, 0);
    let first = c.bid(U128(c.lot.reserve));
    assert!(first.ok);
    at(open + SEC, &bob, 0);
    assert!(c.bid(first.next).ok);
    assert_eq!(c.locked(&alice), 0);
    assert_eq!(c.locked(&bob), first.next.0);
}

// ---------------------------------------------------------------------------
// The emission
// ---------------------------------------------------------------------------

#[test]
fn the_emission_is_split_by_weight_and_a_set_earns_three_halves() {
    let mut c = fresh();
    c.bonds.clear();
    let (alice, bob) = (acct("alice.testnet"), acct("bob.testnet"));
    let a: Vec<String> = (0..3).map(|_| junk(&mut c, &alice, 1, 2, 10)).collect();
    let b = junk(&mut c, &bob, 4, 3, 10);
    let supply = c.supply;

    c.pay_and_age();
    // Alice holds a set: 3 pieces x (weight 2 x 3) = 18 units. Bob: weight 3 x 2 = 6 units.
    for t in &a {
        assert_eq!(wallet_of(&c, t), pay(6, 24));
    }
    assert_eq!(wallet_of(&c, &b), pay(6, 24));
    assert_eq!(pay(6, 24), 136);
    // The residents scavenge the rest, and only rounding dust goes unminted.
    let minted = c.supply - supply;
    assert_eq!(minted, 4 * pay(6, 24) + NPCS as u128 * pay(SCAVENGE_UNITS, 24));
    assert!(minted <= EMISSION && minted > EMISSION - 10, "minted {minted}");

    // Break the set and the bonus goes away: 4 + 4 + 4 + 6 = 18 units.
    c.bonds[0].owner = bob.clone();
    c.pay_and_age();
    assert_eq!(wallet_of(&c, &a[1]), pay(6, 24) + pay(4, 18));
    assert_eq!(wallet_of(&c, &b), pay(6, 24) + pay(6, 18));
    assert!(pay(6, 18) * 2 == pay(4, 18) * 3 || pay(6, 18) * 2 + 2 >= pay(4, 18) * 3, "weight 3 earns 3/2 of weight 2");
}

#[test]
fn junk_rots_when_its_time_is_up_and_pays_out_what_it_holds() {
    let mut c = fresh();
    c.bonds.clear();
    let alice = acct("alice.testnet");
    let token = junk(&mut c, &alice, 0, 4, 1);
    assert!(c.nft_token(token.clone()).is_some());
    c.pay_and_age();
    assert!(c.bonds.is_empty());
    assert!(c.nft_token(token.clone()).is_none());
    assert_eq!(c.balance_of(&alice), pay(8, 8), "its last coupon goes to its owner when it rots");
    assert_eq!(c.who_is(acct(&token)), "rotted");
    assert_eq!(c.ft_total_supply().0, ledger_total(&c, &[alice]));
}

#[test]
fn with_no_junk_alive_the_residents_scavenge_the_whole_emission() {
    let mut c = fresh();
    c.bonds.clear();
    let supply = c.supply;
    c.pay_and_age();
    assert_eq!(c.supply, supply + EMISSION);
    assert_eq!(c.npcs[0].wallet, NPC_GENESIS_WALLET + EMISSION / NPCS as u128);
}

#[test]
fn a_flush_raccoon_sees_more_value_and_stops_haggling() {
    // Pockets at its comfort level, then holding three times as much.
    let calm = appraise(1, 3_000, MOOD_START, 0, 4, 20, 0, 250, 42);
    let flush = appraise(1, 9_000, MOOD_START, 0, 4, 20, 0, 250, 42);
    assert_eq!(calm.jump_bps, 0, "a comfortable raccoon bids the minimum raise");
    assert_eq!(flush.value, calm.value * 2, "two extra comfort levels double its appraisal");
    assert_eq!(flush.jump_bps, FLUSH_JUMP_BPS);
    assert_eq!(flush.why, WHY_FLUSH);
    assert_eq!(flush_bps(1_000_000, 3_000), FLUSH_MAX_BPS, "and there is a ceiling");
}

// ---------------------------------------------------------------------------
// Junk as accounts
// ---------------------------------------------------------------------------

#[test]
fn a_sale_in_the_middle_of_a_payout_moves_the_wallet_with_the_junk() {
    let mut c = fresh();
    c.bonds.clear();
    let (alice, bob) = (acct("alice.testnet"), acct("bob.testnet"));
    at(T0, &bob, 0);
    c.register();
    let token = junk(&mut c, &alice, 2, 4, 10);
    c.pay_and_age();
    let coupon = pay(8, 8);
    assert_eq!(wallet_of(&c, &token), coupon);

    at(T0, &alice, 0);
    c.list(token.clone(), U128(500));
    let burned = c.burned;
    at(T0, &bob, 0);
    c.buy(token.clone(), U128(500));

    assert_eq!(c.balance_of(&bob), STIPEND - 500);
    assert_eq!(c.balance_of(&alice), 475, "the seller gets the price less the 5% alley tax");
    assert_eq!(c.burned, burned + 25);
    assert_eq!(c.nft_token(token.clone()).unwrap().owner_id, bob);
    assert_eq!(wallet_of(&c, &token), coupon, "the coupon stays inside the junk");

    // The seller has no way back in.
    at(T0, &alice, 0);
    assert_eq!(c.sweep(None).0, 0);
    at(T0, &bob, 0);
    assert_eq!(c.sweep(Some(token.clone())).0, coupon);
    assert_eq!(c.balance_of(&bob), STIPEND - 500 + coupon);
    assert_eq!(ledger_total(&c, &[alice, bob]), c.supply);
}

#[test]
fn junk_becomes_a_real_account_when_a_player_comes_to_own_it() {
    let mut c = fresh();
    let (alice, bob, duchess) = (acct("alice.testnet"), acct("bob.testnet"), acct("duchess.junk.testnet"));
    assert!(c.bonds.iter().all(|b| !b.has_account), "raccoon junk starts as a ledger entry");
    at(T0, &bob, 0);
    c.register();

    // Bought on the market by a player.
    let token = Contract::junk_account(c.bonds[0].id).to_string();
    c.bonds[0].ask = 100;
    at(T0, &bob, 0);
    c.buy(token.clone(), U128(100));
    assert!(c.bonds[0].has_account);
    let created = near_sdk::test_utils::get_created_receipts();
    assert!(created.iter().any(|r| r.receiver_id.as_str() == token), "a CreateAccount receipt went to {token}");

    // Given to a player.
    let gift = Contract::junk_account(c.bonds[1].id).to_string();
    at(T0, &duchess, 1);
    c.nft_transfer(alice, gift, None, None);
    assert!(c.bonds[1].has_account);

    // Or opened by anyone, once.
    let third = Contract::junk_account(c.bonds[2].id).to_string();
    at(T0, &acct("stranger.testnet"), 0);
    assert!(c.open_account(third.clone()));
    assert!(!c.open_account(third));
    assert!(!c.open_account(token), "already a real account");
}

#[test]
fn nft_transfer_hands_over_the_wallet_and_cancels_the_listing() {
    let mut c = fresh();
    c.bonds.clear();
    let (alice, bob) = (acct("alice.testnet"), acct("bob.testnet"));
    let token = junk(&mut c, &alice, 5, 3, 10);
    c.pay_and_age();
    at(T0, &alice, 0);
    c.list(token.clone(), U128(900));
    at(T0, &alice, 1);
    c.nft_transfer(bob.clone(), token.clone(), None, None);

    let t = c.nft_token(token.clone()).unwrap();
    assert_eq!(t.owner_id, bob);
    assert!(t.metadata.unwrap().extra.unwrap().contains(r#""ask":"0""#));
    assert_eq!(c.nft_supply_for_owner(alice.clone()).0, 0);
    assert_eq!(c.nft_tokens_for_owner(bob.clone(), None, None).len(), 1);
    at(T0, &alice, 0);
    assert_eq!(c.sweep(None).0, 0);
    at(T0, &bob, 0);
    assert_eq!(c.sweep(None).0, pay(6, 6));
}

#[test]
#[should_panic(expected = "only the owner can move this junk")]
fn only_the_owner_can_transfer_junk() {
    let mut c = fresh();
    let token = junk(&mut c, &acct("alice.testnet"), 5, 3, 10);
    at(T0, &acct("mallory.testnet"), 1);
    c.nft_transfer(acct("mallory.testnet"), token, None, None);
}

#[test]
#[should_panic(expected = "junk cannot own junk")]
fn junk_cannot_be_given_to_junk() {
    let mut c = fresh();
    let alice = acct("alice.testnet");
    let a = junk(&mut c, &alice, 5, 3, 10);
    let b = junk(&mut c, &alice, 6, 3, 10);
    at(T0, &alice, 1);
    c.nft_transfer(acct(&b), a, None, None);
}

#[test]
fn anyone_can_send_trash_to_a_piece_of_junk() {
    let mut c = fresh();
    let (alice, bob) = (acct("alice.testnet"), acct("bob.testnet"));
    at(T0, &bob, 0);
    c.register();
    let token = junk(&mut c, &alice, 3, 2, 10);
    at(T0, &bob, 1);
    c.ft_transfer(acct(&token), U128(100), Some("gift".to_string()));
    assert_eq!(wallet_of(&c, &token), 100);
    assert_eq!(c.balance_of(&bob), STIPEND - 100);
    at(T0, &alice, 0);
    assert_eq!(c.sweep(None).0, 100);
}

#[test]
#[should_panic(expected = "that junk has rotted")]
fn trash_cannot_be_sent_to_rotted_junk() {
    let mut c = fresh();
    let bob = acct("bob.testnet");
    at(T0, &bob, 0);
    c.register();
    at(T0, &bob, 1);
    c.ft_transfer(acct("bond-4242.junk.testnet"), U128(100), None);
}

#[test]
fn the_metadata_is_live() {
    let mut c = fresh();
    c.bonds.clear();
    let token = junk(&mut c, &acct("alice.testnet"), 7, 5, 9);
    let before = c.nft_token(token.clone()).unwrap().metadata.unwrap();
    assert_eq!(before.title.unwrap(), format!("Disco Ball #{}", c.next_bond - 1));
    assert!(before.extra.unwrap().contains(r#""rounds_left":9"#));
    c.pay_and_age();
    let after = c.nft_token(token).unwrap().metadata.unwrap().extra.unwrap();
    assert!(after.contains(r#""rounds_left":8"#), "{after}");
    assert!(after.contains(&format!(r#""wallet":"{}""#, pay(10, 10))), "{after}");
}

#[test]
fn a_failed_transfer_call_is_refunded() {
    let mut c = fresh();
    let (alice, bob) = (acct("alice.testnet"), acct("bob.testnet"));
    at(T0, &alice, 0);
    c.register();
    at(T0, &alice, 1);
    let _ = c.ft_transfer_call(bob.clone(), U128(400), None, String::new());
    assert_eq!(c.balance_of(&bob), 400);

    with_promise_result(T0, &house(), PromiseResult::Failed);
    assert_eq!(c.ft_resolve_transfer(alice.clone(), bob.clone(), U128(400)).0, 0);
    assert_eq!(c.balance_of(&alice), STIPEND);
    assert_eq!(c.balance_of(&bob), 0);

    // A receiver that keeps 300 and hands back 100.
    at(T0, &alice, 1);
    let _ = c.ft_transfer_call(bob.clone(), U128(400), None, String::new());
    with_promise_result(T0, &house(), PromiseResult::Successful(br#""100""#.to_vec()));
    assert_eq!(c.ft_resolve_transfer(alice.clone(), bob.clone(), U128(400)).0, 300);
    assert_eq!(c.balance_of(&bob), 300);
}

#[test]
fn a_refused_nft_transfer_call_comes_back() {
    let mut c = fresh();
    let (alice, bob) = (acct("alice.testnet"), acct("bob.testnet"));
    let token = junk(&mut c, &alice, 1, 2, 10);
    at(T0, &alice, 1);
    let _ = c.nft_transfer_call(bob.clone(), token.clone(), None, None, String::new());
    assert_eq!(c.nft_token(token.clone()).unwrap().owner_id, bob);
    with_promise_result(T0, &house(), PromiseResult::Failed);
    assert!(!c.nft_resolve_transfer(alice.clone(), bob.clone(), token.clone()));
    assert_eq!(c.nft_token(token).unwrap().owner_id, alice);
}

// ---------------------------------------------------------------------------
// The doorbell
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "ring the doorbell")]
fn only_the_doorbell_key_can_call_join() {
    let mut c = fresh();
    at(T0, &acct("mallory.testnet"), 0);
    let _ = c.join("mallory".to_string(), key());
}

#[test]
fn the_doorbell_enrolls_a_guest_only_if_the_account_was_created() {
    let mut c = fresh();
    at(T0, &house(), 0);
    let _ = c.join("rocky".to_string(), key());
    let rocky = acct("rocky.junk.testnet");
    assert!(!c.players.contains_key(&rocky), "nothing is granted until the account exists");

    with_promise_result(T0, &house(), PromiseResult::Successful(vec![]));
    assert!(c.on_join(rocky.clone()));
    assert_eq!(c.balance_of(&rocky), STIPEND);
    assert_eq!(c.who_is(rocky.clone()), "player");

    with_promise_result(T0, &house(), PromiseResult::Failed);
    assert!(!c.on_join(acct("ghost.junk.testnet")));
    assert_eq!(c.balance_of(&acct("ghost.junk.testnet")), 0);
    assert_eq!(ledger_total(&c, &[rocky]), c.supply);
}

#[test]
fn guest_names_are_checked() {
    for good in ["rocky", "bandit9", "abc"] {
        assert!(Contract::valid_name(good), "{good}");
    }
    for bad in ["ab", "Rocky", "rock-y", "9lives", "duchess", "flip", "a.b", "averyveryverylongname", "bond-7"] {
        assert!(!Contract::valid_name(bad), "{bad}");
    }
}

#[test]
#[should_panic(expected = "the alley is full")]
fn the_doorbell_is_rate_limited() {
    let mut c = fresh();
    for i in 0..=JOIN_WINDOW_MAX {
        at(T0 + i as u64, &house(), 0);
        let _ = c.join(format!("guest{i}"), key());
    }
}

#[test]
fn the_doorbell_window_resets() {
    let mut c = fresh();
    for i in 0..JOIN_WINDOW_MAX {
        at(T0 + i as u64, &house(), 0);
        let _ = c.join(format!("guest{i}"), key());
    }
    assert_eq!(c.join_window_count, JOIN_WINDOW_MAX);
    at(T0 + JOIN_WINDOW_NS, &house(), 0);
    let _ = c.join("latecomer".to_string(), key());
    assert_eq!(c.join_window_count, 1);
}

#[test]
fn a_guest_can_be_refuelled_but_not_too_often() {
    let mut c = fresh();
    at(T0, &house(), 0);
    let _ = c.join("rocky".to_string(), key());
    with_promise_result(T0, &house(), PromiseResult::Successful(vec![]));
    assert!(c.on_join(acct("rocky.junk.testnet")));

    at(T0 + REFUEL_NS, &house(), 0);
    let _ = c.refuel("rocky".to_string());
    assert_eq!(c.join_window_count, 2, "a refuel counts against the same window as a join");
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        at(T0 + REFUEL_NS + SEC, &house(), 0);
        let _ = c.refuel("rocky".to_string());
    }));
    assert!(early.is_err(), "a second refuel right away is refused");
}

#[test]
#[should_panic(expected = "no such guest")]
fn only_enrolled_guests_can_be_refuelled() {
    let mut c = fresh();
    at(T0 + REFUEL_NS, &house(), 0);
    let _ = c.refuel("nobody".to_string());
}

#[test]
#[should_panic(expected = "ring the doorbell")]
fn only_the_doorbell_key_can_call_refuel() {
    let mut c = fresh();
    at(T0, &acct("mallory.testnet"), 0);
    let _ = c.refuel("mallory".to_string());
}

// ---------------------------------------------------------------------------
// Fast-forward
// ---------------------------------------------------------------------------

#[test]
fn fast_forward_runs_only_while_the_alley_is_quiet() {
    let mut c = fresh();
    let (alice, bob) = (acct("alice.testnet"), acct("bob.testnet"));
    at(T0, &alice, 0);
    c.register();
    at(T0, &bob, 0);
    c.register();

    at(T0 + 10 * SEC, &alice, 0);
    assert_eq!(c.fast_forward(3), 3);
    assert_eq!(c.round, 4);
    assert_eq!(c.lot.opens, T0 + 10 * SEC + INTERMISSION_NS, "the next lot gets a normal clock");
    at(T0 + 11 * SEC, &alice, 0);
    let ran = c.fast_forward(100);
    assert!((2..=FAST_FORWARD_MAX).contains(&ran), "one call is capped by the rules and by the log budget, ran {ran}");

    // Bob calls dibs late in the lot, with pockets too deep for any raccoon to follow
    // (test only). Nobody can skip a lot a player is bidding on.
    c.credit(&bob, 50_000);
    c.supply += 50_000;
    c.minted += 50_000;
    let t = c.lot.closes - SEC;
    at(t, &bob, 0);
    let bid = c.bid(U128(20_000));
    assert!(bid.ok, "{}", bid.reason);
    at(t + SEC, &alice, 0);
    assert_eq!(c.fast_forward(3), 0);

    // The lot ends. Bob was the last to bid, so Alice still has to wait for quiet. Bob does not.
    let after = t + SNIPE_NS + SEC;
    assert!(after < t + QUIET_NS);
    at(after, &alice, 0);
    assert_eq!(c.fast_forward(3), 0);
    at(after, &bob, 0);
    assert_eq!(c.fast_forward(2), 2);
    at(t + QUIET_NS, &alice, 0);
    assert_eq!(c.fast_forward(2), 2);
}

// ---------------------------------------------------------------------------
// The whole economy
// ---------------------------------------------------------------------------

#[test]
fn chaos_keeps_the_books_balanced() {
    let mut c = fresh();
    let humans = [acct("alice.testnet"), acct("bob.testnet"), acct("carol.testnet")];
    for h in &humans {
        at(T0, h, 0);
        c.register();
    }
    let mut t = T0;
    let mut rng = 1u64;
    let (mut bids, mut buys, mut lists) = (0, 0, 0);
    for step in 0..3_000u64 {
        t += 900_000_000;
        rng = mix(rng, step);
        let who = &humans[(rng % 3) as usize];
        at(t, who, 0);
        match (rng >> 8) % 8 {
            0..=2 => {
                let w = c.get_world(Some(who.clone()));
                if w.lot.phase == "live" {
                    if c.bid(U128(w.lot.next as u128)).ok {
                        bids += 1;
                    }
                } else {
                    c.poke();
                }
            }
            3 => {
                c.sweep(None);
            }
            4 => {
                if let Some(b) = c.bonds.iter().find(|b| &b.owner == who) {
                    let token = Contract::junk_account(b.id).to_string();
                    c.list(token, U128(1 + ((rng >> 20) % 900) as u128));
                    lists += 1;
                }
            }
            5 => {
                let free = c.balance_of(who) - c.locked(who);
                if let Some(b) = c.bonds.iter().find(|b| b.ask > 0 && &b.owner != who && b.ask <= free) {
                    let (token, ask) = (Contract::junk_account(b.id).to_string(), b.ask);
                    c.buy(token, U128(ask));
                    buys += 1;
                }
            }
            6 => {
                c.poke();
            }
            _ => {
                c.fast_forward(2);
            }
        }
        assert_eq!(ledger_total(&c, &humans), c.supply, "books out of balance at step {step}");
        assert_eq!(c.minted - c.burned, c.supply, "mint and burn out of step at {step}");
        assert_eq!(c.crowd(), c.get_world(None).crowd as u128);
    }
    assert!(c.round > 60, "only {} rounds", c.round);
    assert!(bids > 50 && lists > 20 && buys > 5, "bids {bids} lists {lists} buys {buys}");
    assert!(c.bonds.len() < 120);
}

/// Sixty and six hundred rounds of raccoons alone. Prints the trajectory:
/// `cargo test raccoons_alone -- --nocapture`
#[test]
fn raccoons_alone_keep_the_supply_in_check() {
    let mut c = fresh();
    let alice = acct("alice.testnet");
    at(T0, &alice, 0);
    c.register();
    let mut t = T0;
    let (mut low, mut high) = (u128::MAX, 0u128);
    println!("round  supply  crowd  alive  avg price (last 50)  raccoon wallets");
    let mut next_print = 60;
    let mut calls = 0;
    while c.round <= 600 {
        t += 30 * SEC;
        at(t, &alice, 0);
        let ran = c.fast_forward(FAST_FORWARD_MAX);
        assert!(ran >= 2, "a call should always fit a couple of rounds, ran {ran}");
        calls += 1;
        low = low.min(c.supply);
        high = high.max(c.supply);
        if c.round >= next_print {
            next_print += 60;
            let hist = c.get_history(Some(50));
            let sold: Vec<u64> = hist.iter().filter(|r| r.price > 0).map(|r| r.price).collect();
            let avg = if sold.is_empty() { 0 } else { sold.iter().sum::<u64>() / sold.len() as u64 };
            let wallets: Vec<u128> = c.npcs.iter().map(|n| n.wallet).collect();
            println!("{:>5}  {:>6}  {:>5}  {:>5}  {:>19}  {:?}", c.round, c.supply, c.crowd(), c.bonds.len(), avg, wallets);
        }
    }
    println!("{} rounds in {calls} fast-forward calls", c.round - 1);
    assert_eq!(ledger_total(&c, &[alice]), c.supply);
    let sales = c.get_history(Some(200)).iter().filter(|r| r.price > 0).count();
    assert!(sales > 100, "the raccoons stopped bidding: {sales} of 200 lots sold");
    assert!(c.burned > 400_000, "burned {}", c.burned);
    assert!(low > 5_000 && high < 80_000, "supply ran away: {low}..{high}");
    let richest = c.npcs.iter().map(|n| n.wallet).max().unwrap();
    assert!(richest < 40_000, "one raccoon hoarded {richest}");
    assert!(c.bonds.len() <= 60, "{} pieces alive", c.bonds.len());
}
