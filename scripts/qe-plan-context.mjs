#!/usr/bin/env node
'use strict';

/** Internal Plan preflight CLI. It is intentionally not a user-facing skill. */

import { retrievePlanKnowledge, formatPlanKnowledge } from '../hooks/scripts/lib/plan-knowledge.mjs';

const intent = process.argv.slice(2).join(' ').trim();
if (!intent) {
  process.stderr.write('usage: qe-plan-context.mjs <goal intent>\n');
  process.exit(2);
}

const pack = retrievePlanKnowledge(process.cwd(), intent);
process.stdout.write(`${formatPlanKnowledge(pack)}\n`);
