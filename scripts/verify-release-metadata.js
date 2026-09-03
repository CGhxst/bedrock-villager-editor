const fs = require("node:fs");
const path = require("node:path");

const isStable = process.argv.includes("--stable");
const root = path.resolve(__dirname, "..");

let hasErrors = false;

function reportError(msg) {
  console.error(`ERROR: ${msg}`);
  hasErrors = true;
}

// 1. Check required files existence
const requiredFiles = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "package.json",
  path.join("public", "index.html")
];

for (const f of requiredFiles) {
  const full = path.join(root, f);
  if (!fs.existsSync(full)) {
    reportError(`Required release file missing: ${f}`);
  }
}

if (hasErrors) {
  process.exit(1);
}

// 2. Check package.json metadata
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

if (pkg.productName !== "Bedrock Villager Editor") {
  reportError(`package.json productName must be "Bedrock Villager Editor", got: "${pkg.productName}"`);
}

if (isStable) {
  if (!pkg.author || typeof pkg.author !== "string" || pkg.author.trim() === "") {
    reportError("package.json author is missing or blank. A real publisher identity is required for stable release.");
  }
} else if (!pkg.author || typeof pkg.author !== "string" || pkg.author.trim() === "") {
  console.warn("NOTICE: package.json author is empty (manual release gate pending).");
}

// 3. Check README.md content
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

if (readme.startsWith("# Minecraft ")) {
  reportError('README.md must not start with "# Minecraft ". Use "# Bedrock Villager Editor".');
}

const disclaimer = "NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.";
if (!readme.includes(disclaimer)) {
  reportError(`README.md is missing unofficial product disclaimer: "${disclaimer}"`);
}

// 4. Check public/index.html visible disclaimer
const appHtml = fs.readFileSync(
  path.join(root, "public", "index.html"),
  "utf8"
);

if (!appHtml.includes(disclaimer) || !appHtml.includes('class="unofficial-product-notice"')) {
  reportError("public/index.html is missing the visible unofficial-product disclaimer.");
}

if (hasErrors) {
  process.exit(1);
}

console.log("Release metadata verification passed.");
