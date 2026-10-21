use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use super::github::latest_imprint_release_tag;
use super::global_embed::{self, GlobalEmbedDoc};
use super::manifest::RuntimeManifest;
use super::paths::{
    imprint_release_triple, managed_python_bin, python_dir, runtime_root, sidecar_dir, SIDECAR_REPO,
};
use crate::config::{load_config, save_config};
use crate::imprint_resolve::{
    find_go_installed_imprint, go_command, imprint_module_packages, imprint_supports_global_embed,
};
use reqwest::blocking::Client;
use tauri::{AppHandle, Emitter};

pub const PYTHON_RELEASE_TAG: &str = "20241016";
pub const PYTHON_VERSION: &str = "3.12.7";

pub fn emit_line(app: &tauri::AppHandle, stream_id: &str, line: &str) {
    let _ = app.emit(
        "job-output",
        serde_json::json!({ "streamId": stream_id, "kind": "stdout", "line": line }),
    );
}

pub fn ensure_all(
    app: &tauri::AppHandle,
    app_data: &PathBuf,
    stream_id: &str,
) -> Result<RuntimeManifest, String> {
    fs::create_dir_all(runtime_root(app_data)).map_err(|e| e.to_string())?;
    let mut manifest = super::manifest::load(&super::paths::manifest_path(app_data));

    emit_line(app, stream_id, "runtime: checking Python…");
    ensure_python(app, app_data, stream_id, &mut manifest, false)?;

    emit_line(app, stream_id, "runtime: checking embed sidecar…");
    ensure_sidecar(app, app_data, stream_id, &mut manifest)?;

    emit_line(
        app,
        stream_id,
        "runtime: checking imprint CLI (go install / GOPATH/bin)…",
    );
    ensure_imprint(app, stream_id, &mut manifest, false)?;

    emit_line(app, stream_id, "runtime: writing global embed.yaml…");
    sync_global_embed(app_data, &manifest)?;

    super::manifest::save(&super::paths::manifest_path(app_data), &manifest)?;
    emit_line(app, stream_id, "runtime: ready.");
    Ok(manifest)
}

pub fn update_component(
    app: &tauri::AppHandle,
    app_data: &PathBuf,
    stream_id: &str,
    name: &str,
) -> Result<RuntimeManifest, String> {
    fs::create_dir_all(runtime_root(app_data)).map_err(|e| e.to_string())?;
    emit_line(app, stream_id, &format!("runtime: update {name}…"));
    let mut manifest = super::manifest::load(&super::paths::manifest_path(app_data));
    match name {
        "python" => ensure_python(app, app_data, stream_id, &mut manifest, true)?,
        "sidecar" => {
            emit_line(app, stream_id, "runtime: updating embed sidecar…");
            let dir = sidecar_dir(app_data);
            if dir.join("scripts/setup.sh").is_file() {
                git_pull(&dir, stream_id, app)?;
                let py = managed_python_bin(app_data);
                if py.is_file() {
                    let status = Command::new("sh")
                        .arg(dir.join("scripts/setup.sh"))
                        .env("PYTHON", &py)
                        .current_dir(&dir)
                        .status()
                        .map_err(|e| e.to_string())?;
                    if !status.success() {
                        return Err("sidecar setup.sh failed after pull".into());
                    }
                }
            } else {
                ensure_sidecar(app, app_data, stream_id, &mut manifest)?;
            }
            update_sidecar_manifest(app_data, &mut manifest);
        }
        "imprint" => ensure_imprint(app, stream_id, &mut manifest, true)?,
        other => return Err(format!("unknown runtime component: {other}")),
    }
    sync_global_embed(app_data, &manifest)?;
    super::manifest::save(&super::paths::manifest_path(app_data), &manifest)?;
    Ok(manifest)
}

fn ensure_python(
    app: &tauri::AppHandle,
    app_data: &PathBuf,
    stream_id: &str,
    manifest: &mut RuntimeManifest,
    force: bool,
) -> Result<(), String> {
    let bin = managed_python_bin(app_data);
    if bin.is_file() && !force {
        manifest.python.path = bin.to_string_lossy().into_owned();
        return Ok(());
    }
    if force && python_dir(app_data).exists() {
        emit_line(app, stream_id, "runtime: replacing managed Python…");
        let _ = fs::remove_dir_all(python_dir(app_data));
    }
    let triple = python_standalone_triple()?;
    let filename = format!(
        "cpython-{}+{}-{}-install_only.tar.gz",
        PYTHON_VERSION, PYTHON_RELEASE_TAG, triple
    );
    let url = format!(
        "https://github.com/astral-sh/python-build-standalone/releases/download/{PYTHON_RELEASE_TAG}/{filename}"
    );
    emit_line(app, stream_id, &format!("runtime: downloading {url}"));
    let client = Client::builder()
        .user_agent("imprint-console")
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = client
        .get(&url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .bytes()
        .map_err(|e| e.to_string())?;
    let dest = python_dir(app_data);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let archive = dest.join(&filename);
    fs::write(&archive, &bytes).map_err(|e| e.to_string())?;
    let staging = dest.join("_staging");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    extract_tar_gz(&archive, &staging)?;
    let _ = fs::remove_file(&archive);
    normalize_python_tree(&staging, &dest)?;
    let _ = fs::remove_dir_all(&staging);
    if !bin.is_file() {
        return Err(format!(
            "python not found after extract at {}",
            bin.display()
        ));
    }
    manifest.python.version = PYTHON_VERSION.into();
    manifest.python.path = bin.to_string_lossy().into_owned();
    manifest.python.installed_at = now_iso();
    Ok(())
}

fn python_standalone_triple() -> Result<String, String> {
    let (os, arch) = imprint_release_triple()?;
    let triple = match (os, arch) {
        ("darwin", "arm64") => "aarch64-apple-darwin",
        ("darwin", "amd64") => "x86_64-apple-darwin",
        ("linux", "amd64") => "x86_64-unknown-linux-gnu",
        ("linux", "arm64") => "aarch64-unknown-linux-gnu",
        ("windows", "amd64") => "x86_64-pc-windows-msvc",
        ("windows", "arm64") => "aarch64-pc-windows-msvc",
        _ => return Err("unsupported python standalone triple".into()),
    };
    Ok(triple.to_string())
}

fn normalize_python_tree(staging: &Path, dest: &Path) -> Result<(), String> {
    let direct = staging.join("python").join("bin");
    #[cfg(windows)]
    let direct = staging.join("python").join("python.exe");
    #[cfg(windows)]
    if direct.is_file() {
        copy_dir_all(&staging.join("python"), dest)?;
        return Ok(());
    }
    #[cfg(not(windows))]
    if direct.join("python3").is_file() || direct.join("python").is_file() {
        copy_dir_all(&staging.join("python"), dest)?;
        return Ok(());
    }
    for entry in fs::read_dir(staging).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.is_dir() {
            let inner = p.join("python");
            if inner.is_dir() {
                copy_dir_all(&inner, dest)?;
                return Ok(());
            }
        }
    }
    Err("could not locate python/ in standalone archive".into())
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let to = dst.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_dir_all(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn ensure_sidecar(
    app: &tauri::AppHandle,
    app_data: &PathBuf,
    stream_id: &str,
    manifest: &mut RuntimeManifest,
) -> Result<(), String> {
    let dir = sidecar_dir(app_data);
    if !dir.join("scripts/setup.sh").is_file() {
        emit_line(
            app,
            stream_id,
            &format!("runtime: git clone {SIDECAR_REPO}"),
        );
        if let Some(parent) = dir.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let status = Command::new("git")
            .args(["clone", "--depth", "1", SIDECAR_REPO])
            .arg(&dir)
            .status()
            .map_err(|e| format!("git clone failed: {e}"))?;
        if !status.success() {
            return Err("git clone sidecar failed".into());
        }
    }
    let py = managed_python_bin(app_data);
    if py.is_file() {
        emit_line(app, stream_id, "runtime: sidecar setup.sh…");
        let status = Command::new("sh")
            .arg(dir.join("scripts/setup.sh"))
            .env("PYTHON", &py)
            .current_dir(&dir)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("sidecar setup.sh failed".into());
        }
    }
    manifest.sidecar.path = dir.to_string_lossy().into_owned();
    manifest.sidecar.repo_url = SIDECAR_REPO.into();
    manifest.sidecar.installed_at = now_iso();
    if let Ok(out) = Command::new("git")
        .args(["-C", dir.to_str().unwrap_or(""), "rev-parse", "HEAD"])
        .output()
    {
        if out.status.success() {
            manifest.sidecar.commit = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
    }
    Ok(())
}

fn git_pull(dir: &Path, stream_id: &str, app: &tauri::AppHandle) -> Result<(), String> {
    for args in [
        vec!["pull", "--ff-only"],
        vec!["fetch", "origin", "main"],
        vec!["checkout", "main"],
        vec!["pull", "--ff-only"],
    ] {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(&args)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            emit_line(
                app,
                stream_id,
                &format!("runtime: git {:?} failed (continuing)", args),
            );
        }
    }
    Ok(())
}

pub fn parse_imprint_version(raw: &str) -> String {
    let raw = raw.trim();
    for token in raw.split_whitespace() {
        let t = token.trim_start_matches('v');
        if t.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return t.to_string();
        }
    }
    raw.to_string()
}

pub fn read_installed_imprint_version(bin: &Path) -> Option<String> {
    imprint_version(bin).ok().map(|s| parse_imprint_version(&s))
}

fn ensure_imprint(
    app: &AppHandle,
    stream_id: &str,
    manifest: &mut RuntimeManifest,
    force: bool,
) -> Result<(), String> {
    if !force {
        if let Some(bin_path) = find_go_installed_imprint() {
            if imprint_supports_global_embed(&bin_path) {
                record_imprint_manifest(manifest, &bin_path);
                sync_config_imprint_bin(app, &bin_path)?;
                emit_line(
                    app,
                    stream_id,
                    &format!("runtime: go imprint ok at {}", bin_path.display()),
                );
                return Ok(());
            }
            emit_line(
                app,
                stream_id,
                "runtime: 当前 imprint 无法使用 ~/.imprint/embed.yaml（例如 v1.3.9），将 go install @main …",
            );
        }
    }

    let mut version_cmd = go_command()?;
    if version_cmd
        .arg("version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| !s.success())
        .unwrap_or(true)
    {
        return Err("未找到 go 命令。请先安装 Go：https://go.dev/dl/".into());
    }

    emit_line(
        app,
        stream_id,
        "runtime: resolving imprint release tag (display only)…",
    );
    if let Ok(latest) = latest_imprint_release_tag() {
        manifest.imprint.latest_available = latest;
    }
    // Global embed needs fixes after v1.3.9; install from main until a newer tag ships.
    let version_ref = "main".to_string();
    let (pkg, mcp_pkg) = imprint_module_packages();

    for (label, module) in [("imprint", pkg), ("imprint-mcp", mcp_pkg)] {
        let arg = format!("{module}@{version_ref}");
        emit_line(app, stream_id, &format!("runtime: go install {arg}"));
        let out = go_command()?
            .arg("install")
            .arg(&arg)
            .output()
            .map_err(|e| format!("go install {label} failed: {e}"))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let stdout = String::from_utf8_lossy(&out.stdout);
            let msg = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else {
                stdout.trim().to_string()
            };
            return Err(format!("go install {label} failed: {msg}"));
        }
    }

    let bin_path = find_go_installed_imprint()
        .ok_or_else(|| "go install 完成但在 GOPATH/bin 未找到 imprint".to_string())?;
    record_imprint_manifest(manifest, &bin_path);
    manifest.imprint.version =
        read_installed_imprint_version(&bin_path).unwrap_or_else(|| "main".into());
    sync_config_imprint_bin(app, &bin_path)?;
    emit_line(
        app,
        stream_id,
        &format!("runtime: go install → {}", bin_path.display()),
    );
    Ok(())
}

fn record_imprint_manifest(manifest: &mut RuntimeManifest, bin_path: &Path) {
    manifest.imprint.path = bin_path.to_string_lossy().into_owned();
    if let Some(v) = read_installed_imprint_version(bin_path) {
        manifest.imprint.version = v;
    }
    manifest.imprint.installed_at = now_iso();
}

fn sync_config_imprint_bin(app: &AppHandle, bin_path: &Path) -> Result<(), String> {
    let mut cfg = load_config(app)?;
    let next = bin_path.to_string_lossy().into_owned();
    if cfg.imprint_bin != next {
        cfg.imprint_bin = next;
        save_config(app, &cfg)?;
    }
    Ok(())
}

fn update_sidecar_manifest(app_data: &PathBuf, manifest: &mut RuntimeManifest) {
    let dir = sidecar_dir(app_data);
    manifest.sidecar.path = dir.to_string_lossy().into_owned();
    if let Ok(out) = Command::new("git")
        .args([
            "-C",
            dir.to_str().unwrap_or(""),
            "rev-parse",
            "--short",
            "HEAD",
        ])
        .output()
    {
        if out.status.success() {
            manifest.sidecar.commit = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
    }
}

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(), String> {
    let status = Command::new("tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(dest)
        .status()
        .map_err(|e| format!("tar failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("tar extract failed".into())
    }
}

fn imprint_version(bin: &Path) -> Result<String, String> {
    for args in [["version"], ["--version"], ["-V"]] {
        let out = Command::new(bin)
            .args(args)
            .output()
            .map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Ok(stdout);
        }
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if !stderr.is_empty() {
            return Ok(stderr);
        }
    }
    Err("imprint version command produced no output".into())
}

fn sync_global_embed(app_data: &PathBuf, manifest: &RuntimeManifest) -> Result<(), String> {
    let (mut doc, _) = global_embed::load().unwrap_or((GlobalEmbedDoc::default(), String::new()));
    doc.enabled = true;
    doc.package = manifest.sidecar.path.clone();
    if doc.package.is_empty() {
        doc.package = sidecar_dir(app_data).to_string_lossy().into_owned();
    }
    global_embed::save(&doc)?;
    Ok(())
}

fn now_iso() -> String {
    humantime_simple()
}

fn humantime_simple() -> String {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default()
}
