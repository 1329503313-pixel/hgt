import { randomInt } from "node:crypto";

const INVITE_CODE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const INVITE_CODE_DIGITS = "0123456789";
const INVITE_CODE_ALPHABET = `${INVITE_CODE_LETTERS}${INVITE_CODE_DIGITS}`;

export const INVITE_CODE_LENGTH = 5;
export const INVITE_CODE_PATTERN = /^[A-Z0-9]{5}$/;
export const INVITE_CODE_FORBIDDEN_FRAGMENTS = [
  "SB",
  "DSB",
  "NMSL",
  "CNM",
  "TMD",
  "WCNM",
  "MLGB",
  "MMP",
  "NC",
  "JB",
  "JJ",
  "250",
  "438",
  "748"
] as const;

function randomCharacter(alphabet: string) {
  return alphabet[randomInt(alphabet.length)];
}

function generateInviteCodeCandidate() {
  const characters = [
    randomCharacter(INVITE_CODE_LETTERS),
    randomCharacter(INVITE_CODE_DIGITS),
    ...Array.from({ length: INVITE_CODE_LENGTH - 2 }, () => randomCharacter(INVITE_CODE_ALPHABET))
  ];
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

export function normalizeInviteCode(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isInviteCodeAllowed(value: unknown) {
  const normalized = normalizeInviteCode(value);
  return INVITE_CODE_PATTERN.test(normalized)
    && !INVITE_CODE_FORBIDDEN_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

export function generateInviteCode() {
  while (true) {
    const candidate = generateInviteCodeCandidate();
    if (isInviteCodeAllowed(candidate)) return candidate;
  }
}
