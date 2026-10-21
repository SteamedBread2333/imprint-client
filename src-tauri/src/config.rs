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
    /// Most recently opened project roots, newest first.
    #[serde(default)]
    pub recent_projects: Vec<String>,
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

pub const MAX_RECENT_PROJECTS: usize = 8;

/// Remember `path` as the current project and move it to the front of the recent list.
pub fn remember_project(cfg: &mut AppConfig, path: &str) {
    let path = path.trim();
    if path.is_empty() {
        return;
    }
    cfg.project_root = path.to_string();
    cfg.recent_projects.retain(|p| p != path);
    cfg.recent_projects.insert(0, path.to_string());
    cfg.recent_projects.truncate(MAX_RECENT_PROJECTS);
}

fn ensure_current_in_recent(cfg: &mut AppConfig) -> bool {
    let root = cfg.project_root.trim();
    if root.is_empty() {
        return false;
    }
    let root = root.to_string();
    let already = cfg.recent_projects.first().map(String::as_str) == Some(root.as_str())
        && cfg.recent_projects.iter().filter(|p| *p == &root).count() == 1
        && cfg.recent_projects.len() <= MAX_RECENT_PROJECTS;
    if already {
        return false;
    }
    cfg.recent_projects.retain(|p| p != &root);
    cfg.recent_projects.insert(0, root);
    cfg.recent_projects.truncate(MAX_RECENT_PROJECTS);
    true
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
            recent_projects: Vec::new(),
        }
    }
}

pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
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
    let bin_changed = sync_global_imprint_bin(&mut cfg);
    let recent_changed = ensure_current_in_recent(&mut cfg);
    if bin_changed || recent_changed {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_list_is_newest_first_and_capped() {
        let mut cfg = AppConfig::default();
        for i in 0..10 {
            remember_project(&mut cfg, &format!("/tmp/proj-{i}"));
        }
        assert_eq!(cfg.project_root, "/tmp/proj-9");
        assert_eq!(cfg.recent_projects.len(), MAX_RECENT_PROJECTS);
        assert_eq!(cfg.recent_projects[0], "/tmp/proj-9");
        assert_eq!(cfg.recent_projects[7], "/tmp/proj-2");

        remember_project(&mut cfg, "/tmp/proj-5");
        assert_eq!(cfg.recent_projects[0], "/tmp/proj-5");
        assert_eq!(
            cfg.recent_projects
                .iter()
                .filter(|p| *p == "/tmp/proj-5")
                .count(),
            1
        );
    }

    #[test]
    fn current_project_is_kept_at_front_of_recent() {
        let mut cfg = AppConfig::default();
        cfg.project_root = "/work/a".into();
        cfg.recent_projects = vec!["/work/b".into(), "/work/a".into()];
        assert!(ensure_current_in_recent(&mut cfg));
        assert_eq!(
            cfg.recent_projects,
            vec!["/work/a".to_string(), "/work/b".to_string()]
        );
        assert!(!ensure_current_in_recent(&mut cfg));
    }
}
