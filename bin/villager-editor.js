#!/usr/bin/env node

const path = require("path");
const fs = require("fs");

let distCli = path.join(__dirname, "..", "dist", "src", "cli", "cli.js");
if (!fs.existsSync(distCli)) {
  distCli = path.join(__dirname, "..", "dist", "cli", "cli.js");
}

if (!fs.existsSync(distCli)) {
  console.log("Compiling TypeScript sources...");
  const { execSync } = require("child_process");
  execSync("npm run build", { cwd: path.join(__dirname, ".."), stdio: "inherit" });
}

const cliModule = require(distCli);
if (typeof cliModule.runCli === "function") {
  cliModule.runCli();
}
