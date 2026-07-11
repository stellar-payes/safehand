import { query } from '../db/index.js';
import { config } from '../config.js';
import { generateDealCode } from '../lib/dealcode.js';

function formatDeal(row) {
  return {
    id: Number(row.id),
    buyer: row.buyer,
    seller: row.seller,
    token: row.token,
    arbiter: row.arbiter,
    arbiterFeeBps: row.arbiter_fee_bps,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
  };
}

function formatMilestone(row) {
  return {
    idx: row.idx,
    amount: row.amount,
    descHash: row.desc_hash,
    deadline: row.deadline,
    state: row.state,
    updatedAt: row.updated_at,
  };
}

export default async function dealsRoutes(fastify) {
  // Registers an on-chain deal's off-chain metadata and mints a share code.
  // The contract stores hashes only; titles and descriptions live here.
  fastify.post('/deals', async (request, reply) => {
    const address = request.headers['x-account'];
    if (!address) {
      return reply.code(400).send({ error: 'X-Account header required' });
    }

    const { dealId, buyer, seller, token, arbiter, arbiterFeeBps, title, description, milestones } =
      request.body ?? {};
    if (dealId === undefined || !buyer || !seller || !token) {
      return reply.code(400).send({ error: 'dealId, buyer, seller and token are required' });
    }

    await query(
      `INSERT INTO deals (id, buyer, seller, token, arbiter, arbiter_fee_bps, title, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [dealId, buyer, seller, token, arbiter ?? null, arbiterFeeBps ?? 0, title ?? null, description ?? null]
    );
    for (const m of milestones ?? []) {
      await query(
        `INSERT INTO milestones (deal_id, idx, amount, desc_hash, deadline)
         VALUES ($1, $2, $3, $4, to_timestamp($5)) ON CONFLICT DO NOTHING`,
        [dealId, m.idx, m.amount, m.descHash, m.deadline]
      );
    }

    const code = generateDealCode();
    await query('INSERT INTO deal_links (code, deal_id, created_by) VALUES ($1, $2, $3)', [
      code,
      dealId,
      address,
    ]);

    return { code, url: `${config.appBaseUrl}/d/${code}` };
  });

  // Resolves a share code or a raw deal id — both parties open the same link.
  fastify.get('/deals/:idOrCode', async (request, reply) => {
    const { idOrCode } = request.params;

    let dealId = /^\d+$/.test(idOrCode) ? Number(idOrCode) : null;
    if (dealId === null) {
      const { rows } = await query('SELECT deal_id FROM deal_links WHERE code = $1', [idOrCode]);
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'deal not found' });
      }
      dealId = Number(rows[0].deal_id);
    }

    const { rows } = await query('SELECT * FROM deals WHERE id = $1', [dealId]);
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'deal not found' });
    }

    const { rows: milestones } = await query(
      'SELECT * FROM milestones WHERE deal_id = $1 ORDER BY idx',
      [dealId]
    );
    const { rows: disputes } = await query(
      'SELECT idx, raised_by, evidence_hash, buyer_bps, resolved_at, created_at FROM disputes WHERE deal_id = $1',
      [dealId]
    );

    return {
      ...formatDeal(rows[0]),
      milestones: milestones.map(formatMilestone),
      disputes,
    };
  });
}
