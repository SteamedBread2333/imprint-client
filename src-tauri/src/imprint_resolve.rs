use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

use crate::config::AppConfig;

const IMPRINT_PKG: &str = "github.com/SteamedBread2333/imprint/cmd/imprint";
const IMPRINT_MCP_PKG: &str = "github.com/SteamedBread2333/imprint/cmd/imprint-mcp";

/// Resolve imprint CLI: settings override, else **`go install` global bin** (GOPATH/bin or GOBIN).
pub fn resolve_imprint_executable(cfg: &AppConfig) -> Result<PathBuf, String> {
    let custom = cfg.imprint_bin.trim();
    if !custom.is_empty() {
        let p = PathBuf::from(custom);
        if p.is_absolute() {
            if is_console_managed_imprint_path(&p) {
                return resolve_go_installed_imprint();
            }
            if p.is_file() {
                return Ok(p);
            }
            return Err(format!("imprint not found: {}", p.display()));
        }
        if custom != "imprint" {
            if let Some(found) = which_on_path(custom) {
                return Ok(found);
            }
        }
    }
    resolve_go_installed_imprint()
}

pub fn resolve_go_installed_imprint() -> Result<PathBuf, String> {
    if let Some(p) = find_go_installed_imprint() {
        return Ok(p);
    }
    Err(
        "未找到 go 全局安装的 imprint。请安装 Go，并在「设置 → 运行环境」点「准备运行环境」执行 go install，或手动：\ngo install github.com/SteamedBread2333/imprint/cmd/imprint@latest"
            .into(),
    )
}

pub fn find_go_installed_imprint() -> Option<PathBuf> {
    for dir in go_bin_dirs().ok()? {
        let p = dir.join(imprint_exe_name());
        if p.is_file() {
            return Some(p);
        }
    }
    which_on_path("imprint").filter(|p| !is_console_managed_imprint_path(p))
}

pub fn go_bin_dirs() -> Result<Vec<PathBuf>, String> {
    let mut dirs = Vec::new();
    if let Some(gobin) = go_env("GOBIN") {
        dirs.push(PathBuf::from(gobin));
    }
    if let Some(gopath) = go_env("GOPATH") {
        for part in gopath.split(':').filter(|s| !s.is_empty()) {
            dirs.push(PathBuf::from(part).join("bin"));
        }
    }
    if dirs.is_empty() {
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(PathBuf::from(home).join("go").join("bin"));
        }
    }
    if dirs.is_empty() {
        return Err("无法解析 GOPATH/bin（go 是否已安装？）".into());
    }
    Ok(dirs)
}

pub fn imprint_module_packages() -> (&'static str, &'static str) {
    (IMPRINT_PKG, IMPRINT_MCP_PKG)
}

pub fn is_console_managed_imprint_path(p: &Path) -> bool {
    let s = p.to_string_lossy();
    s.contains("/.imprint/bin/") || s.contains("\\.imprint\\bin\\")
}

fn imprint_exe_name() -> &'static str {
    #[cfg(windows)]
    {
        "imprint.exe"
    }
    #[cfg(not(windows))]
    {
        "imprint"
    }
}

fn go_env(key: &str) -> Option<String> {
    let out = Command::new("go")
        .args(["env", key])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if v.is_empty() {
        return None;
    }
    Some(v)
}

pub fn standard_imprint_locations() -> Vec<PathBuf> {
    go_bin_dirs()
        .unwrap_or_default()
        .into_iter()
        .map(|d| d.join(imprint_exe_name()))
        .collect()
}

fn which_on_path(name: &str) -> Option<PathBuf> {
    let out = Command::new("sh")
        .arg("-lc")
        .arg(format!("command -v {}", shell_escape(name)))
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(path))
}

fn shell_escape(s: &str) -> String {
    if s.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.' || c == '/') {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

pub fn effective_imprint_bin(cfg: &AppConfig) -> String {
    resolve_imprint_executable(cfg)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| {
            let s = cfg.imprint_bin.trim();
            if s.is_empty() {
                "imprint".into()
            } else {
                s.to_string()
            }
        })
}

/// Release v1.3.9 cannot load ~/.imprint/embed.yaml for `plugin start embed` (list returns null).
pub fn imprint_supports_global_embed(bin: &Path) -> bool {
    if !crate::runtime::global_embed::load()
        .map(|(d, _)| d.enabled && !d.package.trim().is_empty())
        .unwrap_or(false)
    {
        return true;
    }
    let out = match Command::new(bin)
        .args(["--json", "plugin", "list"])
        .current_dir("/tmp")
        .output()
    {
        Ok(o) => o,
        Err(_) => return false,
    };
    if !out.status.success() {
        return false;
    }
    let Ok(v) = serde_json::from_slice::<Value>(&out.stdout) else {
        return false;
    };
    let Some(arr) = v.as_array() else {
        return false;
    };
    arr.iter().any(|item| {
        item.get("id").and_then(|x| x.as_str()) == Some("embed")
            && item.get("enabled").and_then(|x| x.as_bool()) == Some(true)
    })
}

pub fn sync_resolved_imprint_bin(cfg: &mut AppConfig) -> bool {
    if !cfg.imprint_bin.trim().is_empty() {
        let p = PathBuf::from(cfg.imprint_bin.trim());
        if p.is_absolute() && is_console_managed_imprint_path(&p) {
            cfg.imprint_bin.clear();
        }
    }
    if let Ok(p) = resolve_imprint_executable(cfg) {
        let next = p.to_string_lossy().into_owned();
        if cfg.imprint_bin != next {
            cfg.imprint_bin = next;
            return true;
        }
    }
    false
}
