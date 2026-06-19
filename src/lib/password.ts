import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const HASH_PREFIX = "scrypt";
const HASH_VERSION = "v1";

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = (await scrypt(secret, salt, 64)) as Buffer;

  return `${HASH_PREFIX}$${HASH_VERSION}$${salt}$${key.toString("base64url")}`;
}

export async function verifySecret(secret: string, storedHash?: string | null): Promise<boolean> {
  if (!storedHash) {
    return false;
  }

  const [prefix, version, salt, keyValue] = storedHash.split("$");

  if (prefix !== HASH_PREFIX || version !== HASH_VERSION || !salt || !keyValue) {
    return false;
  }

  try {
    const storedKey = Buffer.from(keyValue, "base64url");
    const derivedKey = (await scrypt(secret, salt, storedKey.length)) as Buffer;

    return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
  } catch {
    return false;
  }
}
