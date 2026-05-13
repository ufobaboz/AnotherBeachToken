// Input: <table>.jsonl da `psql \copy (select row_to_json(t) ...) TO STDOUT`.
// Output: <table>.ita.csv (BOM UTF-8 + Csv.serialize, vedi public/assets/csv.js).
// COLUMNS sync con schema.sql e supabase/functions/reset-season/index.ts.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// csv.js e' un IIFE che assegna module.exports in Node CommonJS; createRequire
// permette di importarlo come CJS da questo script ESM.
const require = createRequire(import.meta.url);
const Csv = require('../public/assets/csv.js');

const COLUMNS = {
  customers: [
    'id', 'qr_token', 'first_name', 'last_name', 'email', 'phone', 'notes',
    'created_by_id', 'last_modified_by_id', 'last_modified_at',
    'created_at', 'deleted_at'
  ],
  transactions: [
    'id', 'customer_id', 'user_id', 'type', 'amount', 'reversal_of_id',
    'paid', 'paid_at', 'payment_method', 'paid_by_id', 'notes',
    'created_at', 'deleted_at'
  ],
  profiles: [
    'id', 'first_name', 'last_name', 'role', 'last_login_at', 'notes',
    'created_at', 'last_modified_by_id', 'last_modified_at', 'deleted_at'
  ]
};

const TABLES = Object.keys(COLUMNS);
const BOM = '﻿';

function parseJsonLines(content) {
  const rows = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

for (const table of TABLES) {
  const jsonl = readFileSync(`${table}.jsonl`, 'utf8');
  const rows = parseJsonLines(jsonl);
  const csv = Csv.serialize(rows, COLUMNS[table]);
  writeFileSync(`${table}.ita.csv`, BOM + csv, { encoding: 'utf8' });
  process.stdout.write(`generated ${table}.ita.csv (${rows.length} rows)\n`);
}
