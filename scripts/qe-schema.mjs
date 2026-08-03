#!/usr/bin/env node
/** Versioned ERD and migration contract CLI. */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqlite, closeSqlite, SCHEMA_VERSION } from '../hooks/scripts/lib/store-sqlite.mjs';
import { findSchemaCompatibility } from './lib/schema_compatibility.mjs';

const cwd = process.cwd();
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(repoRoot, 'core/store/schema-manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const action = process.argv[2] || 'status';
if (!['status', 'verify', 'plan', 'migrate'].includes(action)) {
  console.error('usage: qe-schema.mjs status|verify|plan|migrate');
  process.exit(1);
}
const tables = () => {
  const db = openSqlite(cwd, { readOnly: true });
  if (!db) return { version: 0, tables: [] };
  try { return { version: db.prepare('PRAGMA user_version').get().user_version, tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name).sort() }; }
  finally { closeSqlite(db); }
};
if (action === 'migrate') {
  const db = openSqlite(cwd);
  if (!db) {
    console.error(`qe-schema: unable to open or migrate ${join(cwd, '.qe', 'qe.db')}`);
    process.exit(2);
  }
  closeSqlite(db);
}
const actual = tables();
const expected = manifest.schemas[String(manifest.currentSchemaVersion)].tables.slice().sort();
const missing = expected.filter(t => !actual.tables.includes(t));
const compatibility = findSchemaCompatibility(manifest, pkg.version);
const result = {
  installedFrameworkVersion: pkg.version,
  frameworkVersion: compatibility?.framework || null,
  declaredSchemaVersion: manifest.currentSchemaVersion,
  runtimeSchemaVersion: SCHEMA_VERSION,
  databaseSchemaVersion: actual.version,
  tables: actual.tables,
  missing,
  compatible: compatibility?.schema === manifest.currentSchemaVersion
    && actual.version === manifest.currentSchemaVersion
    && missing.length === 0,
};
if (action === 'plan') result.plan = actual.version < manifest.currentSchemaVersion ? `Apply migrations ${actual.version + 1}..${manifest.currentSchemaVersion}` : 'No migration required';
if (action === 'verify' && !result.compatible) { console.error(JSON.stringify(result, null, 2)); process.exit(2); }
console.log(JSON.stringify(result, null, 2));
