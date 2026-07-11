import { query } from '../db/index.js';

export default async function meRoutes(fastify) {
  // Every deal the address touches, in any role — the app's home screen.
  fastify.get('/me/deals', async (request, reply) => {
    const address = request.headers['x-account'];
    if (!address) {
      return reply.code(400).send({ error: 'X-Account header required' });
    }

    const { rows } = await query(
      `SELECT d.*,
              (SELECT COUNT(*) FROM milestones m WHERE m.deal_id = d.id)::int AS milestone_count,
              (SELECT COUNT(*) FROM milestones m WHERE m.deal_id = d.id AND m.state = 'Released')::int AS released_count,
              (SELECT COUNT(*) FROM milestones m WHERE m.deal_id = d.id AND m.state = 'Disputed')::int AS disputed_count
       FROM deals d
       WHERE d.buyer = $1 OR d.seller = $1 OR d.arbiter = $1
       ORDER BY d.created_at DESC`,
      [address]
    );

    return rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      buyer: row.buyer,
      seller: row.seller,
      arbiter: row.arbiter,
      role: row.buyer === address ? 'buyer' : row.seller === address ? 'seller' : 'arbiter',
      milestoneCount: row.milestone_count,
      releasedCount: row.released_count,
      disputedCount: row.disputed_count,
      createdAt: row.created_at,
    }));
  });
}
