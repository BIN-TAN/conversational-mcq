import { createHash, randomBytes } from "node:crypto";

export const ACCOUNT_SECURITY_TOKEN_BYTES = 32;

export function generateAccountSecurityToken() {
  return randomBytes(ACCOUNT_SECURITY_TOKEN_BYTES).toString("base64url");
}

export function hashAccountSecurityToken(token: string) {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

export function shortTokenHashPrefix(tokenHash: string) {
  return tokenHash.replace(/^sha256:/, "").slice(0, 12);
}

