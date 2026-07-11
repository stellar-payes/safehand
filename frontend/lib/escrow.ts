'use client';

import { Contract, scValToNative, xdr } from '@stellar/stellar-sdk';
import { buildSignAndSubmit, readContract, scAddress, scI128, scU32, scU64 } from './soroban';
import { signTransaction } from './walletKit';

const ESCROW_ID = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID ?? '';

export interface NewMilestone {
  amount: bigint;
  description: string;
  deadline: number; // unix seconds
}

async function sha256Bytes(text: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
  return new Uint8Array(digest);
}

export async function sha256Hex(text: string): Promise<string> {
  return Buffer.from(await sha256Bytes(text)).toString('hex');
}

// Hand-built ScVal for the contract's Milestone struct. Soroban struct maps
// must list their keys in sorted order: amount, deadline, desc_hash, state.
function scMilestone(amount: bigint, descHash: Uint8Array, deadline: number): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('amount'), val: scI128(amount) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('deadline'), val: scU64(deadline) }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('desc_hash'),
      val: xdr.ScVal.scvBytes(Buffer.from(descHash)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('state'),
      val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Pending')]),
    }),
  ]);
}

export interface CreateDealParams {
  buyer: string;
  seller: string;
  token: string;
  milestones: NewMilestone[];
  arbiter?: string | null;
  arbiterFeeBps?: number;
}

export async function createDeal(publicKey: string, params: CreateDealParams) {
  const contract = new Contract(ESCROW_ID);

  const milestones: xdr.ScVal[] = [];
  const descHashes: string[] = [];
  for (const m of params.milestones) {
    const hash = await sha256Bytes(m.description);
    descHashes.push(Buffer.from(hash).toString('hex'));
    milestones.push(scMilestone(m.amount, hash, m.deadline));
  }

  const op = contract.call(
    'create',
    scAddress(params.buyer),
    scAddress(params.seller),
    scAddress(params.token),
    xdr.ScVal.scvVec(milestones),
    params.arbiter ? scAddress(params.arbiter) : xdr.ScVal.scvVoid(),
    scU32(params.arbiterFeeBps ?? 0)
  );

  const result = await buildSignAndSubmit(publicKey, [op], signTransaction);
  // `create` returns the new deal id; it rides back on the tx result.
  const retval = (result as { returnValue?: xdr.ScVal }).returnValue;
  const dealId = retval ? Number(scValToNative(retval)) : null;
  return { dealId, descHashes };
}

function milestoneOp(method: string, dealId: number, idx: number) {
  return new Contract(ESCROW_ID).call(method, scU64(dealId), scU32(idx));
}

export function fund(publicKey: string, dealId: number, idx: number) {
  return buildSignAndSubmit(publicKey, [milestoneOp('fund', dealId, idx)], signTransaction);
}

export function markDelivered(publicKey: string, dealId: number, idx: number) {
  return buildSignAndSubmit(
    publicKey,
    [milestoneOp('mark_delivered', dealId, idx)],
    signTransaction
  );
}

export function release(publicKey: string, dealId: number, idx: number) {
  return buildSignAndSubmit(publicKey, [milestoneOp('release', dealId, idx)], signTransaction);
}

export function autoRelease(publicKey: string, dealId: number, idx: number) {
  return buildSignAndSubmit(publicKey, [milestoneOp('auto_release', dealId, idx)], signTransaction);
}

export function refundExpired(publicKey: string, dealId: number, idx: number) {
  return buildSignAndSubmit(
    publicKey,
    [milestoneOp('refund_expired', dealId, idx)],
    signTransaction
  );
}

export async function dispute(publicKey: string, dealId: number, idx: number, evidence: string) {
  const hash = await sha256Bytes(evidence);
  const op = new Contract(ESCROW_ID).call(
    'dispute',
    scU64(dealId),
    scU32(idx),
    xdr.ScVal.scvBytes(Buffer.from(hash))
  );
  return buildSignAndSubmit(publicKey, [op], signTransaction);
}

export function resolve(publicKey: string, dealId: number, idx: number, buyerBps: number) {
  const op = new Contract(ESCROW_ID).call(
    'resolve',
    scU64(dealId),
    scU32(idx),
    scU32(buyerBps)
  );
  return buildSignAndSubmit(publicKey, [op], signTransaction);
}

export function getDealOnChain(dealId: number) {
  return readContract(ESCROW_ID, 'get_deal', [scU64(dealId)]);
}
