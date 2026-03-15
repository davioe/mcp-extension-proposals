#!/usr/bin/env node

/**
 * Schema Validation Script
 *
 * Validates that:
 * 1. All schema files are valid JSON
 * 2. All example manifests are valid JSON
 * 3. Example manifests conform to the service-manifest schema structure
 *
 * No external dependencies required — uses only Node.js built-ins.
 * For full JSON Schema Draft-07 validation, consider using `ajv`.
 *
 * Usage:
 *   node scripts/validate-schemas.js
 */

const fs = require("fs");
const path = require("path");

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

// --- 1. Validate all schemas are valid JSON ---
console.log("\n--- Schemas: valid JSON ---");
const schemaFiles = fs.readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith(".json"));
const schemas = {};

for (const file of schemaFiles) {
  const filePath = path.join(SCHEMAS_DIR, file);
  check(file, () => {
    const schema = loadJSON(filePath);
    schemas[file] = schema;

    if (!schema.$schema) throw new Error("Missing $schema field");
    if (!schema.title) throw new Error("Missing title field");
    if (!schema.description) throw new Error("Missing description field");
  });
}

// --- 2. Validate all manifests are valid JSON ---
console.log("\n--- Manifests: valid JSON ---");
const manifestFiles = fs.readdirSync(MANIFESTS_DIR).filter((f) => f.endsWith(".json"));
const manifests = {};

for (const file of manifestFiles) {
  const filePath = path.join(MANIFESTS_DIR, file);
  check(file, () => {
    manifests[file] = loadJSON(filePath);
  });
}

// --- 3. Structural validation of manifests against service-manifest schema ---
console.log("\n--- Manifests: structural validation ---");

const serviceManifestSchema = schemas["service-manifest.schema.json"];
if (!serviceManifestSchema) {
  console.error("  FAIL  service-manifest.schema.json not found — skipping structural validation");
  errors++;
} else {
  const requiredTopLevel = serviceManifestSchema.required || [];
  const requiredServer = serviceManifestSchema.properties?.server?.required || [];
  const validExtensions = serviceManifestSchema.properties?.supported_extensions?.items?.enum || [];
  const validAuthMethods = serviceManifestSchema.$defs?.AuthCapabilities?.properties?.methods?.items?.enum || [];
  const validLatencies = serviceManifestSchema.$defs?.ToolDefinition?.properties?.latency?.enum || [];
  const validRiskLevels = serviceManifestSchema.$defs?.ToolDefinition?.properties?.risk_level?.enum || [];
  const validCostCategories = serviceManifestSchema.$defs?.CostInfo?.properties?.category?.enum || [];

  for (const [file, manifest] of Object.entries(manifests)) {
    // Required top-level fields
    check(`${file}: required top-level fields`, () => {
      for (const field of requiredTopLevel) {
        if (!(field in manifest)) throw new Error(`Missing required field: ${field}`);
      }
    });

    // Required server fields
    check(`${file}: required server fields`, () => {
      for (const field of requiredServer) {
        if (!(field in manifest.server)) throw new Error(`Missing server.${field}`);
      }
    });

    // Validate supported_extensions values
    if (manifest.supported_extensions && validExtensions.length > 0) {
      check(`${file}: supported_extensions values`, () => {
        for (const ext of manifest.supported_extensions) {
          if (!validExtensions.includes(ext)) {
            throw new Error(`Unknown extension: "${ext}". Valid: ${validExtensions.join(", ")}`);
          }
        }
      });
    }

    // Validate auth methods
    if (manifest.auth?.methods && validAuthMethods.length > 0) {
      check(`${file}: auth method values`, () => {
        for (const method of manifest.auth.methods) {
          if (!validAuthMethods.includes(method)) {
            throw new Error(`Unknown auth method: "${method}". Valid: ${validAuthMethods.join(", ")}`);
          }
        }
      });
    }

    // Validate each tool
    if (Array.isArray(manifest.tools)) {
      for (const tool of manifest.tools) {
        const toolLabel = `${file}: tool "${tool.name}"`;

        check(`${toolLabel}: required fields`, () => {
          if (!tool.name) throw new Error("Missing tool name");
          if (!tool.description) throw new Error("Missing tool description");
          if (!tool.input_schema) throw new Error("Missing tool input_schema");
        });

        if (tool.latency && validLatencies.length > 0) {
          check(`${toolLabel}: latency value`, () => {
            if (!validLatencies.includes(tool.latency)) {
              throw new Error(`Invalid latency: "${tool.latency}". Valid: ${validLatencies.join(", ")}`);
            }
          });
        }

        if (tool.risk_level && validRiskLevels.length > 0) {
          check(`${toolLabel}: risk_level value`, () => {
            if (!validRiskLevels.includes(tool.risk_level)) {
              throw new Error(`Invalid risk_level: "${tool.risk_level}". Valid: ${validRiskLevels.join(", ")}`);
            }
          });
        }

        if (tool.cost?.category && validCostCategories.length > 0) {
          check(`${toolLabel}: cost category`, () => {
            if (!validCostCategories.includes(tool.cost.category)) {
              throw new Error(`Invalid cost category: "${tool.cost.category}". Valid: ${validCostCategories.join(", ")}`);
            }
          });
        }

        // Confirmation consistency
        if (tool.requires_confirmation) {
          check(`${toolLabel}: confirmation_message present`, () => {
            if (!tool.confirmation_message) {
              throw new Error("requires_confirmation is true but no confirmation_message provided");
            }
          });
        }
      }
    }
  }
}

// --- Summary ---
console.log(`\n--- Summary ---`);
console.log(`  ${passed} passed, ${errors} failed`);
process.exit(errors > 0 ? 1 : 0);
