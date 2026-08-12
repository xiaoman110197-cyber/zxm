import { createHash } from 'node:crypto';

export function sourceDigest(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new TypeError('Source buffer is required');
  }
  return createHash('sha256').update(buffer).digest('hex');
}
