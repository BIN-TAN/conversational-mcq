import { randomInt } from "node:crypto";
import { hashSecret } from "@/lib/password";

const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const DEFAULT_ACCESS_CODE_LENGTH = 16;

export type AccessCodeGenerator = () => string;

export function generateAccessCode(length = DEFAULT_ACCESS_CODE_LENGTH) {
  let code = "";

  for (let index = 0; index < length; index += 1) {
    code += ACCESS_CODE_ALPHABET[randomInt(ACCESS_CODE_ALPHABET.length)];
  }

  return code;
}

export async function generateHashedAccessCode(generator: AccessCodeGenerator = generateAccessCode) {
  const accessCode = generator();

  return {
    access_code: accessCode,
    access_code_hash: await hashSecret(accessCode)
  };
}
