const fs = require("node:fs");
const path = require("node:path");

function normalizePackageAuthor(author) {
  if (typeof author === "string") {
    return author.trim();
  }

  if (
    author &&
    typeof author === "object" &&
    typeof author.name === "string"
  ) {
    return author.name.trim();
  }

  return "";
}

function requireStablePackageAuthor(packageJson) {
  const author = normalizePackageAuthor(
    packageJson && packageJson.author
  );

  if (!author) {
    throw new Error(
      "Stable Windows release requires a real package.json author/publisher."
    );
  }

  return author;
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(
    parentPath,
    candidatePath
  );

  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  );
}

function resolveExternalSigningCertificate(
  projectRoot,
  certificateFile
) {
  if (
    typeof certificateFile !== "string" ||
    certificateFile.trim() === ""
  ) {
    throw new Error(
      "WINDOWS_CERTIFICATE_FILE is missing."
    );
  }

  const rootAbsolute =
    path.resolve(projectRoot);

  const certificateAbsolute =
    path.isAbsolute(certificateFile)
      ? path.resolve(certificateFile)
      : path.resolve(
          rootAbsolute,
          certificateFile
        );

  if (!fs.existsSync(certificateAbsolute)) {
    throw new Error(
      `Specified certificate file does not exist on disk: ${certificateAbsolute}`
    );
  }

  // Reject a certificate path located lexically inside the repository.
  // This also blocks a repository-local symlink from being used as the
  // certificate input even if its target is outside the repository.
  if (
    isPathInside(
      rootAbsolute,
      certificateAbsolute
    )
  ) {
    throw new Error(
      "Windows signing certificate must be stored outside the project directory."
    );
  }

  const rootReal =
    fs.realpathSync(rootAbsolute);

  const certificateReal =
    fs.realpathSync(certificateAbsolute);

  // Also reject an external-looking symlink whose real target is inside
  // the repository.
  if (
    isPathInside(
      rootReal,
      certificateReal
    )
  ) {
    throw new Error(
      "Windows signing certificate must be stored outside the project directory."
    );
  }

  return certificateReal;
}

module.exports = {
  normalizePackageAuthor,
  requireStablePackageAuthor,
  isPathInside,
  resolveExternalSigningCertificate
};
