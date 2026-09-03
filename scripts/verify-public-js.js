const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

const files = [
  path.join(root, "public", "app.js"),
  path.join(root, "public", "icons.js")
];

for (const file of files) {
  const result = spawnSync(
    process.execPath,
    ["--check", file],
    {
      stdio: "inherit"
    }
  );

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log("Public JavaScript syntax verification passed.");
