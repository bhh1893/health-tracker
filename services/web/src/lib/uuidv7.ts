/**
 * Builds a UUIDv7 (RFC 9562): a 48-bit millisecond timestamp, then random bits,
 * so IDs sort roughly by creation time and insert cheaply into a B-tree index.
 *
 * Uses crypto.getRandomValues because crypto.randomUUID only exists in a secure
 * context, and v1 is served over plain HTTP (ADR 0010).
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const view = new DataView(bytes.buffer);

  // Bytes 0-5, big-endian. Split with arithmetic: JavaScript's bitwise operators
  // truncate to 32 bits, which would corrupt a 48-bit timestamp.
  view.setUint32(0, Math.floor(now / 2 ** 16));
  view.setUint16(4, now % 2 ** 16);

  // High nibble of byte 6 is the version; top two bits of byte 8 are the variant.
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x70);
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80);

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
