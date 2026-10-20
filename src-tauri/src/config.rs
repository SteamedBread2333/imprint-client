use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub project_root: String,
    #[serde(default = "default_imprint_bin")]
    pub imprint_bin: String,
    #[serde(default = "default_poll_ms")]
    pub poll_interval_ms: u64,
    #[serde(default)]
    pub hf_endpoint: String,
    #[serde(default)]
    pub imprint_hf_endpoint: String,
    #[serde(default = "default_locale")]
    pub locale: String,
}

fn default_locale() -> String {
    "zh".into()
}

fn default_imprint_bin() -> String {
    String::new()
}

fn default_poll_ms() -> u64 {
    2500
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            project_root: String::new(),
            imprint_bin: default_imprint_bin(),
            poll_interval_ms: default_poll_ms(),
            hf_endpoint: String::new(),
            imprint_hf_endpoint: String::new(),
            locale: default_locale(),
        }
    }
}

pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

pub fn effective_imprint_bin(cfg: &AppConfig) -> String {
    crate::imprint_resolve::effective_imprint_bin(cfg)
}

pub fn sync_global_imprint_bin(cfg: &mut AppConfig) -> bool {
    crate::imprint_resolve::sync_resolved_imprint_bin(cfg)
}

fn clear_legacy_imprint_bin_path(cfg: &mut AppConfig) {
    let s = cfg.imprint_bin.trim();
    if s.is_empty() {
        return;
    }
    if s.contains("Application Support/imprint")
        || s.contains("Application Support\\imprint")
        || s.contains("/.imprint/bin/")
        || s.contains("\\.imprint\\bin\\")
        || s.contains("/.local/bin/imprint")
        || s.contains("\\imprint\\bin\\imprint")
    {
        cfg.imprint_bin.clear();
    }
}

pub fn load_config(app: &AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app)?;
    let mut cfg = if !path.is_file() {
        AppConfig::default()
    } else {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())?
    };
    clear_legacy_imprint_bin_path(&mut cfg);
    if sync_global_imprint_bin(&mut cfg) {
        let _ = save_config(app, &cfg);
    }
    Ok(cfg)
}

pub fn save_config(app: &AppHandle, cfg: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

pub fn resolve_imprint_yaml(project_root: &str) -> Option<PathBuf> {
    let root = Path::new(project_root);
    let primary = root.join("imprint.yaml");
    if primary.is_file() {
        return Some(primary);
    }
    let legacy = root.join(".imprint").join("imprint.yaml");
    if legacy.is_file() {
        return Some(legacy);
    }
    None
}
