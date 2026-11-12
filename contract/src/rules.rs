//! Every number and every raccoon rule in Junk Bonds lives in this one file.
//!
//! Nothing here can change after deployment. There is no setter, no owner and no
//! upgrade method, and `get_rules` returns all of it so anyone can read the same table.

// ---------------------------------------------------------------------------
// Money: $TRASH
// ---------------------------------------------------------------------------

/// $TRASH minted every round and split by weight between all living junk and the
/// residents' scavenging. This is the only faucet besides the two grants below.
pub const EMISSION: u128 = 1_000;
/// Every resident raccoon scavenges: it shares the emission as if it were this many
/// weight units of junk that never rots. A raccoon that goes broke can always recover.
pub const SCAVENGE_UNITS: u128 = 4;
/// One-time welcome mint for each new player.
pub const STIPEND: u128 = 1_500;
/// What each resident raccoon starts with.
pub const NPC_GENESIS_WALLET: u128 = 3_000;
/// Junk each resident raccoon starts with, so the alley opens mid-economy.
pub const GENESIS_JUNK_PER_NPC: usize = 3;
/// Share of every market sale that is burned.
pub const ALLEY_TAX_BPS: u128 = 500;

// ---------------------------------------------------------------------------
// Junk: the bonds
// ---------------------------------------------------------------------------

pub const KINDS: usize = 8;
pub const KIND_NAMES: [&str; KINDS] = [
    "Pizza Box",
    "Traffic Cone",
    "Shopping Cart",
    "Lone Sock",
    "Dead TV",
    "Garden Gnome",
    "Bent Umbrella",
    "Disco Ball",
];
/// Each lot gets a weight in this range. Weight is its share of the emission.
pub const WEIGHT_MIN: u64 = 2;
pub const WEIGHT_MAX: u64 = 6;
/// Each lot lives this many rounds, then rots.
pub const LIFE_MIN: u64 = 14;
pub const LIFE_MAX: u64 = 36;
/// Hold this many of one kind and each of them earns 3/2 of its normal share.
pub const SET_SIZE: usize = 3;
/// Appraisals never assume less than this much weight competing for the emission.
pub const CROWD_FLOOR: u128 = 100;

// ---------------------------------------------------------------------------
// The auction clock (nanoseconds)
// ---------------------------------------------------------------------------

pub const SEC: u64 = 1_000_000_000;
/// Pause between one lot closing and the next one opening.
pub const INTERMISSION_NS: u64 = 4 * SEC;
/// A lot with no late bids closes this long after it opens.
pub const LOT_NS: u64 = 20 * SEC;
/// A bid this close to the close pushes the close out to this far away.
pub const SNIPE_NS: u64 = 7 * SEC;
/// One raccoon may act per slot.
pub const SLOT_NS: u64 = 2_500_000_000;
/// No lot runs longer than this.
pub const LOT_MAX_NS: u64 = 90 * SEC;
/// Fast-forward needs the alley to be quiet for this long.
pub const QUIET_NS: u64 = 20 * SEC;
/// Most rounds one fast-forward call may run.
pub const FAST_FORWARD_MAX: u32 = 12;

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

/// Opening price as a share of book value.
pub const RESERVE_BPS: u128 = 1_000;
pub const RESERVE_MIN: u128 = 20;
/// Each new bid must beat the last by this share, and by at least RAISE_MIN.
pub const RAISE_BPS: u128 = 800;
pub const RAISE_MIN: u128 = 10;

// ---------------------------------------------------------------------------
// Raccoon moods
// ---------------------------------------------------------------------------

pub const MOOD_START: u128 = 10_000;
pub const MOOD_MIN: u128 = 7_000;
pub const MOOD_MAX: u128 = 13_000;
/// Winning a lot makes a raccoon this much less eager.
pub const MOOD_SATED: u128 = 500;
/// After HUNGRY_AFTER rounds without a win it gets this much more eager every round.
pub const MOOD_HUNGRY: u128 = 300;
pub const HUNGRY_AFTER: u32 = 2;
/// A raccoon buys a listing only if the ask is at most this share of its appraisal.
pub const MARKET_DISCOUNT_BPS: u128 = 9_000;

// ---------------------------------------------------------------------------
// Money burning a hole in a raccoon's pocket
// ---------------------------------------------------------------------------
//
// This is what keeps the supply in check. A raccoon holding more than its comfort level
// feels flush: everything looks worth more to it, and it stops haggling and opens high.
// Flush raccoons overpay, overpaying burns more $TRASH than the round mints, and their
// wallets come back down. Broke raccoons bid low, so less is burned than minted.

/// For every extra comfort level a raccoon holds, its appraisals rise by this much.
pub const FLUSH_STEP_BPS: u128 = 5_000;
/// Appraisals never rise past this multiple.
pub const FLUSH_MAX_BPS: u128 = 25_000;
/// At twice normal appraisals a raccoon leaps this share of the way to its own limit
/// with every bid. Less flush raccoons leap proportionally less.
pub const FLUSH_JUMP_BPS: u128 = 9_000;

/// How flush a raccoon feels: 10,000 at or below its comfort level, rising from there.
pub fn flush_bps(wallet: u128, comfort: u128) -> u128 {
    if wallet <= comfort {
        10_000
    } else {
        (10_000 + (wallet - comfort) * FLUSH_STEP_BPS / comfort).min(FLUSH_MAX_BPS)
    }
}

// ---------------------------------------------------------------------------
// The doorbell: how guests get in without a wallet
// ---------------------------------------------------------------------------

/// NEAR sent to each guest account so it can pay for its own gas (in 1/1000 NEAR).
/// A transaction is charged up front at a pessimistic gas price and refunded afterwards,
/// so a guest needs far more on hand than it actually burns.
pub const GUEST_FUEL_MILLINEAR: u128 = 250;
/// At most JOIN_WINDOW_MAX joins and refuels per window, so the doorbell cannot drain
/// the contract.
pub const JOIN_WINDOW_NS: u64 = 600 * SEC;
pub const JOIN_WINDOW_MAX: u32 = 30;
/// A guest can be refuelled at most this often.
pub const REFUEL_NS: u64 = 180 * SEC;
/// The contract keeps at least this much NEAR back for its own storage (in 1/1000 NEAR).
pub const RESERVE_MILLINEAR: u128 = 500;

// ---------------------------------------------------------------------------
// The resident raccoons
// ---------------------------------------------------------------------------

/// When a raccoon puts its own junk on the market. Asks are a share of book value.
pub enum Sells {
    /// Keeps everything.
    Never,
    /// Dumps junk that has `life` rounds or fewer left, at `bps` of book.
    NearlyRotten { life: u16, bps: u128 },
    /// Lists everything at `start_bps`, dropping `drop_bps` a round down to `floor_bps`.
    Everything { start_bps: u128, drop_bps: u128, floor_bps: u128 },
    /// Fire sale at `bps` whenever its wallet is under `below`.
    WhenBroke { below: u128, bps: u128 },
}

pub struct Persona {
    /// Account name: `<id>.<contract>` is this raccoon's real NEAR account.
    pub id: &'static str,
    pub name: &'static str,
    pub title: &'static str,
    /// The wallet it is comfortable with. Above this it feels flush (see `flush_bps`).
    pub comfort: u128,
    /// Most of its wallet it will put on one lot.
    pub cap_bps: u128,
    /// How many rounds of income it counts when it appraises.
    pub horizon: u16,
    /// Share of its appraisal it is willing to pay.
    pub greed_bps: u128,
    /// Extra value it sees in the piece that completes a set.
    pub set_love_bps: u128,
    /// Taste per kind of junk, in the order of KIND_NAMES.
    pub taste: [u128; KINDS],
    /// 0 bids the minimum raise. Otherwise it leaps this share of the way to its limit.
    pub jump_bps: u128,
    /// Waits for the last two slots before it bids.
    pub late: bool,
    /// How far its appraisal swings from lot to lot.
    pub noise_bps: u64,
    pub sells: Sells,
}

pub const NPCS: usize = 5;

pub const PERSONAS: [Persona; NPCS] = [
    Persona {
        id: "duchess",
        name: "Duchess",
        title: "Old Money",
        comfort: 4_000,
        cap_bps: 3_500,
        horizon: 36,
        greed_bps: 8_000,
        set_love_bps: 3_000,
        //      pizza   cone    cart    sock    tv      gnome   umbrella disco
        taste: [10_000, 10_000, 10_000, 10_000, 10_000, 12_500, 10_000, 12_000],
        jump_bps: 0,
        late: false,
        noise_bps: 500,
        sells: Sells::NearlyRotten { life: 4, bps: 7_000 },
    },
    Persona {
        id: "pockets",
        name: "Pockets",
        title: "The Hoarder",
        comfort: 3_000,
        cap_bps: 6_000,
        horizon: 36,
        greed_bps: 9_500,
        set_love_bps: 9_000,
        taste: [10_000, 10_000, 10_000, 12_000, 10_000, 10_000, 10_000, 10_000],
        jump_bps: 0,
        late: false,
        noise_bps: 800,
        sells: Sells::Never,
    },
    Persona {
        id: "flip",
        name: "Flip",
        title: "The Flipper",
        comfort: 3_000,
        cap_bps: 3_000,
        horizon: 12,
        greed_bps: 9_000,
        set_love_bps: 0,
        taste: [10_000; KINDS],
        jump_bps: 0,
        late: false,
        noise_bps: 800,
        sells: Sells::Everything { start_bps: 13_500, drop_bps: 500, floor_bps: 10_000 },
    },
    Persona {
        id: "yolo",
        name: "Yolo",
        title: "The Degen",
        comfort: 1_500,
        cap_bps: 9_000,
        horizon: 36,
        greed_bps: 10_500,
        set_love_bps: 2_000,
        taste: [11_500, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 13_000],
        jump_bps: 5_000,
        late: false,
        noise_bps: 3_000,
        sells: Sells::WhenBroke { below: 500, bps: 8_000 },
    },
    Persona {
        id: "snatch",
        name: "Snatch",
        title: "The Sniper",
        comfort: 3_000,
        cap_bps: 5_000,
        horizon: 36,
        greed_bps: 9_000,
        set_love_bps: 3_000,
        taste: [10_000, 10_000, 10_000, 10_000, 12_000, 10_000, 10_000, 10_000],
        jump_bps: 0,
        late: true,
        noise_bps: 1_000,
        sells: Sells::Never,
    },
];

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/// Why a raccoon bid. Shown next to each bid in the game.
pub const WHY_VALUE: u8 = 0;
pub const WHY_SET: u8 = 1;
pub const WHY_FAVE: u8 = 2;
pub const WHY_YOLO: u8 = 3;
pub const WHY_SNIPE: u8 = 4;
pub const WHY_FLUSH: u8 = 5;
/// Marks a bid placed by a player.
pub const WHY_HUMAN: u8 = 255;

pub struct Appraisal {
    /// What the junk is worth to this raccoon right now.
    pub value: u128,
    /// How far it leaps from the standing bid toward its own limit. 0 is the minimum raise.
    pub jump_bps: u128,
    pub why: u8,
}

/// A piece of junk's share of the emission. Being part of a set is worth 3/2.
pub fn weight_units(weight: u8, in_set: bool) -> u128 {
    if in_set {
        weight as u128 * 3
    } else {
        weight as u128 * 2
    }
}

/// Book value: the $TRASH a piece of junk pays over `life` rounds if the crowd stays as it is.
/// `crowd` is the total weight sharing the emission, this piece included.
pub fn book_value(weight: u8, life: u16, in_set: bool, crowd: u128) -> u128 {
    EMISSION * weight_units(weight, in_set) * life as u128 / crowd.max(CROWD_FLOOR)
}

/// What one raccoon thinks a piece of junk is worth to it right now.
///
/// `owned` is how many living pieces of this kind it already holds (not counting this one)
/// and `crowd` is the total weight sharing the emission, this piece included.
#[allow(clippy::too_many_arguments)]
pub fn appraise(
    npc: usize,
    wallet: u128,
    mood_bps: u128,
    kind: u8,
    weight: u8,
    life: u16,
    owned: usize,
    crowd: u128,
    seed: u64,
) -> Appraisal {
    let p = &PERSONAS[npc];
    let completes = owned + 1 == SET_SIZE;
    let in_set = owned + 1 >= SET_SIZE;
    // 1. Income over the rounds this raccoon cares about.
    let horizon = life.min(p.horizon);
    let mut value = book_value(weight, horizon, in_set, crowd);
    // 2. The piece that completes a set lifts the two it already holds.
    if completes {
        value += value * p.set_love_bps / 10_000;
    }
    // 3. Taste, greed and today's mood.
    value = value * p.taste[kind as usize] / 10_000;
    value = value * p.greed_bps / 10_000;
    value = value * mood_bps / 10_000;
    // 4. A per-lot swing, fixed by the lot's seed so anyone can recompute it.
    let swing = swing_bps(seed, npc as u64, p.noise_bps);
    value = value * (10_000 + swing) as u128 / 10_000;
    // 5. Money burning a hole in its pocket.
    let flush = flush_bps(wallet, p.comfort);
    value = value * flush / 10_000;
    let flush_jump = ((flush - 10_000) * FLUSH_JUMP_BPS / 10_000).min(FLUSH_JUMP_BPS);

    let why = if completes {
        WHY_SET
    } else if p.taste[kind as usize] >= 11_500 {
        WHY_FAVE
    } else if flush >= 13_000 {
        WHY_FLUSH
    } else if swing >= 1_500 {
        WHY_YOLO
    } else if p.late {
        WHY_SNIPE
    } else {
        WHY_VALUE
    };
    Appraisal { value, jump_bps: p.jump_bps.max(flush_jump), why }
}

/// The least the next bid may be.
pub fn next_bid(reserve: u128, high: u128) -> u128 {
    if high == 0 {
        reserve
    } else {
        high + RAISE_MIN.max(high * RAISE_BPS / 10_000)
    }
}

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

/// SplitMix64 over two words. Deterministic, so views and transactions agree.
pub fn mix(a: u64, b: u64) -> u64 {
    let mut z = a
        .wrapping_add(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(b.wrapping_mul(0xD1B5_4A32_D192_ED03));
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// A whole number in `lo..=hi`.
pub fn pick(seed: u64, salt: u64, lo: u64, hi: u64) -> u64 {
    lo + mix(seed, salt) % (hi - lo + 1)
}

/// A swing in `-noise..=noise` basis points.
fn swing_bps(seed: u64, npc: u64, noise: u64) -> i64 {
    if noise == 0 {
        return 0;
    }
    (mix(seed, 77 + npc) % (2 * noise + 1)) as i64 - noise as i64
}
