use crate::{Deal, EscrowCore, EscrowCoreClient, EscrowError, MState, Milestone};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, BytesN, Env, Vec,
};

const UNIT: i128 = 10_000_000;
const PRICE: i128 = 500 * UNIT;
const FEE_BPS: u32 = 200; // 2% arbiter fee
const GRACE_SECS: u64 = 3 * 24 * 60 * 60;

struct TestFixture<'a> {
    e: Env,
    escrow: EscrowCoreClient<'a>,
    token_client: token::Client<'a>,
    buyer: Address,
    seller: Address,
    arbiter: Address,
    deal_id: u64,
    deadline: u64,
}

fn setup() -> TestFixture<'static> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|l| l.timestamp = 1_700_000_000);

    let admin = Address::generate(&e);
    let token_addr = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_admin = token::StellarAssetClient::new(&e, &token_addr);
    let token_client = token::Client::new(&e, &token_addr);

    let escrow_id = e.register_contract(None, EscrowCore);
    let escrow = EscrowCoreClient::new(&e, &escrow_id);

    let buyer = Address::generate(&e);
    let seller = Address::generate(&e);
    let arbiter = Address::generate(&e);
    token_admin.mint(&buyer, &(10_000 * UNIT));

    let deadline = e.ledger().timestamp() + 7 * 86_400;
    let mut milestones: Vec<Milestone> = Vec::new(&e);
    milestones.push_back(Milestone {
        amount: PRICE,
        desc_hash: BytesN::from_array(&e, &[1u8; 32]),
        deadline,
        state: MState::Pending,
    });

    let deal_id = escrow.create(
        &buyer,
        &seller,
        &token_addr,
        &milestones,
        &Some(arbiter.clone()),
        &FEE_BPS,
    );

    TestFixture {
        e,
        escrow,
        token_client,
        buyer,
        seller,
        arbiter,
        deal_id,
        deadline,
    }
}

fn state(deal: &Deal, idx: u32) -> MState {
    deal.milestones.get(idx).unwrap().state
}

#[test]
fn happy_path_fund_deliver_release() {
    let f = setup();

    f.escrow.fund(&f.deal_id, &0);
    assert_eq!(f.token_client.balance(&f.escrow.address), PRICE);
    assert_eq!(state(&f.escrow.get_deal(&f.deal_id), 0), MState::Funded);

    f.escrow.mark_delivered(&f.deal_id, &0);
    f.escrow.release(&f.deal_id, &0);

    assert_eq!(state(&f.escrow.get_deal(&f.deal_id), 0), MState::Released);
    assert_eq!(f.token_client.balance(&f.seller), PRICE);
    assert_eq!(f.token_client.balance(&f.escrow.address), 0); // nothing stranded
}

#[test]
fn release_requires_funding_first() {
    let f = setup();
    let err = f.escrow.try_release(&f.deal_id, &0);
    assert_eq!(err, Err(Ok(EscrowError::InvalidState)));
}

#[test]
fn auto_release_only_after_deadline_plus_grace_and_only_if_delivered() {
    let f = setup();
    f.escrow.fund(&f.deal_id, &0);

    // Not delivered: auto_release must never fire even after the deadline.
    f.e.ledger().with_mut(|l| l.timestamp = f.deadline + GRACE_SECS + 1);
    let err = f.escrow.try_auto_release(&f.deal_id, &0);
    assert_eq!(err, Err(Ok(EscrowError::InvalidState)));

    // Rewind, deliver, and check the grace window is enforced.
    f.e.ledger().with_mut(|l| l.timestamp = f.deadline - 100);
    f.escrow.mark_delivered(&f.deal_id, &0);
    let err = f.escrow.try_auto_release(&f.deal_id, &0);
    assert_eq!(err, Err(Ok(EscrowError::DeadlineNotPassed)));

    f.e.ledger().with_mut(|l| l.timestamp = f.deadline + GRACE_SECS + 1);
    f.escrow.auto_release(&f.deal_id, &0);
    assert_eq!(f.token_client.balance(&f.seller), PRICE);
}

#[test]
fn refund_expired_returns_funds_when_never_delivered() {
    let f = setup();
    f.escrow.fund(&f.deal_id, &0);
    let buyer_after_funding = f.token_client.balance(&f.buyer);

    let err = f.escrow.try_refund_expired(&f.deal_id, &0);
    assert_eq!(err, Err(Ok(EscrowError::DeadlineNotPassed)));

    f.e.ledger().with_mut(|l| l.timestamp = f.deadline + 1);
    f.escrow.refund_expired(&f.deal_id, &0);

    assert_eq!(f.token_client.balance(&f.buyer), buyer_after_funding + PRICE);
    assert_eq!(state(&f.escrow.get_deal(&f.deal_id), 0), MState::Refunded);
    assert_eq!(f.token_client.balance(&f.escrow.address), 0);
}

#[test]
fn dispute_and_resolve_split_conserves_funds() {
    let f = setup();
    f.escrow.fund(&f.deal_id, &0);
    f.escrow.mark_delivered(&f.deal_id, &0);

    let evidence = BytesN::from_array(&f.e, &[7u8; 32]);
    f.escrow.dispute(&f.deal_id, &0, &f.buyer, &evidence);
    assert_eq!(state(&f.escrow.get_deal(&f.deal_id), 0), MState::Disputed);

    let buyer_before = f.token_client.balance(&f.buyer);
    // 60/40 split in the buyer's favor.
    f.escrow.resolve(&f.deal_id, &0, &6_000);

    let fee = PRICE * (FEE_BPS as i128) / 10_000;
    let remainder = PRICE - fee;
    let to_buyer = remainder * 6_000 / 10_000;
    let to_seller = remainder - to_buyer;

    assert_eq!(f.token_client.balance(&f.arbiter), fee);
    assert_eq!(f.token_client.balance(&f.buyer), buyer_before + to_buyer);
    assert_eq!(f.token_client.balance(&f.seller), to_seller);
    // Conservation: everything escrowed left the contract, nothing more.
    assert_eq!(f.token_client.balance(&f.escrow.address), 0);
}

#[test]
fn arbiter_cannot_resolve_outside_disputed_state() {
    let f = setup();
    f.escrow.fund(&f.deal_id, &0);

    let err = f.escrow.try_resolve(&f.deal_id, &0, &5_000);
    assert_eq!(err, Err(Ok(EscrowError::InvalidState)));

    f.escrow.mark_delivered(&f.deal_id, &0);
    let err = f.escrow.try_resolve(&f.deal_id, &0, &5_000);
    assert_eq!(err, Err(Ok(EscrowError::InvalidState)));

    f.escrow.release(&f.deal_id, &0);
    let err = f.escrow.try_resolve(&f.deal_id, &0, &5_000);
    assert_eq!(err, Err(Ok(EscrowError::InvalidState)));
}

#[test]
fn dispute_without_arbiter_rejected() {
    let f = setup();
    let mut milestones: Vec<Milestone> = Vec::new(&f.e);
    milestones.push_back(Milestone {
        amount: PRICE,
        desc_hash: BytesN::from_array(&f.e, &[2u8; 32]),
        deadline: f.deadline,
        state: MState::Pending,
    });
    let deal_id = f.escrow.create(
        &f.buyer,
        &f.seller,
        &f.token_client.address,
        &milestones,
        &None,
        &0,
    );
    f.escrow.fund(&deal_id, &0);

    let evidence = BytesN::from_array(&f.e, &[9u8; 32]);
    let err = f.escrow.try_dispute(&deal_id, &0, &f.buyer, &evidence);
    assert_eq!(err, Err(Ok(EscrowError::NoArbiter)));
}

#[test]
fn multi_milestone_paths_are_independent() {
    let f = setup();
    let mut milestones: Vec<Milestone> = Vec::new(&f.e);
    for i in 0..3u8 {
        milestones.push_back(Milestone {
            amount: PRICE,
            desc_hash: BytesN::from_array(&f.e, &[i; 32]),
            deadline: f.deadline,
            state: MState::Pending,
        });
    }
    let deal_id = f.escrow.create(
        &f.buyer,
        &f.seller,
        &f.token_client.address,
        &milestones,
        &Some(f.arbiter.clone()),
        &FEE_BPS,
    );

    // Milestone 0 releases, 1 refunds after expiry, 2 stays pending.
    f.escrow.fund(&deal_id, &0);
    f.escrow.fund(&deal_id, &1);
    f.escrow.mark_delivered(&deal_id, &0);
    f.escrow.release(&deal_id, &0);

    f.e.ledger().with_mut(|l| l.timestamp = f.deadline + 1);
    f.escrow.refund_expired(&deal_id, &1);

    let deal = f.escrow.get_deal(&deal_id);
    assert_eq!(state(&deal, 0), MState::Released);
    assert_eq!(state(&deal, 1), MState::Refunded);
    assert_eq!(state(&deal, 2), MState::Pending);
    assert_eq!(f.token_client.balance(&f.escrow.address), 0);
}

#[test]
fn resolve_full_refund_marks_refunded() {
    let f = setup();
    f.escrow.fund(&f.deal_id, &0);
    let evidence = BytesN::from_array(&f.e, &[3u8; 32]);
    f.escrow.dispute(&f.deal_id, &0, &f.seller, &evidence);

    f.escrow.resolve(&f.deal_id, &0, &10_000); // 100% to buyer
    assert_eq!(state(&f.escrow.get_deal(&f.deal_id), 0), MState::Refunded);
    assert_eq!(f.token_client.balance(&f.seller), 0);
}

#[test]
fn create_rejects_bad_input() {
    let f = setup();
    let empty: Vec<Milestone> = Vec::new(&f.e);
    let err = f.escrow.try_create(
        &f.buyer,
        &f.seller,
        &f.token_client.address,
        &empty,
        &None,
        &0,
    );
    assert_eq!(err, Err(Ok(EscrowError::NoMilestones)));

    let mut bad: Vec<Milestone> = Vec::new(&f.e);
    bad.push_back(Milestone {
        amount: 0,
        desc_hash: BytesN::from_array(&f.e, &[0u8; 32]),
        deadline: f.deadline,
        state: MState::Pending,
    });
    let err = f.escrow.try_create(
        &f.buyer,
        &f.seller,
        &f.token_client.address,
        &bad,
        &None,
        &0,
    );
    assert_eq!(err, Err(Ok(EscrowError::InvalidAmount)));
}
