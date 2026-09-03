const path = require("node:path");
const packageJson = require("../package.json");
const {
  requireStablePackageAuthor,
  resolveExternalSigningCertificate
} = require("./release-policy");

const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE;
const certificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;

if (!certificateFile || !certificatePassword) {
  console.error(
    "Stable Windows release signing is not configured. Set WINDOWS_CERTIFICATE_FILE and WINDOWS_CERTIFICATE_PASSWORD."
  );
  process.exit(1);
}

let publisher;
let resolvedCertificate;

try {
  publisher = requireStablePackageAuthor(packageJson);

  resolvedCertificate = resolveExternalSigningCertificate(
    path.resolve(__dirname, ".."),
    certificateFile
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(
  `Stable Windows signing preflight passed for publisher "${publisher}" with external certificate: ${resolvedCertificate}`
);
