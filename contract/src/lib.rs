//! Junk Bonds: a raccoon auction house on NEAR where the trash pays yield.
//!
//! One contract is the whole game:
//!   * `$TRASH`, an NEP-141 token. 1,000 are minted every round to whoever holds junk.
//!     Every winning bid is burned. There is no other faucet and no admin.
//!   * Junk bonds, NEP-171 tokens. Each one is a real NEAR sub-account
//!     (`bond-17.<contract>`) with its own $TRASH wallet that moves with the token.
//!   * Five resident raccoons with their own accounts and wallets, whose bidding rules
//!     run inside the contract (see `rules.rs`), so nobody can patch or switch them off.
//!   * The auction clock. Raccoon bids are a pure function of block time, so a view call
//!     and a transaction always agree on them and the game needs no server or keeper.

mod nft;
mod rules;
mod token;
mod views;

#[cfg(test)]
mod tests;

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PublicKey};

pub use rules::*;

/// Rounds of history kept on chain for the charts.
pub const HISTORY: u64 = 256;
/// Entries kept in the alley feed.
const FEED: usize = 30;

// NEAR allows one receipt 16,384 bytes of logs in at most 100 lines. One round can log up
// to about 5,500 bytes (a coupon event entry for every living piece of junk), so
// fast-forward stops starting new rounds once it has used this much.
const LOG_BYTES_BUDGET: usize = 10_800;
const LOG_LINES_BUDGET: usize = 80;

thread_local! {
    static LOGGED: std::cell::Cell<(usize, usize)> = const { std::cell::Cell::new((0, 0)) };
}

/// Write a log line and count it against this call's log budget.
pub(crate) fn emit(line: &str) {
    LOGGED.with(|c| {
        let (bytes, lines) = c.get();
        c.set((bytes + line.len(), lines + 1));
    });
    env::log_str(line);
}

fn log_budget_left() -> bool {
    let (bytes, lines) = LOGGED.with(|c| c.get());
    bytes <= LOG_BYTES_BUDGET && lines <= LOG_LINES_BUDGET
}

pub const HAP_WON: u8 = 0;
pub const HAP_NO_SALE: u8 = 1;
pub const HAP_ROT: u8 = 2;
pub const HAP_SALE: u8 = 3;
pub const HAP_LISTED: u8 = 4;
pub const HAP_JOINED: u8 = 5;

/// One piece of junk. Its `wallet` is the $TRASH balance of its own NEAR account.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Bond {
    pub id: u64,
    pub kind: u8,
    pub weight: u8,
    /// Rounds left before it rots.
    pub life: u16,
    pub born: u64,
    pub owner: AccountId,
    pub wallet: u128,
    /// Everything it has ever been paid.
    pub earned: u128,
    /// Asking price on the market. 0 means not for sale.
    pub ask: u128,
    pub listed: u64,
}

/// A resident raccoon's changing state. Its fixed rules are in `rules::PERSONAS`.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Npc {
    pub wallet: u128,
    pub mood: u128,
    /// Rounds since it last won a lot.
    pub dry: u32,
    pub wins: u32,
    pub burned: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Bid {
    pub who: AccountId,
    pub amount: u128,
    pub at: u64,
    pub why: u8,
}

/// The lot on the block right now.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Lot {
    pub round: u64,
    pub kind: u8,
    pub weight: u8,
    pub life: u16,
    pub seed: u64,
    pub opens: u64,
    pub closes: u64,
    pub reserve: u128,
    pub bids: Vec<Bid>,
    /// Raccoon decision slots already played out.
    pub slots: u32,
    pub human_bids: u32,
}

impl Lot {
    fn placeholder() -> Self {
        Lot { round: 0, kind: 0, weight: 0, life: 0, seed: 0, opens: 0, closes: 0, reserve: 0, bids: Vec::new(), slots: 0, human_bids: 0 }
    }

    pub fn high(&self) -> u128 {
        self.bids.last().map_or(0, |b| b.amount)
    }

    pub fn leader(&self) -> Option<&AccountId> {
        self.bids.last().map(|b| &b.who)
    }

    /// Record a bid. A bid close to the end pushes the close out, up to the hard cap.
    fn place(&mut self, who: AccountId, amount: u128, at: u64, why: u8) {
        self.bids.push(Bid { who, amount, at, why });
        if self.closes.saturating_sub(at) < SNIPE_NS {
            self.closes = (at + SNIPE_NS).min(self.opens + LOT_MAX_NS);
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Player {
    pub joined: u64,
    pub wins: u32,
    pub burned: u128,
    /// Coupons collected from junk.
    pub earned: u128,
    /// Proceeds from market sales.
    pub sold: u128,
}

/// One finished round, kept for the charts.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Record {
    pub round: u64,
    pub kind: u8,
    pub weight: u8,
    pub life: u16,
    pub price: u64,
    pub winner: String,
    pub human: bool,
    pub bids: u32,
    pub supply: u64,
    pub crowd: u64,
    pub alive: u32,
    pub minted: u64,
    pub burned: u64,
    pub at_ms: u64,
}

/// Something that happened in the alley, for the live feed.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Happening {
    pub round: u64,
    pub what: u8,
    pub who: String,
    pub other: String,
    pub amount: u64,
    pub kind: u8,
}

/// Who an account id is, as far as the ledger cares.
pub(crate) enum Holder {
    Npc(usize),
    Junk(usize),
    Rotted,
    Plain,
}

/// What every raccoon needs to know to bid on the current lot.
pub(crate) struct Scene {
    pub accounts: Vec<AccountId>,
    /// Living junk of the lot's kind each raccoon already holds.
    pub owned: [usize; NPCS],
    /// Total weight sharing the emission right now.
    pub crowd: u128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub(crate) round: u64,
    pub(crate) supply: u128,
    pub(crate) minted: u128,
    pub(crate) burned: u128,
    pub(crate) next_bond: u64,
    pub(crate) bonds: Vec<Bond>,
    pub(crate) npcs: Vec<Npc>,
    pub(crate) lot: Lot,
    pub(crate) accounts: LookupMap<AccountId, u128>,
    pub(crate) players: IterableMap<AccountId, Player>,
    pub(crate) history: LookupMap<u64, Record>,
    pub(crate) feed: Vec<Happening>,
    pub(crate) last_human_ns: u64,
    pub(crate) last_human: Option<AccountId>,
    pub(crate) join_window_start: u64,
    pub(crate) join_window_count: u32,
}

/// What `bid` answers. Races are answered, not panicked, so a late bid still settles the lot.
#[near(serializers = [json])]
pub struct BidResult {
    pub ok: bool,
    pub reason: String,
    pub round: u64,
    pub high: U128,
    pub next: U128,
}

#[near]
impl Contract {
    /// Open the alley. Runs once. There is no owner: nothing is stored about the deployer.
    #[init]
    pub fn new() -> Self {
        let now = env::block_timestamp();
        let mut this = Self {
            round: 1,
            supply: 0,
            minted: 0,
            burned: 0,
            next_bond: 1,
            bonds: Vec::new(),
            npcs: Vec::new(),
            lot: Lot::placeholder(),
            accounts: LookupMap::new(b"a"),
            players: IterableMap::new(b"p"),
            history: LookupMap::new(b"h"),
            feed: Vec::new(),
            last_human_ns: 0,
            last_human: None,
            join_window_start: now,
            join_window_count: 0,
        };

        // The raccoons move in. Each gets a real account and the same starting wallet.
        let seed = mix(Self::entropy(), 0xA11E7);
        let mut grants = Vec::new();
        for i in 0..NPCS {
            let account = Self::npc_account(i);
            Promise::new(account.clone()).create_account().detach();
            this.npcs.push(Npc { wallet: NPC_GENESIS_WALLET, mood: MOOD_START, dry: 0, wins: 0, burned: 0 });
            this.supply += NPC_GENESIS_WALLET;
            this.minted += NPC_GENESIS_WALLET;
            grants.push((account, NPC_GENESIS_WALLET));
        }
        token::log_mint(&grants, "genesis");

        // And each brings a little junk of varied age, so the alley opens mid-economy.
        for i in 0..NPCS {
            for j in 0..GENESIS_JUNK_PER_NPC {
                let s = mix(seed, (i * 16 + j) as u64);
                let id = this.next_bond;
                this.next_bond += 1;
                let owner = Self::npc_account(i);
                this.bonds.push(Bond {
                    id,
                    kind: pick(s, 1, 0, KINDS as u64 - 1) as u8,
                    weight: pick(s, 2, WEIGHT_MIN, WEIGHT_MAX) as u8,
                    life: pick(s, 3, 6, 30) as u16,
                    born: 0,
                    owner: owner.clone(),
                    wallet: 0,
                    earned: 0,
                    ask: 0,
                    listed: 0,
                });
                Promise::new(Self::junk_account(id)).create_account().detach();
                nft::log_mint(&owner, &Self::junk_account(id));
            }
        }

        this.open_lot(now, false);
        this
    }

    // -----------------------------------------------------------------------
    // Getting in
    // -----------------------------------------------------------------------

    /// The doorbell. Creates `<name>.<contract>` as a real NEAR account controlled by
    /// `public_key`, gives it a little NEAR for gas and enrolls it as a player.
    ///
    /// Only the contract account itself may call this. The web page does so with a public
    /// function-call access key that can call nothing but `join`, which is how a guest gets a
    /// named NEAR account in one click with no wallet and no backend.
    pub fn join(&mut self, name: String, public_key: PublicKey) -> Promise {
        require!(env::predecessor_account_id() == env::current_account_id(), "ring the doorbell: join is called with the doorbell key");
        require!(Self::valid_name(&name), "names are 3 to 16 characters, a to z and 0 to 9, starting with a letter");
        let account: AccountId = format!("{}.{}", name, env::current_account_id()).parse().unwrap_or_else(|_| env::panic_str("bad name"));
        require!(!self.players.contains_key(&account), "that name is taken");

        let now = env::block_timestamp();
        if now >= self.join_window_start + JOIN_WINDOW_NS {
            self.join_window_start = now;
            self.join_window_count = 0;
        }
        require!(self.join_window_count < JOIN_WINDOW_MAX, "the alley is full right now, try again in a few minutes");
        self.join_window_count += 1;

        let fuel = NearToken::from_millinear(GUEST_FUEL_MILLINEAR);
        let keep = env::storage_byte_cost().saturating_mul(env::storage_usage() as u128).saturating_add(NearToken::from_millinear(RESERVE_MILLINEAR));
        require!(env::account_balance() >= keep.saturating_add(fuel), "the doorbell is out of NEAR");

        Promise::new(account.clone())
            .create_account()
            .add_full_access_key(public_key)
            .transfer(fuel)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).on_join(account))
    }

    #[private]
    pub fn on_join(&mut self, account: AccountId) -> bool {
        // Enroll only if the account now exists: a taken name fails the creation.
        if env::promise_result_checked(0, 64).is_err() {
            return false;
        }
        self.enroll(&account);
        true
    }

    /// Enroll an account you already have (any NEAR wallet). Returns false if already in.
    pub fn register(&mut self) -> bool {
        let who = env::predecessor_account_id();
        if self.players.contains_key(&who) {
            return false;
        }
        require!(matches!(self.holder(&who), Holder::Plain), "residents and junk cannot register");
        self.enroll(&who);
        true
    }

    // -----------------------------------------------------------------------
    // The auction
    // -----------------------------------------------------------------------

    /// Call dibs on the current lot for `amount` $TRASH.
    pub fn bid(&mut self, amount: U128) -> BidResult {
        let who = env::predecessor_account_id();
        require!(self.players.contains_key(&who), "join the alley first");
        let now = env::block_timestamp();
        let round_before = self.round;
        self.tick(now);

        let next = next_bid(self.lot.reserve, self.lot.high());
        let fail = |reason: &str, c: &Contract| BidResult { ok: false, reason: reason.to_string(), round: c.round, high: U128(c.lot.high()), next: U128(next) };

        if self.round != round_before {
            return fail("sold", self);
        }
        if now < self.lot.opens {
            return fail("not open yet", self);
        }
        if self.lot.leader() == Some(&who) {
            return fail("you already have dibs", self);
        }
        if amount.0 < next {
            return fail("outbid", self);
        }
        if amount.0 > self.balance_of(&who) {
            return fail("not enough $TRASH", self);
        }

        self.lot.place(who.clone(), amount.0, now, WHY_HUMAN);
        self.lot.human_bids += 1;
        self.last_human_ns = now;
        self.last_human = Some(who);
        BidResult { ok: true, reason: String::new(), round: self.round, high: amount, next: U128(next_bid(self.lot.reserve, amount.0)) }
    }

    /// Move the world along: play out raccoon bids up to now and settle the lot if it has
    /// closed. Anyone may call it. It is what the page calls when a lot ends.
    pub fn poke(&mut self) -> u64 {
        self.tick(env::block_timestamp());
        self.round
    }

    /// Let the raccoons run up to `rounds` auctions among themselves in one transaction,
    /// so you can watch the economy move. Works only while no player has dibs on the
    /// current lot and the alley has been quiet (or you were the last one to bid).
    /// Returns how many rounds ran, which can be fewer than asked: a transaction can only
    /// log so much, and every round logs its mints and burns.
    pub fn fast_forward(&mut self, rounds: u32) -> u32 {
        let who = env::predecessor_account_id();
        require!(self.players.contains_key(&who), "join the alley first");
        let now = env::block_timestamp();
        LOGGED.with(|c| c.set((0, 0)));
        self.tick(now);

        let mut done = 0;
        while done < rounds.min(FAST_FORWARD_MAX) && log_budget_left() {
            let quiet = self.last_human.as_ref().map_or(true, |h| *h == who) || now >= self.last_human_ns + QUIET_NS;
            if self.lot.human_bids > 0 || !quiet {
                break;
            }
            self.play_out(u64::MAX);
            self.settle(now, true);
            done += 1;
        }
        if done > 0 {
            // The next lot gets a normal clock so players can bid on it.
            self.lot.opens = now + INTERMISSION_NS;
            self.lot.closes = self.lot.opens + LOT_NS;
        }
        done
    }

    // -----------------------------------------------------------------------
    // Your junk
    // -----------------------------------------------------------------------

    /// Empty the wallet of one piece of junk you own (or all of them) into your own.
    pub fn sweep(&mut self, token_id: Option<String>) -> U128 {
        let who = env::predecessor_account_id();
        let mut total = 0u128;
        for b in self.bonds.iter_mut() {
            if b.owner != who || b.wallet == 0 {
                continue;
            }
            let account = Self::junk_account(b.id);
            if token_id.as_ref().is_some_and(|t| t != account.as_str()) {
                continue;
            }
            token::log_transfer(&account, &who, b.wallet, "sweep");
            total += b.wallet;
            b.wallet = 0;
        }
        if total > 0 {
            self.credit(&who, total);
            if let Some(p) = self.players.get_mut(&who) {
                p.earned += total;
            }
        }
        U128(total)
    }

    /// Put a piece of your junk on the market. Whatever is in its wallet is sold with it.
    pub fn list(&mut self, token_id: String, ask: U128) {
        let who = env::predecessor_account_id();
        let idx = self.junk_idx(&token_id);
        require!(self.bonds[idx].owner == who, "only the owner can sell this junk");
        require!(ask.0 > 0, "name a price");
        self.bonds[idx].ask = ask.0;
        self.bonds[idx].listed = self.round;
        let kind = self.bonds[idx].kind;
        self.note(HAP_LISTED, who.as_str(), &token_id, ask.0, kind);
    }

    pub fn unlist(&mut self, token_id: String) {
        let idx = self.junk_idx(&token_id);
        require!(self.bonds[idx].owner == env::predecessor_account_id(), "only the owner can do that");
        self.bonds[idx].ask = 0;
        self.bonds[idx].listed = 0;
    }

    /// Buy listed junk at its asking price. `max_price` protects you if the ask changed.
    pub fn buy(&mut self, token_id: String, max_price: U128) {
        let who = env::predecessor_account_id();
        let idx = self.junk_idx(&token_id);
        let ask = self.bonds[idx].ask;
        require!(ask > 0, "that junk is not for sale");
        require!(self.bonds[idx].owner != who, "that is already yours");
        require!(ask <= max_price.0, "the price went up");
        require!(matches!(self.holder(&who), Holder::Plain), "junk cannot own junk");
        self.trade(idx, who, ask);
    }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

impl Contract {
    pub(crate) fn npc_account(i: usize) -> AccountId {
        format!("{}.{}", PERSONAS[i].id, env::current_account_id()).parse().unwrap()
    }

    /// The NEAR account that a piece of junk is. Also its NEP-171 token id.
    pub(crate) fn junk_account(id: u64) -> AccountId {
        format!("bond-{}.{}", id, env::current_account_id()).parse().unwrap()
    }

    fn valid_name(name: &str) -> bool {
        let bytes = name.as_bytes();
        (3..=16).contains(&bytes.len())
            && bytes[0].is_ascii_lowercase()
            && bytes.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            && !PERSONAS.iter().any(|p| p.id == name)
    }

    fn entropy() -> u64 {
        let s = env::random_seed_array();
        let mut out = 0u64;
        for chunk in s.chunks(8) {
            let mut word = [0u8; 8];
            word.copy_from_slice(chunk);
            out ^= u64::from_le_bytes(word);
        }
        out
    }

    pub(crate) fn holder(&self, id: &AccountId) -> Holder {
        let me = env::current_account_id();
        let Some(prefix) = id.as_str().strip_suffix(me.as_str()).and_then(|p| p.strip_suffix('.')) else {
            return Holder::Plain;
        };
        if let Some(i) = PERSONAS.iter().position(|p| p.id == prefix) {
            return Holder::Npc(i);
        }
        if let Some(n) = prefix.strip_prefix("bond-").and_then(|n| n.parse::<u64>().ok()) {
            return match self.bonds.iter().position(|b| b.id == n) {
                Some(i) => Holder::Junk(i),
                None => Holder::Rotted,
            };
        }
        Holder::Plain
    }

    pub(crate) fn junk_idx(&self, token_id: &str) -> usize {
        let found = token_id.parse::<AccountId>().ok().map(|a| self.holder(&a));
        match found {
            Some(Holder::Junk(i)) => i,
            _ => env::panic_str("no such junk (it may have rotted)"),
        }
    }

    // ----- the $TRASH ledger -----

    pub(crate) fn balance_of(&self, id: &AccountId) -> u128 {
        match self.holder(id) {
            Holder::Npc(i) => self.npcs[i].wallet,
            Holder::Junk(i) => self.bonds[i].wallet,
            Holder::Rotted => 0,
            Holder::Plain => self.accounts.get(id).copied().unwrap_or(0),
        }
    }

    /// $TRASH held against a standing bid. It cannot be spent until the bid is beaten.
    pub(crate) fn locked(&self, id: &AccountId) -> u128 {
        match self.lot.bids.last() {
            Some(b) if &b.who == id => b.amount,
            _ => 0,
        }
    }

    pub(crate) fn credit(&mut self, id: &AccountId, amount: u128) {
        match self.holder(id) {
            Holder::Npc(i) => self.npcs[i].wallet += amount,
            Holder::Junk(i) => self.bonds[i].wallet += amount,
            Holder::Rotted => env::panic_str("that junk has rotted"),
            Holder::Plain => {
                let balance = self.accounts.get(id).copied().unwrap_or(0);
                self.accounts.insert(id.clone(), balance + amount);
            }
        }
    }

    pub(crate) fn debit(&mut self, id: &AccountId, amount: u128) {
        let balance = self.balance_of(id);
        require!(balance >= self.locked(id) + amount, "not enough $TRASH");
        match self.holder(id) {
            Holder::Npc(i) => self.npcs[i].wallet -= amount,
            Holder::Junk(i) => self.bonds[i].wallet -= amount,
            Holder::Rotted => env::panic_str("that junk has rotted"),
            Holder::Plain => {
                self.accounts.insert(id.clone(), balance - amount);
            }
        }
    }

    fn enroll(&mut self, account: &AccountId) {
        self.players.insert(account.clone(), Player { joined: self.round, wins: 0, burned: 0, earned: 0, sold: 0 });
        self.credit(account, STIPEND);
        self.supply += STIPEND;
        self.minted += STIPEND;
        token::log_mint(&[(account.clone(), STIPEND)], "stipend");
        self.note(HAP_JOINED, account.as_str(), "", STIPEND, 0);
    }

    pub(crate) fn note(&mut self, what: u8, who: &str, other: &str, amount: u128, kind: u8) {
        if self.feed.len() >= FEED {
            self.feed.remove(0);
        }
        self.feed.push(Happening { round: self.round, what, who: who.to_string(), other: other.to_string(), amount: amount as u64, kind });
    }

    // ----- junk and its weight -----

    /// For each living piece of junk, whether it is part of a set of its kind.
    pub(crate) fn set_flags(&self) -> Vec<bool> {
        self.bonds
            .iter()
            .map(|b| self.bonds.iter().filter(|o| o.kind == b.kind && o.owner == b.owner).count() >= SET_SIZE)
            .collect()
    }

    /// Total weight sharing the emission: all living junk plus the residents' scavenging.
    pub(crate) fn crowd(&self) -> u128 {
        self.crowd_with(&self.set_flags())
    }

    fn crowd_with(&self, flags: &[bool]) -> u128 {
        let junk: u128 = self.bonds.iter().zip(flags).map(|(b, in_set)| weight_units(b.weight, *in_set)).sum();
        junk + NPCS as u128 * SCAVENGE_UNITS
    }

    pub(crate) fn scene(&self) -> Scene {
        let accounts: Vec<AccountId> = (0..NPCS).map(Self::npc_account).collect();
        let mut owned = [0usize; NPCS];
        for b in self.bonds.iter().filter(|b| b.kind == self.lot.kind) {
            if let Some(i) = accounts.iter().position(|a| a == &b.owner) {
                owned[i] += 1;
            }
        }
        Scene { accounts, owned, crowd: self.crowd() }
    }

    // ----- the auction clock -----

    /// Play out every raccoon decision slot up to `now`. Pure in the lot: a view runs the
    /// same function on a copy, which is why the page and the chain always agree.
    pub(crate) fn advance(lot: &mut Lot, npcs: &[Npc], scene: &Scene, now: u64) {
        loop {
            let t = lot.opens + (lot.slots as u64 + 1) * SLOT_NS;
            if t > now || t >= lot.closes {
                break;
            }
            lot.slots += 1;
            if let Some((i, amount, why)) = Self::npc_turn(lot, npcs, scene, t) {
                lot.place(scene.accounts[i].clone(), amount, t, why);
            }
        }
    }

    /// One slot: the first raccoon (in a seeded order) that wants the lot at the next price bids.
    fn npc_turn(lot: &Lot, npcs: &[Npc], scene: &Scene, t: u64) -> Option<(usize, u128, u8)> {
        let high = lot.high();
        let next = next_bid(lot.reserve, high);
        let start = (mix(lot.seed, 1_000 + lot.slots as u64) % NPCS as u64) as usize;
        for k in 0..NPCS {
            let i = (start + k) % NPCS;
            if lot.leader() == Some(&scene.accounts[i]) {
                continue;
            }
            let p = &PERSONAS[i];
            if p.late && lot.closes - t > 2 * SLOT_NS {
                continue;
            }
            let in_set = scene.owned[i] + 1 >= SET_SIZE;
            let crowd = scene.crowd + weight_units(lot.weight, in_set);
            let a = appraise(i, npcs[i].wallet, npcs[i].mood, lot.kind, lot.weight, lot.life, scene.owned[i], crowd, lot.seed);
            let limit = a.value.min(npcs[i].wallet * p.cap_bps / 10_000);
            if next > limit {
                continue;
            }
            let amount = next.max(high + (limit - high) * a.jump_bps / 10_000);
            return Some((i, amount, a.why));
        }
        None
    }

    fn play_out(&mut self, now: u64) {
        let scene = self.scene();
        Self::advance(&mut self.lot, &self.npcs, &scene, now);
    }

    pub(crate) fn tick(&mut self, now: u64) {
        self.play_out(now);
        if now >= self.lot.closes {
            self.settle(now, false);
        }
    }

    /// Close the lot: burn the winning bid, mint the junk, pay the round, open the next lot.
    fn settle(&mut self, now: u64, instant: bool) {
        let lot = std::mem::replace(&mut self.lot, Lot::placeholder());
        let burned_before = self.burned;
        let minted_before = self.minted;
        let mut price = 0u128;
        let mut winner = String::new();
        let mut human = false;
        let mut winning_npc = None;

        if let Some(top) = lot.bids.last() {
            price = top.amount;
            winner = top.who.to_string();
            // The only way to get junk: burn $TRASH.
            self.debit(&top.who, price);
            self.supply -= price;
            self.burned += price;
            token::log_burn(&top.who, price, "dibs");
            match self.holder(&top.who) {
                Holder::Npc(i) => {
                    winning_npc = Some(i);
                    self.npcs[i].wins += 1;
                    self.npcs[i].burned += price;
                }
                _ => {
                    human = true;
                    if let Some(p) = self.players.get_mut(&top.who) {
                        p.wins += 1;
                        p.burned += price;
                    }
                }
            }
            let id = self.next_bond;
            self.next_bond += 1;
            self.bonds.push(Bond { id, kind: lot.kind, weight: lot.weight, life: lot.life, born: lot.round, owner: top.who.clone(), wallet: 0, earned: 0, ask: 0, listed: 0 });
            // The junk becomes a real NEAR account. It has no keys and no code, so nobody,
            // not even a past owner, can ever act as it. Only this contract moves its $TRASH.
            let account = Self::junk_account(id);
            Promise::new(account.clone()).create_account().detach();
            nft::log_mint(&top.who, &account);
            self.note(HAP_WON, &winner, account.as_str(), price, lot.kind);
        } else {
            self.note(HAP_NO_SALE, "", "", lot.reserve, lot.kind);
        }

        // Moods: winners calm down, raccoons on a dry spell get hungrier.
        for i in 0..NPCS {
            let n = &mut self.npcs[i];
            if winning_npc == Some(i) {
                n.dry = 0;
                n.mood = n.mood.saturating_sub(MOOD_SATED).max(MOOD_MIN);
            } else {
                n.dry += 1;
                if n.dry >= HUNGRY_AFTER {
                    n.mood = (n.mood + MOOD_HUNGRY).min(MOOD_MAX);
                }
            }
        }

        self.pay_and_age();
        let record = Record {
            round: lot.round,
            kind: lot.kind,
            weight: lot.weight,
            life: lot.life,
            price: price as u64,
            winner,
            human,
            bids: lot.bids.len() as u32,
            supply: self.supply as u64,
            crowd: self.crowd() as u64,
            alive: self.bonds.len() as u32,
            minted: (self.minted - minted_before) as u64,
            burned: (self.burned - burned_before) as u64,
            at_ms: now / 1_000_000,
        };
        self.history.insert(lot.round % HISTORY, record);

        self.round += 1;
        self.npc_market();
        self.open_lot(now, instant);
    }

    /// The emission: split EMISSION between all living junk by weight, into each piece's own
    /// wallet. Then everything ages one round, and what reaches zero rots.
    fn pay_and_age(&mut self) {
        let flags = self.set_flags();
        let crowd = self.crowd_with(&flags);
        let mut grants = Vec::with_capacity(self.bonds.len() + NPCS);
        let mut total = 0u128;
        for (b, in_set) in self.bonds.iter_mut().zip(&flags) {
            let pay = EMISSION * weight_units(b.weight, *in_set) / crowd;
            if pay == 0 {
                continue;
            }
            b.wallet += pay;
            b.earned += pay;
            total += pay;
            grants.push((Self::junk_account(b.id), pay));
        }
        // The residents scavenge their share.
        let scavenged = EMISSION * SCAVENGE_UNITS / crowd;
        if scavenged > 0 {
            for i in 0..NPCS {
                self.npcs[i].wallet += scavenged;
                total += scavenged;
                grants.push((Self::npc_account(i), scavenged));
            }
        }
        self.supply += total;
        self.minted += total;
        token::log_mint(&grants, "");

        let mut i = 0;
        while i < self.bonds.len() {
            self.bonds[i].life -= 1;
            if self.bonds[i].life > 0 {
                i += 1;
                continue;
            }
            // Rot: whatever is left in its wallet goes to its owner, then the token is burned.
            let b = self.bonds.remove(i);
            let account = Self::junk_account(b.id);
            if b.wallet > 0 {
                self.credit(&b.owner, b.wallet);
                token::log_transfer(&account, &b.owner, b.wallet, "rot");
                if let Some(p) = self.players.get_mut(&b.owner) {
                    p.earned += b.wallet;
                }
            }
            nft::log_burn(&b.owner, &account);
            self.note(HAP_ROT, b.owner.as_str(), account.as_str(), b.wallet, b.kind);
        }
    }

    /// Between lots the raccoons use the market: they reprice their own listings by the
    /// rules in `rules.rs`, then at most one of them buys the best deal it can see.
    fn npc_market(&mut self) {
        let flags = self.set_flags();
        let crowd = self.crowd_with(&flags);
        let accounts: Vec<AccountId> = (0..NPCS).map(Self::npc_account).collect();

        for idx in 0..self.bonds.len() {
            let Some(n) = accounts.iter().position(|a| a == &self.bonds[idx].owner) else {
                continue;
            };
            let b = &self.bonds[idx];
            let book = book_value(b.weight, b.life, flags[idx], crowd).max(1);
            let ask = match PERSONAS[n].sells {
                Sells::Never => 0,
                Sells::NearlyRotten { life, bps } => {
                    if b.life <= life {
                        book * bps / 10_000
                    } else {
                        0
                    }
                }
                Sells::Everything { start_bps, drop_bps, floor_bps } => {
                    let age = if b.ask == 0 { 0 } else { (self.round - b.listed) as u128 };
                    book * floor_bps.max(start_bps.saturating_sub(drop_bps * age)) / 10_000
                }
                Sells::WhenBroke { below, bps } => {
                    if self.npcs[n].wallet < below {
                        book * bps / 10_000
                    } else {
                        0
                    }
                }
            };
            let round = self.round;
            let b = &mut self.bonds[idx];
            if ask == 0 {
                b.ask = 0;
                b.listed = 0;
            } else {
                if b.ask == 0 {
                    b.listed = round;
                }
                b.ask = ask.max(1);
            }
        }

        let start = (self.round % NPCS as u64) as usize;
        for k in 0..NPCS {
            let n = (start + k) % NPCS;
            if let Some(idx) = self.best_deal(n, &accounts[n], crowd) {
                let price = self.bonds[idx].ask;
                self.trade(idx, accounts[n].clone(), price);
                break;
            }
        }
    }

    /// The listing raccoon `n` likes most, if any is cheap enough for it.
    fn best_deal(&self, n: usize, me: &AccountId, crowd: u128) -> Option<usize> {
        let budget = self.npcs[n].wallet * PERSONAS[n].cap_bps / 10_000;
        let mut best: Option<(usize, u128)> = None;
        for (idx, b) in self.bonds.iter().enumerate() {
            if b.ask == 0 || &b.owner == me || b.ask > budget {
                continue;
            }
            let a = self.npc_appraisal(n, me, b, crowd);
            if b.ask * 10_000 > a.value * MARKET_DISCOUNT_BPS {
                continue;
            }
            let score = a.value * 1_000 / b.ask;
            if best.is_none_or(|(_, s)| score > s) {
                best = Some((idx, score));
            }
        }
        best.map(|(idx, _)| idx)
    }

    /// What raccoon `n` thinks an existing piece of junk is worth to it.
    pub(crate) fn npc_appraisal(&self, n: usize, me: &AccountId, b: &Bond, crowd: u128) -> Appraisal {
        let owned = self.bonds.iter().filter(|o| &o.owner == me && o.kind == b.kind && o.id != b.id).count();
        appraise(n, self.npcs[n].wallet, self.npcs[n].mood, b.kind, b.weight, b.life, owned, crowd, mix(self.round, b.id))
    }

    /// A market sale: buyer pays the ask, the alley tax is burned, the junk (and whatever is
    /// in its wallet) changes hands in the same receipt.
    fn trade(&mut self, idx: usize, buyer: AccountId, price: u128) {
        let seller = self.bonds[idx].owner.clone();
        let tax = price * ALLEY_TAX_BPS / 10_000;
        self.debit(&buyer, price);
        self.credit(&seller, price - tax);
        self.supply -= tax;
        self.burned += tax;
        token::log_transfer(&buyer, &seller, price - tax, "junk sale");
        if tax > 0 {
            token::log_burn(&buyer, tax, "alley tax");
        }
        let b = &mut self.bonds[idx];
        b.owner = buyer.clone();
        b.ask = 0;
        b.listed = 0;
        let (id, kind) = (b.id, b.kind);
        nft::log_transfer(&seller, &buyer, &Self::junk_account(id), "junk sale");
        if let Some(p) = self.players.get_mut(&seller) {
            p.sold += price - tax;
        }
        self.note(HAP_SALE, buyer.as_str(), seller.as_str(), price, kind);
    }

    fn open_lot(&mut self, now: u64, instant: bool) {
        let seed = mix(mix(Self::entropy(), self.round), self.next_bond ^ (self.supply as u64).rotate_left(17));
        let kind = pick(seed, 1, 0, KINDS as u64 - 1) as u8;
        let weight = pick(seed, 2, WEIGHT_MIN, WEIGHT_MAX) as u8;
        let life = pick(seed, 3, LIFE_MIN, LIFE_MAX) as u16;
        let crowd = self.crowd() + weight_units(weight, false);
        let reserve = (book_value(weight, life, false, crowd) * RESERVE_BPS / 10_000).max(RESERVE_MIN);
        let opens = if instant { now } else { now + INTERMISSION_NS };
        self.lot = Lot { round: self.round, kind, weight, life, seed, opens, closes: opens + LOT_NS, reserve, bids: Vec::new(), slots: 0, human_bids: 0 };
    }
}
