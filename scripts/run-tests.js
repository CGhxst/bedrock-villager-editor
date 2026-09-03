const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const testDir = path.join(__dirname, "..", "dist", "test");

if (!fs.existsSync(testDir)) {
  throw new Error(`Test directory does not exist: ${testDir}. Did you run build?`);
}

const files = fs
  .readdirSync(testDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join(testDir, name));

if (files.length === 0) {
  throw new Error("No compiled tests found in dist/test.");
}

console.log(`Discovered ${files.length} compiled test suite(s):`);
files.forEach((f) => console.log(` - ${path.basename(f)}`));

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit"
});

process.exit(result.status ?? 1);
