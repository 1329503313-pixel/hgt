import type mysql from "mysql2/promise";
import { pool } from "./db.js";
import { rebuildAtomicFactsForSoup } from "./game.js";
import { rebuildAllAiAtomicFacts } from "./keyFactBackfill.js";

type PreservationRow = mysql.RowDataPacket & {
  id: string;
  key_facts_digest: string | null;
  key_facts_hash: string | null;
  key_facts_customized: number;
  atom_count: number | null;
  key_fact_atoms_hash: string | null;
};

async function loadPreservationRows() {
  const [rows] = await pool.query<PreservationRow[]>(
    `SELECT s.id,
       SHA2(CAST(s.key_facts AS CHAR), 256) AS key_facts_digest,
       s.key_facts_hash,
       s.key_facts_customized,
       JSON_LENGTH(s.key_fact_atoms) AS atom_count,
       s.key_fact_atoms_hash
     FROM soups s
     JOIN users creator ON creator.id = s.creator_id
     WHERE s.enable_ai_game = 1
       AND creator.role IN ('super_admin','backoffice_admin','admin','vip')
     ORDER BY s.id ASC`,
  );
  return rows;
}

async function main() {
  if (!process.argv.includes("--confirm-rebuild")) {
    throw new Error("AI atomic fact rebuild requires --confirm-rebuild");
  }

  const before = await loadPreservationRows();
  const result = await rebuildAllAiAtomicFacts(pool, rebuildAtomicFactsForSoup, 2);
  const after = await loadPreservationRows();
  const beforeById = new Map(before.map((row) => [String(row.id), row]));
  const preservedRows = after.filter((row) => {
    const previous = beforeById.get(String(row.id));
    return previous
      && previous.key_facts_digest === row.key_facts_digest
      && previous.key_facts_hash === row.key_facts_hash
      && Number(previous.key_facts_customized) === Number(row.key_facts_customized);
  }).length;
  const readyAtomCount = after.filter((row) => Number(row.atom_count ?? 0) > 0 && Boolean(row.key_fact_atoms_hash)).length;
  const preservedKeyFacts = before.length === after.length && preservedRows === before.length;
  console.log(JSON.stringify({
    total: result.total,
    rebuilt: result.rebuilt,
    skippedCount: result.skipped.length,
    failedCount: result.failed.length,
    skipped: result.skipped,
    failed: result.failed,
    preservedKeyFacts,
    preservedRows,
    readyAtomCount,
  }));
  if (
    result.failed.length > 0
    || result.rebuilt + result.skipped.length !== result.total
    || !preservedKeyFacts
    || readyAtomCount !== after.length
  ) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
