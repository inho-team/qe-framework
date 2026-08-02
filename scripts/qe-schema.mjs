#!/usr/bin/env node
/** Versioned ERD and migration contract CLI. */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../hooks/scripts/lib/store.mjs';
import { openSqlite, closeSqlite, SCHEMA_VERSION } from '../hooks/scripts/lib/store-sqlite.mjs';

const cwd = process.cwd();
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(repoRoot, 'core/store/schema-manifest.json'), 'utf8'));
const action = process.argv[2] || 'status';
const tables = () => {
  const db = openSqlite(cwd, { readOnly: true });
  if (!db) return { version: 0, tables: [] };
  try { return { version: db.prepare('PRAGMA user_version').get().user_version, tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name).sort() }; }
  finally { closeSqlite(db); }
};
if (action === 'migrate') { const store = openStore(cwd); store.close(); }
const actual = tables();
const expected = manifest.schemas[String(manifest.currentSchemaVersion)].tables.slice().sort();
const missing = expected.filter(t => !actual.tables.includes(t));
const result = { frameworkVersion: manifest.frameworkCompatibility[0].framework, declaredSchemaVersion: manifest.currentSchemaVersion, runtimeSchemaVersion: SCHEMA_VERSION, databaseSchemaVersion: actual.version, tables: actual.tables, missing, compatible: actual.version === manifest.currentSchemaVersion && missing.length === 0 };
if (action === 'plan') result.plan = actual.version < manifest.currentSchemaVersion ? `Apply migrations ${actual.version + 1}..${manifest.currentSchemaVersion}` : 'No migration required';
if (action === 'verify' && !result.compatible) { console.error(JSON.stringify(result, null, 2)); process.exit(2); }
if (!['status', 'verify', 'plan', 'migrate'].includes(action)) { console.error('usage: qe-schema.mjs status|verify|plan|migrate'); process.exit(1); }
console.log(JSON.stringify(result, null, 2));
