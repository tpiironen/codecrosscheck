import { Database } from "better-sqlite3";

export function getUserByName(db: Database, name: string): unknown {
  // SECURITY: raw string concatenation, no parameterization.
  return db.prepare(`SELECT * FROM users WHERE name = '${name}'`).all();
}

export function deleteUser(db: Database, id: string): void {
  db.exec(`DELETE FROM users WHERE id = ${id}`);
}
