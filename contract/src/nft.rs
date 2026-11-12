//! Junk bonds as NEP-171 tokens, with NEP-177 metadata, NEP-181 enumeration and
//! NEP-297 events.
//!
//! The token id of a piece of junk is the id of the NEAR account that it is, for example
//! `bond-17.<contract>`. Only this contract can create accounts under its own name, so an
//! account id that ends in `.<contract>` and that `nft_token` knows cannot be an impostor.
//! That account has no access keys and no code. Its $TRASH can only be moved by `sweep`,
//! which checks the token's current owner in the same receipt, so there is no moment in a
//! transfer when a past owner still has access. This follows the "make the collection the
//! actor" advice in the House of Stake sharded NFT items draft.
//!
//! The metadata is computed from live state on every read: rounds left, what is in the
//! wallet and whether the piece is part of a set all show up without any update call.

use near_sdk::json_types::U128;
use near_sdk::{assert_one_yocto, env, near, require, serde_json, AccountId, Gas, NearToken, Promise, PromiseOrValue};

use crate::rules::{weight_units, EMISSION, KIND_NAMES};
use crate::{Bond, Contract, ContractExt, Holder};

const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(10);
/// Kept back for this contract's own work, which can include creating the junk's account.
const GAS_FOR_TRANSFER_CALL: Gas = Gas::from_tgas(45);

#[near(serializers = [json])]
pub struct NftContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub copies: Option<u64>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: Option<TokenMetadata>,
}

fn event(name: &str, data: String) {
    crate::emit(&format!(r#"EVENT_JSON:{{"standard":"nep171","version":"1.0.0","event":"{name}","data":[{data}]}}"#));
}

pub(crate) fn log_mint(owner: &AccountId, token: &AccountId) {
    event("nft_mint", format!(r#"{{"owner_id":"{owner}","token_ids":["{token}"]}}"#));
}

pub(crate) fn log_burn(owner: &AccountId, token: &AccountId) {
    event("nft_burn", format!(r#"{{"owner_id":"{owner}","token_ids":["{token}"],"memo":"rotted"}}"#));
}

pub(crate) fn log_transfer(from: &AccountId, to: &AccountId, token: &AccountId, memo: &str) {
    event("nft_transfer", format!(r#"{{"old_owner_id":"{from}","new_owner_id":"{to}","token_ids":["{token}"],"memo":"{memo}"}}"#));
}

impl Contract {
    fn token_of(&self, b: &Bond, in_set: bool, crowd: u128) -> Token {
        let per_round = if crowd > 0 { EMISSION * weight_units(b.weight, in_set) / crowd } else { 0 };
        let name = KIND_NAMES[b.kind as usize];
        Token {
            token_id: Self::junk_account(b.id).to_string(),
            owner_id: b.owner.clone(),
            metadata: Some(TokenMetadata {
                title: Some(format!("{} #{}", name, b.id)),
                description: Some(format!(
                    "A junk bond. Weight {}, {} rounds until it rots, paying about {} $TRASH a round. Its own account holds {} $TRASH that moves with it.",
                    b.weight, b.life, per_round, b.wallet
                )),
                media: None,
                media_hash: None,
                copies: Some(1),
                issued_at: None,
                expires_at: None,
                starts_at: None,
                updated_at: None,
                extra: Some(
                    serde_json::json!({
                        "kind": name,
                        "weight": b.weight,
                        "rounds_left": b.life,
                        "born_round": b.born,
                        "wallet": b.wallet.to_string(),
                        "earned": b.earned.to_string(),
                        "in_set": in_set,
                        "ask": b.ask.to_string(),
                    })
                    .to_string(),
                ),
                reference: None,
                reference_hash: None,
            }),
        }
    }

    fn tokens_where(&self, keep: impl Fn(&Bond) -> bool, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let flags = self.set_flags();
        let crowd = self.crowd();
        self.bonds
            .iter()
            .zip(flags)
            .filter(|(b, _)| keep(b))
            .skip(from_index.map_or(0, |i| i.0 as usize))
            .take(limit.unwrap_or(100) as usize)
            .map(|(b, in_set)| self.token_of(b, in_set, crowd))
            .collect()
    }

    /// Move a piece of junk. Its wallet goes with it, and any listing is cancelled.
    fn internal_nft_transfer(&mut self, sender: &AccountId, receiver: &AccountId, token_id: &str, memo: &str) {
        let idx = self.junk_idx(token_id);
        require!(&self.bonds[idx].owner == sender, "only the owner can move this junk");
        require!(sender != receiver, "that is already yours");
        require!(matches!(self.holder(receiver), Holder::Plain | Holder::Npc(_)), "junk cannot own junk");
        let b = &mut self.bonds[idx];
        b.owner = receiver.clone();
        b.ask = 0;
        b.listed = 0;
        let id = b.id;
        if matches!(self.holder(receiver), Holder::Plain) {
            self.ensure_account(idx);
        }
        log_transfer(sender, receiver, &Self::junk_account(id), memo);
    }
}

#[near]
impl Contract {
    #[payable]
    pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>) {
        assert_one_yocto();
        require!(approval_id.is_none(), "approvals are not supported");
        let sender = env::predecessor_account_id();
        self.internal_nft_transfer(&sender, &receiver_id, &token_id, memo.as_deref().unwrap_or(""));
    }

    #[payable]
    pub fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        assert_one_yocto();
        require!(approval_id.is_none(), "approvals are not supported");
        require!(env::prepaid_gas() > GAS_FOR_TRANSFER_CALL.saturating_add(GAS_FOR_RESOLVE), "attach more gas");
        let sender = env::predecessor_account_id();
        self.internal_nft_transfer(&sender, &receiver_id, &token_id, memo.as_deref().unwrap_or(""));
        let args = serde_json::json!({ "sender_id": sender, "previous_owner_id": sender, "token_id": token_id, "msg": msg }).to_string().into_bytes();
        let resolve = serde_json::json!({ "previous_owner_id": sender, "receiver_id": receiver_id, "token_id": token_id }).to_string().into_bytes();
        let gas = env::prepaid_gas().saturating_sub(GAS_FOR_TRANSFER_CALL).saturating_sub(GAS_FOR_RESOLVE);
        Promise::new(receiver_id)
            .function_call("nft_on_transfer".to_string(), args, NearToken::from_yoctonear(0), gas)
            .then(Promise::new(env::current_account_id()).function_call("nft_resolve_transfer".to_string(), resolve, NearToken::from_yoctonear(0), GAS_FOR_RESOLVE))
            .into()
    }

    /// Returns true if the receiver kept the token.
    #[private]
    pub fn nft_resolve_transfer(&mut self, previous_owner_id: AccountId, receiver_id: AccountId, token_id: String) -> bool {
        let give_back = match env::promise_result_checked(0, 16) {
            Ok(value) => serde_json::from_slice::<bool>(&value).unwrap_or(true),
            Err(_) => true,
        };
        if !give_back {
            return true;
        }
        let still_there = token_id.parse::<AccountId>().ok().and_then(|a| match self.holder(&a) {
            Holder::Junk(i) if self.bonds[i].owner == receiver_id => Some(i),
            _ => None,
        });
        match still_there {
            Some(_) => {
                self.internal_nft_transfer(&receiver_id, &previous_owner_id, &token_id, "returned");
                false
            }
            None => true,
        }
    }

    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        let account = token_id.parse::<AccountId>().ok()?;
        match self.holder(&account) {
            Holder::Junk(i) => {
                let flags = self.set_flags();
                Some(self.token_of(&self.bonds[i], flags[i], self.crowd()))
            }
            _ => None,
        }
    }

    pub fn nft_metadata(&self) -> NftContractMetadata {
        NftContractMetadata {
            spec: "nft-1.0.0".to_string(),
            name: "Junk Bonds".to_string(),
            symbol: "JUNK".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.bonds.len() as u128)
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens_where(|_| true, from_index, limit)
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.bonds.iter().filter(|b| b.owner == account_id).count() as u128)
    }

    pub fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens_where(|b| b.owner == account_id, from_index, limit)
    }
}
