/**
 * grants.ts — Persistent in-memory grant registry
 *
 * Tracks which (agent, borrower) pairs have already been granted FHE access
 * so the server doesn't charge twice for the same pair. Backed by a JSON
 * file so grants survive server restarts.
 */

import fs from "fs";
import path from "path";

const GRANTS_FILE = path.resolve(__dirname, "../../data/grants.json");

interface GrantRecord {
  agentAddress: string;
  borrowerAddress: string;
  txHash: string;       // payment tx
  onChainTx: string;    // grantAgentAccess tx
  grantedAt: string;    // ISO timestamp
}

// In-memory store keyed by "agent:borrower" (lowercased)
const grants = new Map<string, GrantRecord>();

function key(agent: string, borrower: string): string {
  return `${agent.toLowerCase()}:${borrower.toLowerCase()}`;
}

/** Load persisted grants from disk on startup */
export function loadGrants(): void {
  try {
    if (fs.existsSync(GRANTS_FILE)) {
      const raw = fs.readFileSync(GRANTS_FILE, "utf8");
      const records: GrantRecord[] = JSON.parse(raw);
      for (const r of records) {
        grants.set(key(r.agentAddress, r.borrowerAddress), r);
      }
      console.log(`[Grants] Loaded ${grants.size} existing grant(s) from disk.`);
    }
  } catch (e) {
    console.warn("[Grants] Could not load grants file — starting fresh.", e);
  }
}

/** Persist current grants to disk */
function saveGrants(): void {
  try {
    const dir = path.dirname(GRANTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(GRANTS_FILE, JSON.stringify([...grants.values()], null, 2));
  } catch (e) {
    console.error("[Grants] Failed to persist grants:", e);
  }
}

/** Check whether a (agent, borrower) pair already has access */
export function hasGrant(agentAddress: string, borrowerAddress: string): boolean {
  return grants.has(key(agentAddress, borrowerAddress));
}

/** Record a newly granted access pair */
export function recordGrant(record: GrantRecord): void {
  grants.set(key(record.agentAddress, record.borrowerAddress), record);
  saveGrants();
}

/** Return all stored grants (for admin/debug) */
export function allGrants(): GrantRecord[] {
  return [...grants.values()];
}
