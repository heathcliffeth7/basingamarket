const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function isSolanaPubkey(address: string) {
  return decodeBase58(address)?.length === 32;
}

export function isSolanaSignature(signature: string) {
  return decodeBase58(signature)?.length === 64;
}

export function encodeBase58(bytes: Uint8Array) {
  if (bytes.length === 0) return '';

  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      const next = digits[index] * 256 + carry;
      digits[index] = next % 58;
      carry = Math.floor(next / 58);
    }

    while (carry > 0) {
      digits.unshift(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let encoded = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded += '1';
  }

  const firstNonZero = digits.findIndex((digit) => digit !== 0);
  for (const digit of firstNonZero === -1 ? [] : digits.slice(firstNonZero)) {
    encoded += BASE58_ALPHABET[digit];
  }

  return encoded;
}

export function encodeBase64(bytes: Uint8Array) {
  let encoded = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;

    encoded += BASE64_ALPHABET[first >> 2];
    encoded += BASE64_ALPHABET[((first & 0x03) << 4) | (second >> 4)];
    encoded += index + 1 < bytes.length ? BASE64_ALPHABET[((second & 0x0f) << 2) | (third >> 6)] : '=';
    encoded += index + 2 < bytes.length ? BASE64_ALPHABET[third & 0x3f] : '=';
  }

  return encoded;
}

export function decodeBase58(value: string) {
  if (!value) return null;

  const bytes: number[] = [];
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit === -1) return null;

    let carry = digit;
    for (let index = bytes.length - 1; index >= 0; index -= 1) {
      const next = bytes[index] * 58 + carry;
      bytes[index] = next & 0xff;
      carry = next >> 8;
    }

    while (carry > 0) {
      bytes.unshift(carry & 0xff);
      carry >>= 8;
    }
  }

  for (const char of value) {
    if (char !== '1') break;
    bytes.unshift(0);
  }

  return bytes;
}
