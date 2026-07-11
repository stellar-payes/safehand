// Polls Soroban RPC for escrow-core events and mirrors them into Postgres so
// the API can serve deal pages and arbiter stats without hitting the chain.
import { rpc, scValToNative, nativeToScVal } from '@stellar/stellar-sdk';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { callReadOnly } from '../soroban/client.js';
import { notifyStateChange } from './notifications.js';

const POLL_INTERVAL_MS = 5_000;
const server = new rpc.Server(config.sorobanRpcUrl);

async function getCursor() {
  const { rows } = await query('SELECT last_ledger FROM indexer_state WHERE id = 1');
  return Number(rows[0].last_ledger);
}

async function setCursor(ledger) {
  await query('UPDATE indexer_state SET last_ledger = $1 WHERE id = 1', [ledger]);
}

// The `created` event only carries the deal id and buyer; the full deal
// (milestones, arbiter, token) comes from a read-only get_deal call.
async function ingestDeal(dealId) {
  const deal = await callReadOnly(config.escrowContractId, 'get_deal', [
    nativeToScVal(BigInt(dealId), { type: 'u64' }),
  ]);
  if (!deal) return;

  await query(
    `INSERT INTO deals (id, buyer, seller, token, arbiter, arbiter_fee_bps)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
    [dealId, deal.buyer, deal.seller, deal.token, deal.arbiter ?? null, deal.arbiter_fee_bps]
  );
  let idx = 0;
  for (const m of deal.milestones ?? []) {
    await query(
      `INSERT INTO milestones (deal_id, idx, amount, desc_hash, deadline)
       VALUES ($1, $2, $3, $4, to_timestamp($5)) ON CONFLICT DO NOTHING`,
      [dealId, idx, String(m.amount), Buffer.from(m.desc_hash).toString('hex'), Number(m.deadline)]
    );
    idx += 1;
  }
}

async function setMilestoneState(dealId, idx, state, txHash) {
  await query(
    'UPDATE milestones SET state = $3, tx_hash = $4, updated_at = now() WHERE deal_id = $1 AND idx = $2',
    [dealId, idx, state, txHash ?? null]
  );
  await notifyStateChange(dealId, idx, state);
}

async function handleEvent(event) {
  const topics = event.topic.map((t) => scValToNative(t));
  const value = scValToNative(event.value);
  const name = topics[0];

  switch (name) {
    case 'created': {
      await ingestDeal(Number(topics[1]));
      break;
    }
    case 'funded': {
      await setMilestoneState(Number(topics[1]), Number(topics[2]), 'Funded', event.txHash);
      break;
    }
    case 'delivered': {
      await setMilestoneState(Number(topics[1]), Number(topics[2]), 'Delivered', event.txHash);
      break;
    }
    case 'released': {
      await setMilestoneState(Number(topics[1]), Number(topics[2]), 'Released', event.txHash);
      break;
    }
    case 'disputed': {
      const [dealId, idx] = [Number(topics[1]), Number(topics[2])];
      const [by, evidenceHash] = value;
      await query(
        `INSERT INTO disputes (deal_id, idx, raised_by, evidence_hash)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [dealId, idx, by, Buffer.from(evidenceHash).toString('hex')]
      );
      await setMilestoneState(dealId, idx, 'Disputed', event.txHash);
      break;
    }
    case 'resolved': {
      const [dealId, idx] = [Number(topics[1]), Number(topics[2])];
      await query(
        'UPDATE disputes SET buyer_bps = $3, resolved_at = now() WHERE deal_id = $1 AND idx = $2',
        [dealId, idx, Number(value)]
      );
      await setMilestoneState(dealId, idx, 'Released', event.txHash);
      await refreshArbiterStats(dealId);
      break;
    }
    case 'refunded': {
      await setMilestoneState(Number(topics[1]), Number(topics[2]), 'Refunded', event.txHash);
      break;
    }
    default:
      break;
  }
}

// Recomputes the resolving arbiter's aggregates from raw dispute rows —
// idempotent, so replayed events can't double-count.
async function refreshArbiterStats(dealId) {
  const { rows } = await query('SELECT arbiter FROM deals WHERE id = $1', [dealId]);
  const arbiter = rows[0]?.arbiter;
  if (!arbiter) return;

  await query(
    `INSERT INTO arbiter_stats (arbiter, disputes_resolved, avg_resolution_secs, avg_buyer_bps, updated_at)
     SELECT d.arbiter,
            COUNT(*)::int,
            AVG(EXTRACT(EPOCH FROM (dp.resolved_at - dp.created_at)))::bigint,
            AVG(dp.buyer_bps)::int,
            now()
     FROM disputes dp JOIN deals d ON d.id = dp.deal_id
     WHERE d.arbiter = $1 AND dp.resolved_at IS NOT NULL
     GROUP BY d.arbiter
     ON CONFLICT (arbiter) DO UPDATE SET
       disputes_resolved = EXCLUDED.disputes_resolved,
       avg_resolution_secs = EXCLUDED.avg_resolution_secs,
       avg_buyer_bps = EXCLUDED.avg_buyer_bps,
       updated_at = now()`,
    [arbiter]
  );
}

async function tick() {
  if (!config.escrowContractId) {
    console.log('ESCROW_CONTRACT_ID not set; indexer idle.');
    return;
  }

  const cursor = await getCursor();
  const latest = await server.getLatestLedger();
  // RPC nodes retain a bounded event window; clamp so a stale cursor
  // doesn't make getEvents reject the request outright.
  const startLedger = cursor > 0 ? cursor + 1 : Math.max(latest.sequence - 10_000, 1);

  const page = await server.getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds: [config.escrowContractId] }],
  });

  for (const event of page.events ?? []) {
    await handleEvent(event);
  }
  await setCursor(latest.sequence);
}

console.log('SafeHand indexer started.');
for (;;) {
  try {
    await tick();
  } catch (err) {
    console.error('Indexer tick failed:', err.message);
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}
