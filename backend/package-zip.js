const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const staging = path.resolve(__dirname, "dist");
const zipTarget = path.resolve(__dirname, "backend-full.zip");
const filesToCopy = [
  "index.js",
  "server.js",
  "cognito-auth.js",
  "s3.js",
  "db.js",
  "auth.js",
  "auditTrail.js",
  "documentAuthorization.js",
  "session.js",
  "config.js",
  "package.json"
];

function hashDirectory(directory, excludedRootEntries = new Set()) {
  const hash = crypto.createHash("sha256");

  function addDirectory(currentDirectory, relativeDirectory = "") {
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

    for (const entry of entries) {
      if (!relativeDirectory && excludedRootEntries.has(entry.name)) {
        continue;
      }
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(currentDirectory, entry.name);
      const stat = fs.lstatSync(absolutePath);

      if (stat.isSymbolicLink()) {
        hash.update(`L${relativePath}\0${fs.readlinkSync(absolutePath)}\0`);
      } else if (stat.isDirectory()) {
        hash.update(`D${relativePath}\0`);
        addDirectory(absolutePath, relativePath);
      } else if (stat.isFile()) {
        hash.update(`F${relativePath}\0`);
        hash.update(fs.readFileSync(absolutePath));
      } else {
        throw new Error(`Unsupported deployment package entry: ${relativePath}`);
      }
    }
  }

  addDirectory(directory);
  return hash.digest("hex");
}

function hashPackageContents(directory) {
  const hash = crypto.createHash("sha256");
  hash.update(hashDirectory(directory, new Set(["node_modules"])));
  hash.update(fs.readFileSync(path.join(__dirname, "package-lock.json")));
  return hash.digest("hex");
}

function createPackage({ stagingPath = staging, outputPath = zipTarget } = {}) {
  if (fs.existsSync(stagingPath)) {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingPath, { recursive: true });

  try {
    for (const file of filesToCopy) {
      fs.copyFileSync(path.join(__dirname, file), path.join(stagingPath, file));
    }

    fs.cpSync(path.join(__dirname, "certs"), path.join(stagingPath, "certs"), {
      recursive: true
    });

    console.log("Copying node_modules (excluding bcrypt and cache)...");
    fs.cpSync(path.join(__dirname, "node_modules"), path.join(stagingPath, "node_modules"), {
      recursive: true,
      filter: source => !source.includes("bcrypt") && !source.includes(".cache")
    });

    const digest = hashPackageContents(stagingPath);
    console.log("Compressing backend-full.zip using tar...");
    execSync(`tar -a -c -f "${outputPath}" *`, { cwd: stagingPath });

    const stat = fs.statSync(outputPath);
    console.log(
      "Successfully created:",
      outputPath,
      `(${(stat.size / 1024 / 1024).toFixed(2)} MB; SHA-256 ${digest})`
    );
    return { zipPath: outputPath, digest };
  } finally {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    createPackage();
  } catch (error) {
    console.error("Backend packaging failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  createPackage,
  hashDirectory,
  hashPackageContents
};
