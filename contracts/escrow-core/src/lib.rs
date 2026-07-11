#![no_std]

//! escrow-core: milestone escrow state machine.
//!
//! Per-milestone lifecycle:
//! `Pending → Funded → Delivered → Released` (happy path), with `Disputed`,
//! `Refunded` branches. Invariants enforced everywhere:
//! - funds are conserved across every path,
//! - the arbiter can only move funds while a milestone is `Disputed`,
//! - no state strands funds.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env, Symbol, Vec,
};

const BPS: i128 = 10_000;
/// After a seller marks Delivered, the buyer has deadline + this grace to
/// object before anyone can auto-release the funds.
const GRACE_SECS: u64 = 3 * 24 * 60 * 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[contracttype]
pub enum MState {
    Pending, // created, awaiting buyer's deposit
    Funded,
    Delivered,
    Released,
    Disputed,
    Refunded,
}

#[derive(Clone)]
#[contracttype]
pub struct Milestone {
    pub amount: i128,
    pub desc_hash: BytesN<32>,
    pub deadline: u64,
    pub state: MState,
}

#[derive(Clone)]
#[contracttype]
pub struct Deal {
    pub buyer: Address,
    pub seller: Address,
    pub token: Address,
    pub milestones: Vec<Milestone>,
    pub arbiter: Option<Address>,
    pub arbiter_fee_bps: u32,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    NextDealId,
    Deal(u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    DealNotFound = 1,
    MilestoneNotFound = 2,
    InvalidState = 3,
    InvalidAmount = 4,
    NoArbiter = 5,
    NotArbiter = 6,
    FeeTooHigh = 7,
    DeadlineNotPassed = 8,
    DeadlinePassed = 9,
    InvalidSplit = 10,
    NoMilestones = 11,
    MathError = 12,
}

#[contract]
pub struct EscrowCore;

#[contractimpl]
impl EscrowCore {
    /// Creates a deal with its milestones in `Pending`. Buyer authorizes so
    /// a seller can't open deals in someone else's name.
    pub fn create(
        e: Env,
        buyer: Address,
        seller: Address,
        token: Address,
        milestones: Vec<Milestone>,
        arbiter: Option<Address>,
        arbiter_fee_bps: u32,
    ) -> Result<u64, EscrowError> {
        buyer.require_auth();

        if milestones.is_empty() {
            return Err(EscrowError::NoMilestones);
        }
        if arbiter_fee_bps as i128 >= BPS {
            return Err(EscrowError::FeeTooHigh);
        }
        for m in milestones.iter() {
            if m.amount <= 0 {
                return Err(EscrowError::InvalidAmount);
            }
            if m.state != MState::Pending {
                return Err(EscrowError::InvalidState);
            }
        }

        let id: u64 = e.storage().instance().get(&DataKey::NextDealId).unwrap_or(0);
        e.storage().instance().set(&DataKey::NextDealId, &(id + 1));

        let deal = Deal {
            buyer: buyer.clone(),
            seller,
            token,
            milestones,
            arbiter,
            arbiter_fee_bps,
        };
        e.storage().persistent().set(&DataKey::Deal(id), &deal);

        e.events().publish((Symbol::new(&e, "created"), id), buyer);
        Ok(id)
    }

    /// Buyer deposits the milestone amount into escrow.
    pub fn fund(e: Env, deal_id: u64, idx: u32) -> Result<(), EscrowError> {
        let mut deal = Self::load(&e, deal_id)?;
        deal.buyer.require_auth();
        let mut m = Self::milestone(&deal, idx)?;
        Self::expect(&m, MState::Pending)?;

        token::Client::new(&e, &deal.token).transfer(
            &deal.buyer,
            &e.current_contract_address(),
            &m.amount,
        );

        m.state = MState::Funded;
        deal.milestones.set(idx, m);
        e.storage().persistent().set(&DataKey::Deal(deal_id), &deal);

        e.events().publish((Symbol::new(&e, "funded"), deal_id, idx), ());
        Ok(())
    }

    /// Seller declares the work done / item shipped.
    pub fn mark_delivered(e: Env, deal_id: u64, idx: u32) -> Result<(), EscrowError> {
        let mut deal = Self::load(&e, deal_id)?;
        deal.seller.require_auth();
        let mut m = Self::milestone(&deal, idx)?;
        Self::expect(&m, MState::Funded)?;

        m.state = MState::Delivered;
        deal.milestones.set(idx, m);
        e.storage().persistent().set(&DataKey::Deal(deal_id), &deal);

        e.events()
            .publish((Symbol::new(&e, "delivered"), deal_id, idx), ());
        Ok(())
    }

    /// Buyer approves: escrow pays the seller. Allowed from Funded too so a
    /// happy buyer can release without waiting for a Delivered mark.
    pub fn release(e: Env, deal_id: u64, idx: u32) -> Result<(), EscrowError> {
        let mut deal = Self::load(&e, deal_id)?;
        deal.buyer.require_auth();
        let m = Self::milestone(&deal, idx)?;
        if m.state != MState::Funded && m.state != MState::Delivered {
            return Err(EscrowError::InvalidState);
        }

        Self::pay_and_set(&e, deal_id, &mut deal, idx, MState::Released)?;
        e.events()
            .publish((Symbol::new(&e, "released"), deal_id, idx), ());
        Ok(())
    }

    /// Permissionless release after `deadline + grace` when the seller has
    /// delivered and the buyer has gone silent — a keeper can settle it.
    pub fn auto_release(e: Env, deal_id: u64, idx: u32) -> Result<(), EscrowError> {
        let mut deal = Self::load(&e, deal_id)?;
        let m = Self::milestone(&deal, idx)?;
        Self::expect(&m, MState::Delivered)?;
        if e.ledger().timestamp() < m.deadline + GRACE_SECS {
            return Err(EscrowError::DeadlineNotPassed);
        }

        Self::pay_and_set(&e, deal_id, &mut deal, idx, MState::Released)?;
        e.events()
            .publish((Symbol::new(&e, "released"), deal_id, idx), Symbol::new(&e, "auto"));
        Ok(())
    }

    /// Either party freezes the milestone for the arbiter, pinning an
    /// evidence hash on-chain (contents live off-chain).
    pub fn dispute(
        e: Env,
        deal_id: u64,
        idx: u32,
        by: Address,
        evidence_hash: BytesN<32>,
    ) -> Result<(), EscrowError> {
        let mut deal = Self::load(&e, deal_id)?;
        by.require_auth();
        if by != deal.buyer && by != deal.seller {
            return Err(EscrowError::InvalidState);
        }
        if deal.arbiter.is_none() {
            return Err(EscrowError::NoArbiter);
        }
        let mut m = Self::milestone(&deal, idx)?;
        if m.state != MState::Funded && m.state != MState::Delivered {
            return Err(EscrowError::InvalidState);
        }

        m.state = MState::Disputed;
        deal.milestones.set(idx, m);
        e.storage().persistent().set(&DataKey::Deal(deal_id), &deal);

        e.events()
            .publish((Symbol::new(&e, "disputed"), deal_id, idx), (by, evidence_hash));
        Ok(())
    }

    /// Arbiter splits the escrowed amount: `buyer_bps` (of what remains
    /// after the arbiter's fee) back to the buyer, the rest to the seller.
    /// Only callable in `Disputed` — the arbiter can never touch funds in
    /// any other state.
    pub fn resolve(e: Env, deal_id: u64, idx: u32, buyer_bps: u32) -> Result<(), EscrowError> {
        let mut deal = Self::load(&e, deal_id)?;
        let arbiter = deal.arbiter.clone().ok_or(EscrowError::NoArbiter)?;
        arbiter.require_auth();

        if buyer_bps as i128 > BPS {
            return Err(EscrowError::InvalidSplit);
        }
        let mut m = Self::milestone(&deal, idx)?;
        Self::expect(&m, MState::Disputed)?;

        let fee = m
            .amount
            .checked_mul(deal.arbiter_fee_bps as i128)
            .ok_or(EscrowError::MathError)?
            / BPS;
        let remainder = m.amount - fee;
        let to_buyer = remainder
            .checked_mul(buyer_bps as i128)
            .ok_or(EscrowError::MathError)?
            / BPS;
        let to_seller = remainder - to_buyer;

        m.state = if to_seller == 0 {
            MState::Refunded
        } else {
            MState::Released
        };
        deal.milestones.set(idx, m);
        e.storage().persistent().set(&DataKey::Deal(deal_id), &deal);

        let client = token::Client::new(&e, &deal.token);
        let this = e.current_contract_address();
        if fee > 0 {
            client.transfer(&this, &arbiter, &fee);
        }
        if to_buyer > 0 {
            client.transfer(&this, &deal.buyer, &to_buyer);
        }
        if to_seller > 0 {
            client.transfer(&this, &deal.seller, &to_seller);
        }

        e.events()
            .publish((Symbol::new(&e, "resolved"), deal_id, idx), buyer_bps);
        Ok(())
    }

    /// Deadline passed and the seller never delivered: anyone can push the
    /// escrowed funds back to the buyer.
    pub fn refund_expired(e: Env, deal_id: u64, idx: u32) -> Result<(), EscrowError> {
        let mut deal = Self::load(&e, deal_id)?;
        let m = Self::milestone(&deal, idx)?;
        Self::expect(&m, MState::Funded)?;
        if e.ledger().timestamp() <= m.deadline {
            return Err(EscrowError::DeadlineNotPassed);
        }

        let mut m = m;
        m.state = MState::Refunded;
        let amount = m.amount;
        deal.milestones.set(idx, m);
        e.storage().persistent().set(&DataKey::Deal(deal_id), &deal);

        token::Client::new(&e, &deal.token).transfer(
            &e.current_contract_address(),
            &deal.buyer,
            &amount,
        );

        e.events()
            .publish((Symbol::new(&e, "refunded"), deal_id, idx), amount);
        Ok(())
    }

    pub fn get_deal(e: Env, deal_id: u64) -> Result<Deal, EscrowError> {
        Self::load(&e, deal_id)
    }

    // -- internal helpers ------------------------------------------------------

    fn load(e: &Env, deal_id: u64) -> Result<Deal, EscrowError> {
        e.storage()
            .persistent()
            .get(&DataKey::Deal(deal_id))
            .ok_or(EscrowError::DealNotFound)
    }

    fn milestone(deal: &Deal, idx: u32) -> Result<Milestone, EscrowError> {
        deal.milestones
            .get(idx)
            .ok_or(EscrowError::MilestoneNotFound)
    }

    fn expect(m: &Milestone, state: MState) -> Result<(), EscrowError> {
        if m.state != state {
            return Err(EscrowError::InvalidState);
        }
        Ok(())
    }

    /// Marks the milestone `new_state` *before* the external transfer
    /// (checks-effects-interactions) and pays the seller in full.
    fn pay_and_set(
        e: &Env,
        deal_id: u64,
        deal: &mut Deal,
        idx: u32,
        new_state: MState,
    ) -> Result<(), EscrowError> {
        let mut m = Self::milestone(deal, idx)?;
        let amount = m.amount;
        m.state = new_state;
        deal.milestones.set(idx, m);
        e.storage().persistent().set(&DataKey::Deal(deal_id), deal);

        token::Client::new(e, &deal.token).transfer(
            &e.current_contract_address(),
            &deal.seller,
            &amount,
        );
        Ok(())
    }
}

#[cfg(test)]
mod test;
