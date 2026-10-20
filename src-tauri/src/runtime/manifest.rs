use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentRecord {
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub installed_at: String,
    #[serde(default)]
    pub commit: String,
    #[serde(default)]
    pub repo_url: String,
    /// Last release tag resolved during install/update (no network on status refresh).
    #[serde(default)]
    pub latest_available: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifest {
    #[serde(default)]
    pub imprint: ComponentRecord,
    #[serde(default)]
    pub python: ComponentRecord,
    #[serde(default)]
    pub sidecar: ComponentRecord,
}

pub fn load(path: &Path) -> RuntimeManifest {
    if !path.is_file() {
        return RuntimeManifest::default();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, manifest: &RuntimeManifest) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}
