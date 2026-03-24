/**
 * Integration test: Backward compatibility
 *
 * Verifies that old-format buildOutput (single string) stored in DB
 * can be correctly normalized, validated, and used in the execute flow.
 *
 * Run: npx tsx test/test-backward-compat.ts
 */

import { normalizeDavidResult, serializeDavidResult } from '../lib/shared-types';
import { validateSyntax } from '../lib/syntax-validator';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  // ── Test 1: Old format DB value -> normalize -> validate ──

  console.log('\n1. Old DB format (JSON.stringify of old DavidResult):');
  {
    // This is what a floor.buildOutput looks like in the database (old format)
    const dbValue = JSON.stringify({
      buildOutput: 'const http = require("http");\nconst server = http.createServer((req, res) => {\n  res.end("Hello World");\n});\nserver.listen(3000);',
      language: 'javascript',
      entryPoint: 'server.js',
      dependencies: ['http'],
      selfAuditReport: 'Simple HTTP server.',
      handoffNotes: 'Run: node server.js',
    });

    // Simulate what the pipeline does: JSON.parse the DB value, then normalize
    const parsed = JSON.parse(dbValue);
    const normalized = normalizeDavidResult(parsed);

    assert(normalized.files.length === 1, 'has 1 file');
    assert(normalized.files[0].name === 'server.js', 'file named from entryPoint');
    assert(normalized.files[0].content.includes('http.createServer'), 'code preserved');
    assert(normalized.language === 'javascript', 'language preserved');
    assert(normalized.entryPoint === 'server.js', 'entryPoint preserved');

    // Validate syntax
    const syntaxResult = await validateSyntax(normalized.files);
    assert(syntaxResult.valid === true, 'old code passes syntax check');

    // Re-serialize into new format
    const newSerialized = serializeDavidResult(normalized);
    const reparsed = JSON.parse(newSerialized);
    assert(Array.isArray(reparsed.files), 'new format has files array');
    assert(typeof reparsed.buildOutput === 'string', 'new format has buildOutput for compat');
  }

  // ── Test 2: Raw code string (no JSON wrapper) ──

  console.log('\n2. Raw code string (no JSON wrapper):');
  {
    const rawCode = 'import os\nprint(os.getcwd())';

    // What execute does: try JSON.parse, fail, treat as raw
    const normalized = normalizeDavidResult(rawCode);
    assert(normalized.files.length === 1, 'has 1 file');
    assert(normalized.files[0].content === rawCode, 'content is raw code');
  }

  // ── Test 3: serializeDavidResult produces backward-compat output ──

  console.log('\n3. Serialized output has both files[] and buildOutput:');
  {
    const normalized = normalizeDavidResult({
      files: [{ name: 'index.js', content: 'const x = 1;' }],
      language: 'javascript',
      entryPoint: 'index.js',
      dependencies: [],
      selfAuditReport: 'ok',
      handoffNotes: 'done',
    });

    const serialized = serializeDavidResult(normalized);
    const obj = JSON.parse(serialized);

    assert(Array.isArray(obj.files), 'has files[]');
    assert(typeof obj.buildOutput === 'string', 'has buildOutput string');
    assert(obj.buildOutput === 'const x = 1;', 'buildOutput matches single file content');
  }

  // ── Test 4: Multi-file serialization creates combined buildOutput ──

  console.log('\n4. Multi-file serialization creates combined buildOutput:');
  {
    const normalized = normalizeDavidResult({
      files: [
        { name: 'a.js', content: 'const a = 1;' },
        { name: 'b.js', content: 'const b = 2;' },
      ],
      language: 'javascript',
      entryPoint: 'a.js',
      dependencies: [],
      selfAuditReport: 'ok',
      handoffNotes: 'done',
    });

    const serialized = serializeDavidResult(normalized);
    const obj = JSON.parse(serialized);

    assert(typeof obj.buildOutput === 'string', 'has buildOutput');
    assert(obj.buildOutput.includes('--- a.js ---'), 'buildOutput has a.js marker');
    assert(obj.buildOutput.includes('--- b.js ---'), 'buildOutput has b.js marker');
    assert(obj.buildOutput.includes('const a = 1;'), 'buildOutput has a.js content');
    assert(obj.buildOutput.includes('const b = 2;'), 'buildOutput has b.js content');
  }

  // ── Summary ───────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
