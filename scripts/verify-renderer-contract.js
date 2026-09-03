const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const validationTs = fs.readFileSync(path.join(root, "src", "core", "validation.ts"), "utf8");

const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]));

const rendererIds = new Set(
  [...appJs.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
);

const missingIds = [...rendererIds].filter((id) => !htmlIds.has(id));

if (missingIds.length > 0) {
  throw new Error(`Renderer references missing DOM IDs: ${missingIds.join(", ")}`);
}

const rendererKinds = new Set(
  [...appJs.matchAll(/\bkind\s*:\s*["']([A-Z][A-Z0-9_]*)["']/g)].map((m) => m[1])
);

const schemaKinds = new Set(
  [...validationTs.matchAll(/\bkind\s*:\s*z\.literal\(\s*["']([A-Z][A-Z0-9_]*)["']\s*\)/g)].map(
    (m) => m[1]
  )
);

const unsupportedKinds = [...rendererKinds].filter((kind) => !schemaKinds.has(kind));

if (unsupportedKinds.length > 0) {
  throw new Error(
    `Renderer emits command kinds missing from sessionCommandSchema: ${unsupportedKinds.join(", ")}`
  );
}

console.log(
  `Renderer contract verification passed: ${rendererIds.size} literal DOM IDs and ${rendererKinds.size} renderer command kinds verified.`
);
