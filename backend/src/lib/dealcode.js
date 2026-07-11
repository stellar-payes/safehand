import { randomBytes } from 'node:crypto';

// Unambiguous base32-ish alphabet: no 0/O, no 1/l/I — these codes get read
// aloud over WhatsApp voice notes.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateDealCode(length = 8) {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}
