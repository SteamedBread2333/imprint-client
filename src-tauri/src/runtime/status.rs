use std::path::PathBuf;

use serde::Serialize;

use super::install::read_installed_imprint_version;
use super::manifest;
use super::paths::{managed_python_bin, manifest_path, sidecar_dir, SIDECAR_REPO};
use crate::config::AppConfig;
use crate::imprint_resolve;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentStatus {
    pub name: String,
    pub installed: bool,
    pub path: String,
    pub version: String,
    pub latest: String,
    pub detail: String,
    #[serde(default)]
    pub managed_by_console: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub components: Vec<ComponentStatus>,
    pub global_embed_path: String,
    pub ready: bool,
}

pub fn get_runtime_status(app_data: &PathBuf, cfg: &AppConfig) -> RuntimeStatus {
    let manifest = manifest::load(&manifest_path(app_data));
    let imprint_resolved = imprint_resolve::resolve_imprint_executable(cfg).ok();
    let imprint_installed = imprint_resolved.as_ref().is_some_and(|p| p.is_file());
    let imprint_version = imprint_resolved
        .as_ref()
        .and_then(|p| read_installed_imprint_version(p))
        .unwrap_or_else(|| manifest.imprint.version.clone());
    let imprint_path = imprint_resolved
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| {
            imprint_resolve::go_bin_dirs()
                .ok()
                .and_then(|dirs| dirs.first().map(|d| d.join("imprint").to_string_lossy().into_owned()))
                .unwrap_or_else(|| manifest.imprint.path.clone())
        });
    let imprint_latest = manifest.imprint.latest_available.clone();

    let py = managed_python_bin(app_data);
    let side = sidecar_dir(app_data);
    let side_ok = side.join("scripts/setup.sh").is_file();

    let components = vec![
        ComponentStatus {
            name: "imprint".into(),
            installed: imprint_installed,
            path: imprint_path,
            version: imprint_version,
            latest: imprint_latest,
            detail: "go install → $(go env GOPATH)/bin".into(),
            managed_by_console: true,
        },
        ComponentStatus {
            name: "python".into(),
            installed: py.is_file(),
            path: manifest.python.path.clone(),
            version: manifest.python.version.clone(),
            latest: super::install::PYTHON_VERSION.into(),
            detail: "应用内 runtime".into(),
            managed_by_console: true,
        },
        ComponentStatus {
            name: "sidecar".into(),
            installed: side_ok,
            path: manifest.sidecar.path.clone(),
            version: manifest.sidecar.commit.clone(),
            latest: "main".into(),
            detail: SIDECAR_REPO.into(),
            managed_by_console: true,
        },
    ];

    let embed_path = super::paths::global_embed_yaml()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ready = imprint_installed && py.is_file() && side_ok;

    RuntimeStatus {
        components,
        global_embed_path: embed_path,
        ready,
    }
}

pub fn git_available() -> bool {
    std::process::Command::new("git")
        .arg("--version")
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
