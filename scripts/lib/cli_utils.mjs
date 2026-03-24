/**
 * Shared CLI argument parsing and type coercion utilities
 * Used across collection, matching, and pipeline scripts
 */

/**
 * Extract CLI argument value by name
 * @param {string[]} args - Array of CLI arguments (e.g., process.argv.slice(2))
 * @param {string} name - Argument name (e.g., "--port")
 * @param {*} fallback - Default value if argument not found
 * @returns {string|null} Argument value or fallback
 */
export function getArg(args, name, fallback = null) {
  const idx = args.findIndex((v) => v === name || v.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}

/**
 * Parse boolean CLI argument
 * @param {string[]} args - Array of CLI arguments
 * @param {string} name - Argument name
 * @param {boolean} fallback - Default value
 * @returns {boolean} Parsed boolean value
 */
export function getBool(args, name, fallback = false) {
  const idx = args.findIndex((v) => v === name || v.startsWith(`${name}=`));
  if (idx === -1) return fallback;

  const raw = args[idx];
  if (raw === name) {
    const next = args[idx + 1];
    if (next === undefined || String(next).startsWith("--")) {
      return true;
    }
    const norm = String(next).trim().toLowerCase();
    if (["1", "true", "yes", "on", "y"].includes(norm)) return true;
    if (["0", "false", "no", "off", "n"].includes(norm)) return false;
    return true;
  }

  const value = getArg(args, name, null);
  if (value === null) return fallback;
  const norm = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(norm)) return true;
  if (["0", "false", "no", "off", "n"].includes(norm)) return false;
  return true;
}

/**
 * Parse integer CLI argument with bounds checking
 * @param {string[]} args - Array of CLI arguments
 * @param {string} name - Argument name
 * @param {number} fallback - Default value
 * @returns {number} Non-negative integer or fallback
 */
export function getInt(args, name, fallback) {
  const raw = getArg(args, name, null);
  const n = Number(raw);
  if (raw === null || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

/**
 * Parse comma-separated list CLI argument
 * @param {string[]} args - Array of CLI arguments
 * @param {string} name - Argument name
 * @param {string[]} fallback - Default array
 * @returns {string[]} Array of trimmed non-empty strings
 */
export function getList(args, name, fallback = []) {
  const raw = getArg(args, name, null);
  if (raw === null) return fallback;
  return raw
    .split(",")
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

/**
 * Check if argument exists (flag check)
 * @param {string[]} args - Array of CLI arguments
 * @param {string} name - Argument name
 * @returns {boolean} True if argument is present
 */
export function hasArg(args, name) {
  return args.some((v) => v === name || v.startsWith(`${name}=`));
}

/**
 * Convert value to text with fallback
 * @param {*} v - Value to convert
 * @param {string} fallback - Default value
 * @returns {string} Trimmed string or fallback
 */
export function toText(v, fallback = "") {
  if (v === null || v === undefined) return fallback;
  const text = String(v).trim();
  return text.length > 0 ? text : fallback;
}

/**
 * Convert value to number with fallback
 * @param {*} v - Value to convert
 * @param {number} fallback - Default value
 * @returns {number} Finite number or fallback
 */
export function safeNum(v, fallback = 0) {
  return Number.isFinite(Number(v)) ? Number(v) : fallback;
}

/**
 * Normalize capacity argument (for sample caps, limits)
 * @param {*} raw - Raw input value
 * @param {number} fallback - Default value
 * @returns {number} Positive integer, Infinity for 0, or fallback
 */
export function normalizeCap(raw, fallback) {
  const parsed = Number(raw);
  if (raw === null || raw === undefined || Number.isNaN(parsed)) return fallback;
  if (parsed < 0) return fallback;
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  if (parsed === 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor(parsed));
}

function toFiniteArgNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Build common numeric filter CLI args used by collectors/adapters.
 * @param {Object} filters
 * @param {*} filters.rentMax
 * @param {*} filters.depositMax
 * @param {*} filters.minAreaM2
 * @returns {string[]} Flat argv segment
 */
export function buildFilterArgs(filters = {}) {
  const args = [];

  const rentMax = toFiniteArgNumber(filters.rentMax);
  const depositMax = toFiniteArgNumber(filters.depositMax);
  const minAreaM2 = toFiniteArgNumber(filters.minAreaM2);

  if (rentMax !== null) args.push("--rent-max", String(rentMax));
  if (depositMax !== null) args.push("--deposit-max", String(depositMax));
  if (minAreaM2 !== null) args.push("--min-area", String(Math.floor(minAreaM2)));

  return args;
}
