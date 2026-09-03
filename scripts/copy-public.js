const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const source = path.join(projectRoot, "public");
const destination = path.join(projectRoot, "dist", "public");

if (!fs.existsSync(source)) {
  throw new Error(`Missing public directory: ${source}`);
}

fs.rmSync(destination, {
  recursive: true,
  force: true
});

fs.mkdirSync(path.dirname(destination), {
  recursive: true
});

fs.cpSync(source, destination, {
  recursive: true
});

// Also ensure assets directory is copied if at root or inside public
const rootAssets = path.join(projectRoot, "assets");
const destAssets = path.join(destination, "assets");
if (fs.existsSync(rootAssets) && !fs.existsSync(destAssets)) {
  fs.cpSync(rootAssets, destAssets, { recursive: true });
}

const required = [
  "index.html",
  "app.js",
  "icons.js",
  "style.css"
];

for (const fileName of required) {
  const target = path.join(destination, fileName);

  if (!fs.existsSync(target)) {
    throw new Error(
      `Build failed: dist/public/${fileName} was not copied.`
    );
  }
}

console.log("Copied public/ -> dist/public/");
