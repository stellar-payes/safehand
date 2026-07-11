# SafeHand — Milestone Escrow for Everyday P2P Commerce

> Buy a used phone from a stranger on Instagram without praying. Funds release when the deal is done — or a dispute resolver decides.

## Problem
Informal P2P commerce (social-media sellers, freelance gigs, used goods) runs on "pay before delivery" and hope. Scams are rampant; buyers have zero recourse; honest sellers lose deals to distrust.

## Solution
General-purpose escrow contracts on Soroban with milestones, deadlines, mutual release, and pluggable dispute resolution — plus a dead-simple app: create a deal link, share it on WhatsApp, both parties see the same state.

## Monorepo Structure
```
safehand/
├── contracts/
│   ├── escrow-core/       # Single-milestone + multi-milestone escrow
│   └── arbiter-registry/  # Whitelisted dispute resolvers + fee schedule
├── backend/               # Node (Hono) + Postgres; deal links, notifications, evidence storage refs
└── frontend/              # Next.js PWA (share-link first, wallet second)
```

## Contract: escrow-core
```rust
pub struct Milestone { amount: i128, desc_hash: BytesN<32>, deadline: u64, state: MState }
pub enum MState { Funded, Delivered, Released, Disputed, Refunded }

fn create(e: Env, buyer: Address, seller: Address, token: Address,
          milestones: Vec<Milestone>, arbiter: Option<Address>, arbiter_fee_bps: u32) -> u64;
fn fund(e: Env, deal_id: u64, idx: u32);                     // buyer deposits milestone amount
fn mark_delivered(e: Env, deal_id: u64, idx: u32);           // seller
fn release(e: Env, deal_id: u64, idx: u32);                  // buyer approves → pay seller
fn auto_release(e: Env, deal_id: u64, idx: u32);             // anyone, after deadline + grace if Delivered
fn dispute(e: Env, deal_id: u64, idx: u32, evidence_hash: BytesN<32>);
fn resolve(e: Env, deal_id: u64, idx: u32, buyer_bps: u32);  // arbiter splits funds
fn refund_expired(e: Env, deal_id: u64, idx: u32);           // deadline passed, never Delivered
```
- Events: `created`, `funded`, `delivered`, `released`, `disputed`, `resolved`, `refunded`
- Invariants to test: funds conservation across every path; arbiter can never move funds outside a `Disputed` state; no state can strand funds.

### arbiter-registry
`register(arbiter, fee_bps, metadata_hash)`, `slash(arbiter)` (governance), `get(arbiter) -> ArbiterInfo`. Frontend shows arbiter track record from indexer data.

## Backend (Hono + Postgres)
- Deal links: `POST /deals` returns `safehand.app/d/abc123` (metadata off-chain, hashes on-chain)
- Evidence: client uploads to S3-compatible store, contract stores hash only
- Notifications: WhatsApp/email on every state change (both parties)
- Indexer: `deals`, `milestones`, `disputes`, `arbiter_stats` (resolution time, split tendencies)
- API: `GET /deals/:id`, `GET /arbiters`, `GET /me/deals`

## Frontend (Next.js PWA)
1. **Create deal:** describe item/gig, price, deadline, pick arbiter (or "mutual only") → share link.
2. **Deal page (the product):** both parties see one timeline — Funded → Delivered → Released. Big obvious buttons for the current actor.
3. **Dispute flow:** upload photos/chat screenshots → hash pinned → arbiter dashboard.
4. **Arbiter dashboard:** queue, evidence viewer, split slider, one-click resolve.
- Embedded passkey wallet for buyers who have never used crypto; sellers can connect Freighter.

## Milestones
1. escrow-core single milestone + full state-machine tests (good-first-issue: state diagram in docs)
2. Multi-milestone + auto_release keeper
3. Deal links + notifications backend
4. PWA deal page on testnet
5. Arbiter registry + dashboard
6. Evidence hashing + storage
7. Fee model (protocol fee bps → DAO treasury) + mainnet checklist

## Getting Started
```bash
cd contracts && stellar contract build && cargo test
cd backend && cp .env.example .env && npm i && npm run dev
cd frontend && npm i && npm run dev
```

## FUNDING.json
```json
{ "drips": { "ethereum": { "ownedBy": "0xYOUR_ADDRESS" } } }
```

## License
MIT
