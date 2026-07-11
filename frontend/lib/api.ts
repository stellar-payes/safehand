const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface MilestoneRow {
  idx: number;
  amount: string;
  descHash: string;
  deadline: string;
  state: 'Pending' | 'Funded' | 'Delivered' | 'Released' | 'Disputed' | 'Refunded';
  updatedAt: string;
}

export interface DealDetail {
  id: number;
  buyer: string;
  seller: string;
  token: string;
  arbiter: string | null;
  arbiterFeeBps: number;
  title: string | null;
  description: string | null;
  createdAt: string;
  milestones: MilestoneRow[];
  disputes: {
    idx: number;
    raised_by: string;
    evidence_hash: string;
    buyer_bps: number | null;
    resolved_at: string | null;
    created_at: string;
  }[];
}

export interface DealSummary {
  id: number;
  title: string | null;
  buyer: string;
  seller: string;
  arbiter: string | null;
  role: 'buyer' | 'seller' | 'arbiter';
  milestoneCount: number;
  releasedCount: number;
  disputedCount: number;
  createdAt: string;
}

export interface ArbiterStats {
  arbiter: string;
  disputesResolved: number;
  avgResolutionSecs: number | null;
  avgBuyerBps: number | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

export function getDeal(idOrCode: number | string): Promise<DealDetail> {
  return api<DealDetail>(`/deals/${idOrCode}`);
}

export function getMyDeals(address: string): Promise<DealSummary[]> {
  return api<DealSummary[]>('/me/deals', { headers: { 'X-Account': address } });
}

export function getArbiters(): Promise<ArbiterStats[]> {
  return api<ArbiterStats[]>('/arbiters');
}

export function registerDeal(
  address: string,
  deal: {
    dealId: number;
    buyer: string;
    seller: string;
    token: string;
    arbiter?: string | null;
    arbiterFeeBps?: number;
    title?: string;
    description?: string;
    milestones: { idx: number; amount: string; descHash: string; deadline: number }[];
  }
): Promise<{ code: string; url: string }> {
  return api('/deals', {
    method: 'POST',
    headers: { 'X-Account': address },
    body: JSON.stringify(deal),
  });
}
