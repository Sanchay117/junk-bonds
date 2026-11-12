//! Read-only views. The page needs nothing else: no indexer and no backend.

use near_sdk::{env, near, AccountId};

use crate::rules::*;
use crate::{Contract, ContractExt, Happening, Holder, Record, HISTORY};

#[near(serializers = [json])]
pub struct BidView {
    pub who: String,
    pub amount: u64,
    pub at_ms: u64,
    /// Why a raccoon bid (see WHY_* in rules.rs). 255 is a player.
    pub why: u8,
}

#[near(serializers = [json])]
pub struct LotView {
    pub round: u64,
    pub kind: u8,
    pub weight: u8,
    pub life: u16,
    pub reserve: u64,
    /// What it would pay over its whole life if the crowd stayed as it is.
    pub book: u64,
    pub per_round: u64,
    pub opens_ms: u64,
    pub closes_ms: u64,
    pub high: u64,
    pub leader: Option<String>,
    /// The least the next bid may be.
    pub next: u64,
    pub bids: Vec<BidView>,
    /// "soon", "live" or "done" (closed and waiting for anyone to poke).
    pub phase: String,
    pub human_bids: u32,
}

#[near(serializers = [json])]
pub struct BondView {
    pub id: u64,
    /// The NEP-171 token id, which is also the junk's own NEAR account.
    pub token_id: String,
    pub kind: u8,
    pub weight: u8,
    pub life: u16,
    pub born: u64,
    pub owner: String,
    pub wallet: u64,
    pub earned: u64,
    pub ask: u64,
    pub in_set: bool,
    pub per_round: u64,
    pub book: u64,
    /// Whether its NEAR account has been created on chain yet.
    pub has_account: bool,
}

#[near(serializers = [json])]
pub struct NpcView {
    pub account: String,
    pub wallet: u64,
    pub mood: u64,
    pub dry: u32,
    pub wins: u32,
    pub burned: u64,
}

#[near(serializers = [json])]
pub struct MeView {
    pub account: String,
    pub registered: bool,
    pub balance: u64,
    /// Held against your standing bid.
    pub locked: u64,
    pub wins: u32,
    pub burned: u64,
    pub earned: u64,
    pub sold: u64,
    pub joined: u64,
}

#[near(serializers = [json])]
pub struct World {
    pub now_ms: u64,
    pub round: u64,
    pub supply: u64,
    pub minted: u64,
    pub burned: u64,
    /// Total weight sharing the emission.
    pub crowd: u64,
    pub lot: LotView,
    pub npcs: Vec<NpcView>,
    pub bonds: Vec<BondView>,
    pub me: Option<MeView>,
    pub feed: Vec<Happening>,
    pub players: u32,
    /// Whether fast-forward would run right now for the given account.
    pub quiet: bool,
}

#[near(serializers = [json])]
pub struct PlayerView {
    pub account: String,
    pub balance: u64,
    pub junk: u32,
    pub junk_wallets: u64,
    pub junk_book: u64,
    pub wins: u32,
    pub burned: u64,
    pub earned: u64,
    pub sold: u64,
    pub joined: u64,
}

#[near(serializers = [json])]
pub struct Offer {
    pub account: String,
    /// What this raccoon thinks the junk is worth to it.
    pub value: u64,
    /// The most it would pay on the market: its discount and its wallet cap applied.
    pub would_pay: u64,
    pub why: u8,
}

#[near(serializers = [json])]
pub struct PersonaView {
    pub account: String,
    pub name: String,
    pub title: String,
    pub comfort: u64,
    pub cap_bps: u64,
    pub horizon: u16,
    pub greed_bps: u64,
    pub set_love_bps: u64,
    pub taste: Vec<u64>,
    pub jump_bps: u64,
    pub late: bool,
    pub noise_bps: u64,
    pub sells: String,
}

#[near(serializers = [json])]
pub struct Rules {
    pub emission: u64,
    pub scavenge_units: u64,
    pub flush_step_bps: u64,
    pub flush_max_bps: u64,
    pub flush_jump_bps: u64,
    pub stipend: u64,
    pub npc_genesis_wallet: u64,
    pub alley_tax_bps: u64,
    pub kinds: Vec<String>,
    pub weight_min: u64,
    pub weight_max: u64,
    pub life_min: u64,
    pub life_max: u64,
    pub set_size: u64,
    pub crowd_floor: u64,
    pub intermission_ms: u64,
    pub lot_ms: u64,
    pub snipe_ms: u64,
    pub slot_ms: u64,
    pub lot_max_ms: u64,
    pub quiet_ms: u64,
    pub fast_forward_max: u32,
    pub reserve_bps: u64,
    pub reserve_min: u64,
    pub raise_bps: u64,
    pub raise_min: u64,
    pub mood_min: u64,
    pub mood_max: u64,
    pub mood_sated: u64,
    pub mood_hungry: u64,
    pub hungry_after: u32,
    pub market_discount_bps: u64,
    pub guest_fuel_millinear: u64,
    pub join_window_ms: u64,
    pub join_window_max: u32,
    pub refuel_ms: u64,
    pub personas: Vec<PersonaView>,
}

#[near]
impl Contract {
    /// Everything the game screen shows, in one call. The lot is shown as of this block:
    /// raccoon bids that are due by now are included even if no transaction has stored them.
    pub fn get_world(&self, account_id: Option<AccountId>) -> World {
        let now = env::block_timestamp();
        let scene = self.scene();
        let mut lot = self.lot.clone();
        Self::advance(&mut lot, &self.npcs, &scene, now);

        let phase = if now < lot.opens {
            "soon"
        } else if now < lot.closes {
            "live"
        } else {
            "done"
        };
        let lot_crowd = scene.crowd + weight_units(lot.weight, false);
        let lot_view = LotView {
            round: lot.round,
            kind: lot.kind,
            weight: lot.weight,
            life: lot.life,
            reserve: lot.reserve as u64,
            book: book_value(lot.weight, lot.life, false, lot_crowd) as u64,
            per_round: (EMISSION * weight_units(lot.weight, false) / lot_crowd.max(1)) as u64,
            opens_ms: lot.opens / 1_000_000,
            closes_ms: lot.closes / 1_000_000,
            high: lot.high() as u64,
            leader: lot.leader().map(|a| a.to_string()),
            next: next_bid(lot.reserve, lot.high()) as u64,
            bids: lot.bids.iter().map(|b| BidView { who: b.who.to_string(), amount: b.amount as u64, at_ms: b.at / 1_000_000, why: b.why }).collect(),
            phase: phase.to_string(),
            human_bids: lot.human_bids,
        };

        let flags = self.set_flags();
        let crowd = scene.crowd;
        let bonds = self
            .bonds
            .iter()
            .zip(&flags)
            .map(|(b, in_set)| BondView {
                id: b.id,
                token_id: Self::junk_account(b.id).to_string(),
                kind: b.kind,
                weight: b.weight,
                life: b.life,
                born: b.born,
                owner: b.owner.to_string(),
                wallet: b.wallet as u64,
                earned: b.earned as u64,
                ask: b.ask as u64,
                in_set: *in_set,
                per_round: (EMISSION * weight_units(b.weight, *in_set) / crowd.max(1)) as u64,
                book: book_value(b.weight, b.life, *in_set, crowd) as u64,
                has_account: b.has_account,
            })
            .collect();

        let npcs = (0..NPCS)
            .map(|i| NpcView {
                account: scene.accounts[i].to_string(),
                wallet: self.npcs[i].wallet as u64,
                mood: self.npcs[i].mood as u64,
                dry: self.npcs[i].dry,
                wins: self.npcs[i].wins,
                burned: self.npcs[i].burned as u64,
            })
            .collect();

        let me = account_id.as_ref().map(|id| {
            let p = self.players.get(id);
            // Use the lot as of now, so a standing bid that a raccoon has beaten shows as free.
            let locked = match lot.bids.last() {
                Some(b) if &b.who == id => b.amount,
                _ => 0,
            };
            MeView {
                account: id.to_string(),
                registered: p.is_some(),
                balance: self.balance_of(id) as u64,
                locked: locked as u64,
                wins: p.map_or(0, |p| p.wins),
                burned: p.map_or(0, |p| p.burned as u64),
                earned: p.map_or(0, |p| p.earned as u64),
                sold: p.map_or(0, |p| p.sold as u64),
                joined: p.map_or(0, |p| p.joined),
            }
        });

        let quiet = lot.human_bids == 0
            && (now >= self.last_human_ns + QUIET_NS || self.last_human.is_none() || self.last_human == account_id);

        World {
            now_ms: now / 1_000_000,
            round: self.round,
            supply: self.supply as u64,
            minted: self.minted as u64,
            burned: self.burned as u64,
            crowd: crowd as u64,
            lot: lot_view,
            npcs,
            bonds,
            me,
            feed: self.feed.clone(),
            players: self.players.len(),
            quiet,
        }
    }

    /// The last `limit` finished rounds, oldest first.
    pub fn get_history(&self, limit: Option<u64>) -> Vec<Record> {
        let limit = limit.unwrap_or(120).min(HISTORY - 1);
        let first = self.round.saturating_sub(limit).max(1);
        (first..self.round).filter_map(|r| self.history.get(&(r % HISTORY)).filter(|rec| rec.round == r).cloned()).collect()
    }

    /// Players in the order they joined, with what they hold.
    pub fn get_players(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<PlayerView> {
        let flags = self.set_flags();
        let crowd = self.crowd();
        self.players
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .map(|(id, p)| {
                let mut junk = 0;
                let mut junk_wallets = 0u128;
                let mut junk_book = 0u128;
                for (b, in_set) in self.bonds.iter().zip(&flags) {
                    if &b.owner == id {
                        junk += 1;
                        junk_wallets += b.wallet;
                        junk_book += book_value(b.weight, b.life, *in_set, crowd);
                    }
                }
                PlayerView {
                    account: id.to_string(),
                    balance: self.balance_of(id) as u64,
                    junk,
                    junk_wallets: junk_wallets as u64,
                    junk_book: junk_book as u64,
                    wins: p.wins,
                    burned: p.burned as u64,
                    earned: p.earned as u64,
                    sold: p.sold as u64,
                    joined: p.joined,
                }
            })
            .collect()
    }

    /// Ask the raccoons what a piece of junk is worth to each of them right now.
    pub fn appraise_junk(&self, token_id: String) -> Vec<Offer> {
        let idx = self.junk_idx(&token_id);
        let crowd = self.crowd();
        let b = &self.bonds[idx];
        (0..NPCS)
            .map(|n| {
                let account = Self::npc_account(n);
                let a = self.npc_appraisal(n, &account, b, crowd);
                let budget = self.npcs[n].wallet * PERSONAS[n].cap_bps / 10_000;
                let would_pay = if b.owner == account { 0 } else { (a.value * MARKET_DISCOUNT_BPS / 10_000).min(budget) };
                Offer { account: account.to_string(), value: a.value as u64, would_pay: would_pay as u64, why: a.why }
            })
            .collect()
    }

    /// True if `account_id` is a living piece of junk, a resident raccoon, or neither.
    pub fn who_is(&self, account_id: AccountId) -> String {
        match self.holder(&account_id) {
            Holder::Npc(i) => format!("resident:{}", PERSONAS[i].name),
            Holder::Junk(_) => "junk".to_string(),
            Holder::Rotted => "rotted".to_string(),
            Holder::Plain => if self.players.contains_key(&account_id) { "player" } else { "stranger" }.to_string(),
        }
    }

    /// Every parameter of the game. None of them can be changed.
    pub fn get_rules(&self) -> Rules {
        let personas = PERSONAS
            .iter()
            .enumerate()
            .map(|(i, p)| PersonaView {
                account: Self::npc_account(i).to_string(),
                name: p.name.to_string(),
                title: p.title.to_string(),
                comfort: p.comfort as u64,
                cap_bps: p.cap_bps as u64,
                horizon: p.horizon,
                greed_bps: p.greed_bps as u64,
                set_love_bps: p.set_love_bps as u64,
                taste: p.taste.iter().map(|t| *t as u64).collect(),
                jump_bps: p.jump_bps as u64,
                late: p.late,
                noise_bps: p.noise_bps,
                sells: match p.sells {
                    Sells::Never => "never".to_string(),
                    Sells::NearlyRotten { life, bps } => format!("junk with {life} rounds or fewer left, at {bps} bps of book"),
                    Sells::Everything { start_bps, drop_bps, floor_bps } => format!("everything, from {start_bps} bps of book down {drop_bps} a round to {floor_bps}"),
                    Sells::WhenBroke { below, bps } => format!("when its wallet is under {below}, at {bps} bps of book"),
                },
            })
            .collect();
        Rules {
            emission: EMISSION as u64,
            scavenge_units: SCAVENGE_UNITS as u64,
            flush_step_bps: FLUSH_STEP_BPS as u64,
            flush_max_bps: FLUSH_MAX_BPS as u64,
            flush_jump_bps: FLUSH_JUMP_BPS as u64,
            stipend: STIPEND as u64,
            npc_genesis_wallet: NPC_GENESIS_WALLET as u64,
            alley_tax_bps: ALLEY_TAX_BPS as u64,
            kinds: KIND_NAMES.iter().map(|k| k.to_string()).collect(),
            weight_min: WEIGHT_MIN,
            weight_max: WEIGHT_MAX,
            life_min: LIFE_MIN,
            life_max: LIFE_MAX,
            set_size: SET_SIZE as u64,
            crowd_floor: CROWD_FLOOR as u64,
            intermission_ms: INTERMISSION_NS / 1_000_000,
            lot_ms: LOT_NS / 1_000_000,
            snipe_ms: SNIPE_NS / 1_000_000,
            slot_ms: SLOT_NS / 1_000_000,
            lot_max_ms: LOT_MAX_NS / 1_000_000,
            quiet_ms: QUIET_NS / 1_000_000,
            fast_forward_max: FAST_FORWARD_MAX,
            reserve_bps: RESERVE_BPS as u64,
            reserve_min: RESERVE_MIN as u64,
            raise_bps: RAISE_BPS as u64,
            raise_min: RAISE_MIN as u64,
            mood_min: MOOD_MIN as u64,
            mood_max: MOOD_MAX as u64,
            mood_sated: MOOD_SATED as u64,
            mood_hungry: MOOD_HUNGRY as u64,
            hungry_after: HUNGRY_AFTER,
            market_discount_bps: MARKET_DISCOUNT_BPS as u64,
            guest_fuel_millinear: GUEST_FUEL_MILLINEAR as u64,
            join_window_ms: JOIN_WINDOW_NS / 1_000_000,
            join_window_max: JOIN_WINDOW_MAX,
            refuel_ms: REFUEL_NS / 1_000_000,
            personas,
        }
    }
}
