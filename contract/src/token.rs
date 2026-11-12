//! $TRASH as an NEP-141 fungible token, with NEP-148 metadata, NEP-297 events and a
//! no-fee NEP-145 storage interface so wallets and exchanges can treat it like any token.
//!
//! The ledger itself lives in `lib.rs` because three kinds of account hold $TRASH:
//! ordinary accounts, the resident raccoons, and each piece of junk.

use near_sdk::json_types::U128;
use near_sdk::{assert_one_yocto, env, near, require, serde_json, AccountId, Gas, NearToken, Promise, PromiseOrValue};

use crate::{Contract, ContractExt, Holder};

const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(10);
const GAS_FOR_TRANSFER_CALL: Gas = Gas::from_tgas(25);

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23161412'/%3E%3Cpath d='M18 22h28l-3 30H21z' fill='%23d8ff3e'/%3E%3Crect x='14' y='16' width='36' height='6' rx='3' fill='%23d8ff3e'/%3E%3Crect x='26' y='10' width='12' height='6' rx='3' fill='%23d8ff3e'/%3E%3C/svg%3E";

#[near(serializers = [json])]
pub struct FtMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(serializers = [json])]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[near(serializers = [json])]
pub struct StorageBalanceBounds {
    pub min: U128,
    pub max: Option<U128>,
}

fn event(name: &str, data: String) {
    crate::emit(&format!(r#"EVENT_JSON:{{"standard":"nep141","version":"1.0.0","event":"{name}","data":[{data}]}}"#));
}

/// One `ft_mint` event for a batch of mints. Coupons pass an empty memo to keep the
/// per-round event small: it carries one entry for every living piece of junk.
pub(crate) fn log_mint(grants: &[(AccountId, u128)], memo: &str) {
    if grants.is_empty() {
        return;
    }
    let rows: Vec<String> = grants
        .iter()
        .map(|(owner, amount)| {
            if memo.is_empty() {
                format!(r#"{{"owner_id":"{owner}","amount":"{amount}"}}"#)
            } else {
                format!(r#"{{"owner_id":"{owner}","amount":"{amount}","memo":"{memo}"}}"#)
            }
        })
        .collect();
    event("ft_mint", rows.join(","));
}

pub(crate) fn log_burn(owner: &AccountId, amount: u128, memo: &str) {
    event("ft_burn", format!(r#"{{"owner_id":"{owner}","amount":"{amount}","memo":"{memo}"}}"#));
}

pub(crate) fn log_transfer(from: &AccountId, to: &AccountId, amount: u128, memo: &str) {
    event("ft_transfer", format!(r#"{{"old_owner_id":"{from}","new_owner_id":"{to}","amount":"{amount}","memo":"{memo}"}}"#));
}

impl Contract {
    fn internal_ft_transfer(&mut self, from: &AccountId, to: &AccountId, amount: u128, memo: &str) {
        require!(amount > 0, "send more than zero");
        require!(from != to, "sender and receiver are the same");
        self.debit(from, amount);
        self.credit(to, amount);
        log_transfer(from, to, amount, memo);
    }
}

#[near]
impl Contract {
    /// NEP-141. Sending $TRASH to a piece of junk (`bond-17.<contract>`) puts it in that
    /// junk's wallet, where it stays with the token until its owner sweeps it.
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.internal_ft_transfer(&sender, &receiver_id, amount.0, memo.as_deref().unwrap_or(""));
    }

    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        assert_one_yocto();
        require!(env::prepaid_gas() > GAS_FOR_TRANSFER_CALL.saturating_add(GAS_FOR_RESOLVE), "attach more gas");
        let sender = env::predecessor_account_id();
        self.internal_ft_transfer(&sender, &receiver_id, amount.0, memo.as_deref().unwrap_or(""));
        let args = serde_json::json!({ "sender_id": sender, "amount": amount, "msg": msg }).to_string().into_bytes();
        let resolve = serde_json::json!({ "sender_id": sender, "receiver_id": receiver_id, "amount": amount }).to_string().into_bytes();
        let gas = env::prepaid_gas().saturating_sub(GAS_FOR_TRANSFER_CALL).saturating_sub(GAS_FOR_RESOLVE);
        Promise::new(receiver_id)
            .function_call("ft_on_transfer".to_string(), args, NearToken::from_yoctonear(0), gas)
            .then(Promise::new(env::current_account_id()).function_call("ft_resolve_transfer".to_string(), resolve, NearToken::from_yoctonear(0), GAS_FOR_RESOLVE))
            .into()
    }

    /// Returns how much of `amount` the receiver kept. Anything it did not use goes back.
    #[private]
    pub fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let unused = match env::promise_result_checked(0, 64) {
            Ok(value) => serde_json::from_slice::<U128>(&value).map_or(amount.0, |u| u.0.min(amount.0)),
            Err(_) => amount.0,
        };
        let free = self.balance_of(&receiver_id).saturating_sub(self.locked(&receiver_id));
        let refund = unused.min(free);
        if refund > 0 {
            self.debit(&receiver_id, refund);
            self.credit(&sender_id, refund);
            log_transfer(&receiver_id, &sender_id, refund, "refund");
        }
        U128(amount.0 - refund)
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balance_of(&account_id))
    }

    pub fn ft_metadata(&self) -> FtMetadata {
        FtMetadata {
            spec: "ft-1.0.0".to_string(),
            name: "Trash".to_string(),
            symbol: "TRASH".to_string(),
            icon: Some(ICON.to_string()),
            reference: None,
            reference_hash: None,
            decimals: 0,
        }
    }

    // NEP-145. Holding $TRASH costs the holder no storage deposit, so these exist only
    // so that wallets and exchanges which insist on registering first keep working.

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let _ = (account_id, registration_only);
        let attached = env::attached_deposit();
        if attached.as_yoctonear() > 0 {
            Promise::new(env::predecessor_account_id()).transfer(attached).detach();
        }
        StorageBalance { total: U128(0), available: U128(0) }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        match self.holder(&account_id) {
            Holder::Rotted => None,
            _ => Some(StorageBalance { total: U128(0), available: U128(0) }),
        }
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds { min: U128(0), max: Some(U128(0)) }
    }
}
