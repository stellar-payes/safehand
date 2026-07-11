use crate::{ArbiterRegistry, ArbiterRegistryClient, RegistryError};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

fn setup() -> (Env, ArbiterRegistryClient<'static>, Address) {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let id = e.register_contract(None, ArbiterRegistry);
    let client = ArbiterRegistryClient::new(&e, &id);
    client.initialize(&admin);
    (e, client, admin)
}

#[test]
fn register_get_and_slash() {
    let (e, client, _admin) = setup();
    let arbiter = Address::generate(&e);
    let meta = BytesN::from_array(&e, &[5u8; 32]);

    client.register(&arbiter, &250, &meta);
    let info = client.get(&arbiter);
    assert_eq!(info.fee_bps, 250);
    assert!(info.active);

    client.slash(&arbiter);
    assert!(!client.get(&arbiter).active);

    // Re-registering reactivates with new terms.
    client.register(&arbiter, &300, &meta);
    let info = client.get(&arbiter);
    assert!(info.active);
    assert_eq!(info.fee_bps, 300);
}

#[test]
fn rejects_predatory_fees_and_unknown_lookups() {
    let (e, client, _admin) = setup();
    let arbiter = Address::generate(&e);
    let meta = BytesN::from_array(&e, &[5u8; 32]);

    let err = client.try_register(&arbiter, &1_001, &meta);
    assert_eq!(err, Err(Ok(RegistryError::FeeTooHigh)));

    let err = client.try_get(&arbiter);
    assert_eq!(err, Err(Ok(RegistryError::NotRegistered)));

    let err = client.try_slash(&arbiter);
    assert_eq!(err, Err(Ok(RegistryError::NotRegistered)));
}
