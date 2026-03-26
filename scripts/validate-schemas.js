#!/usr/bin/env node

/**
 * Schema Validation Script
 *
 * Uses ajv (JSON Schema 2020-12) to validate:
 * 1. All schema files compile successfully (meta-validation)
 * 2. Example manifests conform to the service-manifest schema
 *
 * Usage:
 *   node scripts/validate-schemas.js
 */

const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const ROOT = path.resolve(__dirname, "..");
const SCHEMAS_DIR = path.join(ROOT, "schemas");
const MANIFESTS_DIR = path.join(ROOT, "examples", "manifests");

let errors = 0;
let passed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${label}: ${e.message}`);
    errors++;
  }
}

function loadJSON(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function formatErrors(errs) {
  return errs
    .map((e) => `    ${e.instancePath || "/"} ${e.message}`)
    .join("\n");
}

// --- Phase 1: Meta-validation (ajv compile) ---

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);

const schemaFiles = fs.readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith(".json"));

// First pass: register all schemas and collect $id values so $ref resolution works
const schemaIds = [];
for (const file of schemaFiles) {
  const schema = loadJSON(path.join(SCHEMAS_DIR, file));
  ajv.addSchema(schema);
  schemaIds.push({ file, id: schema.$id });
}

// Second pass: compile each schema to verify structural correctness
console.log("\n--- Schemas: meta-validation (ajv compile) ---");
for (const { file, id } of schemaIds) {
  check(file, () => {
    const validate = ajv.getSchema(id);
    if (!validate) {
      throw new Error(`Failed to compile schema (no $id or not registered): ${file}`);
    }
  });
}

// --- Phase 2: Instance validation ---
console.log("\n--- Manifests: instance validation ---");

const MANIFEST_SCHEMA_ID =
  "https://mcp-extension-proposals.github.io/schemas/service-manifest.json";

const validateManifest = ajv.getSchema(MANIFEST_SCHEMA_ID);
if (!validateManifest) {
  console.error(
    `  FAIL  Could not retrieve compiled validator for ${MANIFEST_SCHEMA_ID}`
  );
  errors++;
} else {
  const manifestFiles = fs
    .readdirSync(MANIFESTS_DIR)
    .filter((f) => f.endsWith(".json"));

  if (manifestFiles.length === 0) {
    console.warn("  WARN  No manifest files found in " + MANIFESTS_DIR);
  }

  for (const file of manifestFiles) {
    const manifest = loadJSON(path.join(MANIFESTS_DIR, file));
    check(file, () => {
      const valid = validateManifest(manifest);
      if (!valid) {
        throw new Error(
          "Validation failed:\n" + formatErrors(validateManifest.errors)
        );
      }
    });
  }
}

// --- Summary ---
console.log(`\n--- Summary ---`);
console.log(`  ${passed} passed, ${errors} failed`);
process.exit(errors > 0 ? 1 : 0);
