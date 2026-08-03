import crypto from 'node:crypto';
import CryptoJS from 'crypto-js';

const ALGORITHM = 'aes-256-cbc';
const FALLBACK_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || FALLBACK_ENCRYPTION_KEY;
const IV_LENGTH = 16;

// Refuse to use the dev fallback key in production — it would make encrypted
// data trivially decryptable by anyone with source access.
if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) {
    throw new Error('[Crypto] FATAL: ENCRYPTION_KEY env var is required in production.');
}

// Validate key length for native crypto
if (Buffer.from(ENCRYPTION_KEY).length !== 32) {
    console.warn(`[Crypto] Warning: ENCRYPTION_KEY is not 32 bytes (got ${Buffer.from(ENCRYPTION_KEY).length}). This may cause errors with aes-256-cbc.`);
}

/**
 * Шифрует пароль с помощью AES-256-CBC (Native Node.js)
 */
export function encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Расшифровывает пароль.
 * Поддерживает оба формата:
 * 1. Native: "iv:ciphertext" (hex)
 * 2. Legacy: "ciphertext" (Base64 OpenSSL format from crypto-js)
 */
export function decrypt(text: string): string {
    // Check for Native format (IV:Ciphertext)
    // Note: Base64 (Legacy) does not use colon, Hex (Native) uses colon as separator.
    if (text.includes(':')) {
        try {
            const parts = text.split(':');
            if (parts.length === 2) {
                const iv = Buffer.from(parts[0], 'hex');
                const encryptedText = Buffer.from(parts[1], 'hex');

                const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
                let decrypted = decipher.update(encryptedText);
                decrypted = Buffer.concat([decrypted, decipher.final()]);
                return decrypted.toString();
            }
        } catch (e) {
            console.warn('[Crypto] Native decryption failed, attempting legacy:', e);
        }
    }

    // Fallback to Legacy (CryptoJS)
    const bytes = CryptoJS.AES.decrypt(text, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
}
