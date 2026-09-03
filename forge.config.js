const path = require("node:path");
const packageJson = require("./package.json");
const {
  normalizePackageAuthor,
  requireStablePackageAuthor,
  resolveExternalSigningCertificate
} = require("./scripts/release-policy");

const certificateFile =
  process.env.WINDOWS_CERTIFICATE_FILE || "";

const certificatePassword =
  process.env.WINDOWS_CERTIFICATE_PASSWORD || "";

const hasCertificateFile =
  certificateFile.trim() !== "";

const hasCertificatePassword =
  certificatePassword !== "";

if (
  hasCertificateFile !==
  hasCertificatePassword
) {
  throw new Error(
    "Windows signing configuration is incomplete. Set both WINDOWS_CERTIFICATE_FILE and WINDOWS_CERTIFICATE_PASSWORD, or neither."
  );
}

const signingConfigured =
  hasCertificateFile &&
  hasCertificatePassword;

const packageAuthor =
  normalizePackageAuthor(
    packageJson.author
  );

const squirrelAuthors =
  packageAuthor ||
  "Bedrock Villager Editor contributors";

let signingConfig = {};

if (signingConfigured) {
  requireStablePackageAuthor(
    packageJson
  );

  signingConfig = {
    windowsSign: {
      certificateFile:
        resolveExternalSigningCertificate(
          __dirname,
          certificateFile
        ),
      certificatePassword,
      timestampServer:
        "http://timestamp.digicert.com"
    }
  };
}

const squirrelConfig = {
  name: "bedrock_villager_editor",
  authors: squirrelAuthors,
  setupExe: "Bedrock-Villager-Editor-Setup.exe",
  setupIcon: path.resolve(__dirname, "public/icon.ico"),
  noMsi: true,
  ...signingConfig
};

module.exports = {
  packagerConfig: {
    asar: true,
    prune: true,
    icon: path.resolve(__dirname, "public/icon"),
    ignore: [
      /^\/src($|\/)/,
      /^\/test($|\/)/,
      /^\/scripts($|\/)/,
      /^\/public($|\/)/,
      /^\/bin($|\/)/,
      /^\/Launch-Villager-Editor\.bat$/,
      /^\/dist\/test($|\/)/,
      /(?:^|\/)\.env(?:\..*)?$/i,
      /\.(?:pfx|p12|pem|key)$/i,
      /(?:^|\/)certs(?:$|\/)/i,
      /(?:^|\/)\.local(?:$|\/)/,
      /^\/CODEBASE_EXPORT.*\.txt$/i,
      /^\/tsconfig\.json$/i,
      /^\/forge\.config\.js$/i,
      /^\/\.github($|\/)/i,
      /^\/\.gitignore$/i,
      /(?:^|\/)@8crafter\/leveldb-zlib\/prebuilds\/(?:darwin|linux)/i
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: squirrelConfig
    }
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {}
    }
  ]
};
