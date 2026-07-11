#![no_std]

//! Whitelist of dispute resolvers with their fee schedules. Deal-creation
//! UIs read this to offer vetted arbiters; governance (the admin, a DAO
//! later) can slash bad actors, which deactivates them for new deals.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Symbol};

const MAX_FEE_BPS: u32 = 1_000; // 10%

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct ArbiterInfo {
    pub fee_bps: u32,
    pub metadata_hash: BytesN<32>,
    pub active: bool,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Arbiter(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    FeeTooHigh = 3,
    NotRegistered = 4,
}

#[contract]
pub struct ArbiterRegistry;

#[contractimpl]
impl ArbiterRegistry {
    pub fn initialize(e: Env, admin: Address) -> Result<(), RegistryError> {
        if e.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::AlreadyInitialized);
        }
        admin.require_auth();
        e.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Self-service registration: any address can list itself with a fee
    /// and metadata (profile, track record pointer). Re-registering updates
    /// the entry and reactivates it.
    pub fn register(
        e: Env,
        arbiter: Address,
        fee_bps: u32,
        metadata_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        arbiter.require_auth();
        if fee_bps > MAX_FEE_BPS {
            return Err(RegistryError::FeeTooHigh);
        }

        let info = ArbiterInfo {
            fee_bps,
            metadata_hash,
            active: true,
        };
        e.storage()
            .persistent()
            .set(&DataKey::Arbiter(arbiter.clone()), &info);
        e.events().publish((Symbol::new(&e, "registered"),), arbiter);
        Ok(())
    }

    /// Governance strike: deactivates the arbiter for new deals. Existing
    /// disputes keep their assigned arbiter (deals pin the address).
    pub fn slash(e: Env, arbiter: Address) -> Result<(), RegistryError> {
        let admin: Address = e
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        admin.require_auth();

        let key = DataKey::Arbiter(arbiter.clone());
        let mut info: ArbiterInfo = e
            .storage()
            .persistent()
            .get(&key)
            .ok_or(RegistryError::NotRegistered)?;
        info.active = false;
        e.storage().persistent().set(&key, &info);
        e.events().publish((Symbol::new(&e, "slashed"),), arbiter);
        Ok(())
    }

    pub fn get(e: Env, arbiter: Address) -> Result<ArbiterInfo, RegistryError> {
        e.storage()
            .persistent()
            .get(&DataKey::Arbiter(arbiter))
            .ok_or(RegistryError::NotRegistered)
    }
}

#[cfg(test)]
mod test;
