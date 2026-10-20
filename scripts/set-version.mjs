/**
 * Sync semver into Tauri / npm / Rust manifests (used by Release CI from git tag).
 * Usage: node scripts/set-version.mjs 0.2.0
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-version.mjs <semver>, e.g. 0.1.0");
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = version;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const tauriPath = path.join(root, "src-tauri/tauri.conf.json");
const tauri = JSON.parse(fs.readFileSync(tauriPath, "utf8"));
tauri.version = version;
fs.writeFileSync(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`);

const cargoPath = path.join(root, "src-tauri/Cargo.toml");
let cargo = fs.readFileSync(cargoPath, "utf8");
cargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`);
fs.writeFileSync(cargoPath, cargo);

console.log(`Version set to ${version}`);
