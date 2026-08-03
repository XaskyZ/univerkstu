import crypto from 'node:crypto';
import CryptoJS from 'crypto-js';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

// Детерминированный dev-фолбэк: позволяет поднять приложение локально без
// настройки env. Для реальных данных использовать нельзя — им зашифрованное
// тривиально расшифровывается любым, у кого есть исходники.
const DEV_FALLBACK_KEY = '0123456789abcdef0123456789abcdef';

// В production ключ обязателен — иначе креды шифровались бы публично-известным
// ключом, то есть фактически без защиты.
if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) {
    throw new Error('[Crypto] FATAL: ENCRYPTION_KEY env var is required in production.');
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || DEV_FALLBACK_KEY;

// Вне production молчаливый фолбэк — грабли для само-хостера: предупреждаем явно,
// чтобы «используется небезопасный ключ» не осталось незамеченным (в тестах молчим).
if (!process.env.ENCRYPTION_KEY && process.env.NODE_ENV !== 'test') {
    console.warn(
        '[Crypto] WARNING: ENCRYPTION_KEY не задан — используется небезопасный dev-фолбэк. '
        + 'Для любого реального развёртывания задайте ENCRYPTION_KEY (32 байта).'
    );
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
