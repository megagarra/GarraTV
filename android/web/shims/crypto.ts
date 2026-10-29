/**
 * `crypto` for the in-app backend. Only what the bundled server code needs:
 * SHA-1 ids for free channels, random UUIDs and bytes. (Account sessions and
 * device pairing, the HMAC/scrypt users, are replaced on Android.)
 */

function utf8(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

function toHex(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
}

function sha1(message: Uint8Array): Uint8Array {
    const length = message.length;
    const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
    padded.set(message);
    padded[length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor((length * 8) / 0x100000000));
    view.setUint32(padded.length - 4, (length * 8) >>> 0);

    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Uint32Array(80);
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
        for (let i = 16; i < 80; i++) {
            const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
            w[i] = (x << 1) | (x >>> 31);
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4;
        for (let i = 0; i < 80; i++) {
            let f: number, k: number;
            if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
            else { f = b ^ c ^ d; k = 0xca62c1d6; }
            const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
            e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = temp;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    const digest = new Uint8Array(20);
    const out = new DataView(digest.buffer);
    [h0, h1, h2, h3, h4].forEach((value, i) => out.setUint32(i * 4, value));
    return digest;
}

class Hash {
    private readonly chunks: Uint8Array[] = [];

    constructor(private readonly algorithm: string) {
        if (algorithm.toLowerCase() !== 'sha1') throw new Error(`Hash ${algorithm} is not available in the Android app`);
    }

    update(data: string | Uint8Array): this {
        this.chunks.push(typeof data === 'string' ? utf8(data) : data);
        return this;
    }

    digest(encoding?: string): string | Uint8Array {
        const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of this.chunks) {
            joined.set(chunk, offset);
            offset += chunk.length;
        }
        const result = sha1(joined);
        return encoding === 'hex' ? toHex(result) : result;
    }
}

export function createHash(algorithm: string): Hash {
    return new Hash(algorithm);
}

export function randomUUID(): string {
    return crypto.randomUUID();
}

export function randomBytes(size: number): { toString(encoding?: string): string } & Uint8Array {
    const bytes = crypto.getRandomValues(new Uint8Array(size));
    return Object.assign(bytes, {
        toString(encoding?: string): string {
            if (encoding === 'base64url' || encoding === 'base64') {
                const base64 = btoa(String.fromCharCode(...Array.from(bytes)));
                return encoding === 'base64' ? base64 : base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            }
            return toHex(bytes);
        },
    });
}

const shim = { createHash, randomUUID, randomBytes };
export default shim;
