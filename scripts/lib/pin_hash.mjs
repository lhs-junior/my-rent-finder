// scripts/lib/pin_hash.mjs
import { createHash } from "node:crypto";

export function hashPin(pin) {
  if (!pin || typeof pin !== "string") throw new Error("PIN required");
  return createHash("sha256").update(`mrf:${pin}`).digest("hex");
}
