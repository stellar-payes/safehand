// Notifies both parties on every milestone state change. Without Twilio
// credentials this logs instead of sending, so the indexer runs anywhere.
import { config } from '../config.js';
import { query } from '../db/index.js';

const MESSAGES = {
  Funded: (url) => `SafeHand: the buyer funded the milestone. Deliver, then mark it: ${url}`,
  Delivered: (url) => `SafeHand: the seller marked delivered. Review and release: ${url}`,
  Released: (url) => `SafeHand: funds released to the seller. Receipt: ${url}`,
  Disputed: (url) => `SafeHand: a dispute was opened. Add your evidence: ${url}`,
  Refunded: (url) => `SafeHand: the milestone was refunded to the buyer. Details: ${url}`,
};

export async function notifyStateChange(dealId, idx, state) {
  const template = MESSAGES[state];
  if (!template) return;

  const { rows } = await query(
    `SELECT d.buyer, d.seller, l.code FROM deals d
     LEFT JOIN deal_links l ON l.deal_id = d.id
     WHERE d.id = $1 LIMIT 1`,
    [dealId]
  );
  if (rows.length === 0) return;

  const { buyer, seller, code } = rows[0];
  const url = code ? `${config.appBaseUrl}/d/${code}` : `${config.appBaseUrl}/d/${dealId}`;
  const message = template(url);

  for (const party of [buyer, seller]) {
    if (config.twilioSid && config.twilioToken) {
      // Contact handles (WhatsApp/email) are looked up off-chain by the app;
      // wiring an actual Twilio sender is milestone 3.
      console.log(`[notify:${state}] would send to ${party}: ${message}`);
    } else {
      console.log(`[notify:${state}] deal ${dealId} m${idx} → ${party}: ${message}`);
    }
  }
}
