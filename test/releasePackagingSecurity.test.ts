import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const releasePolicy = require(path.join(process.cwd(), "scripts", "release-policy"));

describe("Release Packaging & Secret Isolation", () => {
  it("normalizes and requires package author for signed releases", () => {
    assert.equal(
      releasePolicy.normalizePackageAuthor("  Example Publisher  "),
      "Example Publisher"
    );

    assert.equal(
      releasePolicy.normalizePackageAuthor({
        name: "  Example Company  "
      }),
      "Example Company"
    );

    assert.equal(releasePolicy.normalizePackageAuthor(""), "");
    assert.equal(releasePolicy.normalizePackageAuthor(null), "");
    assert.equal(releasePolicy.normalizePackageAuthor(undefined), "");

    assert.throws(
      () => {
        releasePolicy.requireStablePackageAuthor({ author: "" });
      },
      /real package\.json author\/publisher/
    );

    assert.throws(
      () => {
        releasePolicy.requireStablePackageAuthor({});
      },
      /real package\.json author\/publisher/
    );

    assert.equal(
      releasePolicy.requireStablePackageAuthor({ author: "Example Publisher" }),
      "Example Publisher"
    );
  });

  it("signing certificate policy rejects repository-local certificate paths", () => {
    const repoRoot = process.cwd();
    const localDir = path.join(repoRoot, ".local");
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const tempCertDir = fs.mkdtempSync(path.join(localDir, "test-cert-"));
    const fakeCertPath = path.join(tempCertDir, "fake-signing.pfx");
    fs.writeFileSync(fakeCertPath, "TEST_ONLY_NOT_A_CERTIFICATE", "utf8");

    try {
      assert.throws(
        () => {
          releasePolicy.resolveExternalSigningCertificate(repoRoot, fakeCertPath);
        },
        /outside the project directory/
      );
    } finally {
      fs.rmSync(tempCertDir, { recursive: true, force: true });
    }
  });

  it("signing certificate policy accepts an existing external path", () => {
    const repoRoot = process.cwd();
    const tmpRoot = os.tmpdir();

    if (releasePolicy.isPathInside(repoRoot, tmpRoot)) {
      return;
    }

    const tempExternalDir = fs.mkdtempSync(path.join(tmpRoot, "ext-cert-"));
    const fakeExternalCert = path.join(tempExternalDir, "external-signing.pfx");
    fs.writeFileSync(fakeExternalCert, "TEST_ONLY_NOT_A_CERTIFICATE", "utf8");

    try {
      const resolved = releasePolicy.resolveExternalSigningCertificate(
        repoRoot,
        fakeExternalCert
      );
      assert.equal(resolved, fs.realpathSync(fakeExternalCert));
      assert.ok(fs.existsSync(fakeExternalCert));
    } finally {
      fs.rmSync(tempExternalDir, { recursive: true, force: true });
    }
  });

  it("Forge packager excludes root and nested signing, environment, and local secrets while retaining dist runtime", () => {
    const savedCertFile = process.env.WINDOWS_CERTIFICATE_FILE;
    const savedCertPass = process.env.WINDOWS_CERTIFICATE_PASSWORD;

    delete process.env.WINDOWS_CERTIFICATE_FILE;
    delete process.env.WINDOWS_CERTIFICATE_PASSWORD;

    let forgeConfig: any;
    try {
      const configPath = path.resolve(process.cwd(), "forge.config.js");
      delete require.cache[require.resolve(configPath)];
      forgeConfig = require(configPath);
    } finally {
      if (savedCertFile !== undefined) process.env.WINDOWS_CERTIFICATE_FILE = savedCertFile;
      if (savedCertPass !== undefined) process.env.WINDOWS_CERTIFICATE_PASSWORD = savedCertPass;
    }

    const ignoreRules = forgeConfig.packagerConfig.ignore;

    function isIgnored(normalizedPath: string): boolean {
      return ignoreRules.some((rule: any) => {
        if (rule instanceof RegExp) {
          rule.lastIndex = 0;
          return rule.test(normalizedPath);
        }
        return false;
      });
    }

    // Required root IGNORED paths
    assert.ok(isIgnored("/.env"), "Must ignore /.env");
    assert.ok(isIgnored("/.env.release"), "Must ignore /.env.release");
    assert.ok(isIgnored("/release-signing.pfx"), "Must ignore /release-signing.pfx");
    assert.ok(isIgnored("/release-signing.PFX"), "Must ignore /release-signing.PFX");
    assert.ok(isIgnored("/release-signing.p12"), "Must ignore /release-signing.p12");
    assert.ok(isIgnored("/private.pem"), "Must ignore /private.pem");
    assert.ok(isIgnored("/private.key"), "Must ignore /private.key");
    assert.ok(isIgnored("/certs/release.pfx"), "Must ignore /certs/release.pfx");
    assert.ok(isIgnored("/.local/private.txt"), "Must ignore /.local/private.txt");
    assert.ok(isIgnored("/src/core/test.ts"), "Must ignore /src/core/test.ts");
    assert.ok(isIgnored("/test/foo.test.ts"), "Must ignore /test/foo.test.ts");
    assert.ok(isIgnored("/scripts/private.js"), "Must ignore /scripts/private.js");
    assert.ok(isIgnored("/public/index.html"), "Must ignore /public/index.html");
    assert.ok(isIgnored("/bin/villager-editor.js"), "Must ignore /bin/villager-editor.js");
    assert.ok(isIgnored("/dist/test/foo.test.js"), "Must ignore /dist/test/foo.test.js");

    // Required nested IGNORED paths
    assert.ok(isIgnored("/config/.env"), "Must ignore nested /config/.env");
    assert.ok(
      isIgnored("/config/.env.production"),
      "Must ignore nested /config/.env.production"
    );
    assert.ok(
      isIgnored("/config/release-signing.pfx"),
      "Must ignore nested certificate files"
    );
    assert.ok(
      isIgnored("/config/certs/private.txt"),
      "Must ignore nested certs directories"
    );
    assert.ok(
      isIgnored("/tools/.local/private.txt"),
      "Must ignore nested .local directories"
    );

    // Required NOT IGNORED paths (packaged runtime)
    assert.equal(isIgnored("/dist/src/electron/main.js"), false, "Must not ignore dist main");
    assert.equal(isIgnored("/dist/src/main/preload.js"), false, "Must not ignore dist preload");
    assert.equal(isIgnored("/dist/public/index.html"), false, "Must not ignore dist html");
    assert.equal(isIgnored("/dist/public/app.js"), false, "Must not ignore dist app");
    assert.equal(isIgnored("/package.json"), false, "Must not ignore package.json");
    assert.equal(isIgnored("/LICENSE"), false, "Must not ignore LICENSE");
    assert.equal(isIgnored("/THIRD_PARTY_NOTICES.md"), false, "Must not ignore notices");
  });

  it("Forge Squirrel author derives from package.json rather than environment override", () => {
    const forgeSource = fs.readFileSync(
      path.resolve(process.cwd(), "forge.config.js"),
      "utf8"
    );

    assert.ok(forgeSource.includes("normalizePackageAuthor"));
    assert.ok(forgeSource.includes("packageJson.author"));
    assert.ok(forgeSource.includes("authors: squirrelAuthors"));
    assert.equal(forgeSource.includes("RELEASE_AUTHOR"), false, "Must not reference RELEASE_AUTHOR");

    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
    );

    const savedCertFile = process.env.WINDOWS_CERTIFICATE_FILE;
    const savedCertPass = process.env.WINDOWS_CERTIFICATE_PASSWORD;
    delete process.env.WINDOWS_CERTIFICATE_FILE;
    delete process.env.WINDOWS_CERTIFICATE_PASSWORD;

    try {
      const configPath = path.resolve(process.cwd(), "forge.config.js");
      delete require.cache[require.resolve(configPath)];
      const forgeConfig = require(configPath);
      const squirrelMaker = forgeConfig.makers.find(
        (m: any) => m.name === "@electron-forge/maker-squirrel"
      );
      assert.ok(squirrelMaker);

      if (!pkg.author || pkg.author.trim() === "") {
        assert.equal(
          squirrelMaker.config.authors,
          "Bedrock Villager Editor contributors"
        );
      } else {
        assert.equal(
          squirrelMaker.config.authors,
          releasePolicy.normalizePackageAuthor(pkg.author)
        );
      }
    } finally {
      if (savedCertFile !== undefined) process.env.WINDOWS_CERTIFICATE_FILE = savedCertFile;
      if (savedCertPass !== undefined) process.env.WINDOWS_CERTIFICATE_PASSWORD = savedCertPass;
    }
  });

  it("gitignore excludes signing and environment secrets", () => {
    const gitignore = fs.readFileSync(
      path.resolve(process.cwd(), ".gitignore"),
      "utf8"
    );

    assert.ok(gitignore.includes(".env"));
    assert.ok(gitignore.includes(".env.*"));
    assert.ok(gitignore.includes("*.pfx"));
    assert.ok(gitignore.includes("*.p12"));
    assert.ok(gitignore.includes("*.pem"));
    assert.ok(gitignore.includes("*.key"));
    assert.ok(gitignore.includes("certs/"));
    assert.ok(gitignore.includes(".local/"));
  });

  it("third-party notice distinguishes provenance metadata from integrity manifest", () => {
    const notice = fs.readFileSync(
      path.resolve(process.cwd(), "THIRD_PARTY_NOTICES.md"),
      "utf8"
    );

    assert.ok(notice.includes("public/assets/asset-provenance.json"));
    assert.ok(notice.includes("source version"));
    assert.ok(notice.includes("byte sizes"));
    assert.ok(notice.includes("SHA-256"));
    assert.ok(notice.includes("They do not record source-version provenance."));
    assert.equal(
      notice.includes(
        "The `dist/public/asset-manifest.json` file records source-version provenance and integrity hashes."
      ),
      false
    );
  });

  it("signed Squirrel configuration uses modern windowsSign with timestamping", () => {
    const forgeSource = fs.readFileSync(
      path.resolve(process.cwd(), "forge.config.js"),
      "utf8"
    );

    assert.ok(
      forgeSource.includes("windowsSign:"),
      "Signed Squirrel config must use modern windowsSign"
    );

    assert.ok(
      forgeSource.includes("timestampServer:"),
      "Signed Squirrel config must configure a timestamp server"
    );

    assert.ok(
      forgeSource.includes("http://timestamp.digicert.com"),
      "Signed Squirrel config must use the locked timestamp server"
    );

    assert.ok(
      forgeSource.includes("resolveExternalSigningCertificate"),
      "Signed config must continue using external certificate resolution"
    );

    assert.equal(
      /signingConfig\s*=\s*\{\s*certificateFile\s*:/s.test(forgeSource),
      false,
      "Do not use legacy top-level Squirrel certificateFile signing"
    );

    assert.equal(
      /signWithParams\s*:/.test(forgeSource),
      false,
      "Do not use legacy custom signWithParams"
    );
  });
});
