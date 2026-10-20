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

/// Locate the Go toolchain.
///
/// A desktop app launched from Finder inherits launchd's PATH
/// (`/usr/bin:/bin:/usr/sbin:/sbin`). The official installer puts `go` in
/// `/usr/local/go/bin` and registers that directory in `/etc/paths.d`, which
/// only login shells pick up. Searching that list (and Homebrew) finds an
/// install the GUI process cannot see on PATH.
pub fn resolve_go_executable() -> Option<PathBuf> {
    let name = go_exe_name();
    if let Some(path) = std::env::var_os("PATH") {
        if let Some(found) = first_executable(std::env::split_paths(&path), name) {
            return Some(found);
        }
    }
    if let Some(found) = first_executable(toolchain_search_dirs(), name) {
        return Some(found);
    }
    which_on_path(name).filter(|p| p.is_file())
}

pub fn go_command() -> Result<Command, String> {
    let bin = resolve_go_executable()
        .ok_or_else(|| "未找到 go 命令。请先安装 Go：https://go.dev/dl/".to_string())?;
    let mut cmd = Command::new(&bin);
    if let Some(dir) = bin.parent() {
        let mut paths = vec![dir.to_path_buf()];
        if let Some(existing) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&existing));
        }
        if let Ok(joined) = std::env::join_paths(paths) {
            cmd.env("PATH", joined);
        }
    }
    Ok(cmd)
}

fn go_exe_name() -> &'static str {
    #[cfg(windows)]
    {
        "go.exe"
    }
    #[cfg(not(windows))]
    {
        "go"
    }
}

fn first_executable(dirs: impl IntoIterator<Item = PathBuf>, name: &str) -> Option<PathBuf> {
    for dir in dirs {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn toolchain_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(target_os = "macos")]
    dirs.extend(macos_path_helper_dirs());
    for raw in [
        "/usr/local/go/bin",
        "/usr/lib/go/bin",
        "/opt/homebrew/bin",
        "/opt/homebrew/opt/go/bin",
        "/usr/local/bin",
    ] {
        dirs.push(PathBuf::from(raw));
    }
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join("sdk/go/bin"));
        dirs.push(home.join("go/bin"));
    }
    #[cfg(windows)]
    {
        if let Ok(pf) = std::env::var("ProgramFiles") {
            dirs.push(PathBuf::from(pf).join("Go").join("bin"));
        }
    }
    dirs
}

#[cfg(target_os = "macos")]
fn macos_path_helper_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(text) = std::fs::read_to_string("/etc/paths") {
        push_path_lines(&mut dirs, &text);
    }
    if let Ok(entries) = std::fs::read_dir("/etc/paths.d") {
        let mut files: Vec<PathBuf> = entries.filter_map(|e| e.ok()).map(|e| e.path()).collect();
        files.sort();
        for path in files {
            if let Ok(text) = std::fs::read_to_string(&path) {
                push_path_lines(&mut dirs, &text);
            }
        }
    }
    dirs
}

fn push_path_lines(dirs: &mut Vec<PathBuf>, text: &str) {
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        dirs.push(PathBuf::from(line));
    }
}

fn go_env(key: &str) -> Option<String> {
    let out = go_command()
        .ok()?
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_paths_file() {
        let mut dirs = Vec::new();
        push_path_lines(&mut dirs, "/usr/bin\n# comment\n\n/usr/local/go/bin\n");
        assert_eq!(
            dirs,
            vec![
                PathBuf::from("/usr/bin"),
                PathBuf::from("/usr/local/go/bin")
            ]
        );
    }

    #[test]
    fn finds_go_when_process_path_is_the_gui_default() {
        if !Path::new("/usr/local/go/bin/go").is_file()
            && !Path::new("/opt/homebrew/bin/go").is_file()
        {
            return;
        }
        let saved = std::env::var_os("PATH");
        std::env::set_var("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
        let result = go_command().and_then(|mut cmd| {
            cmd.arg("version")
                .output()
                .map_err(|e| e.to_string())
        });
        if let Some(saved) = &saved {
            std::env::set_var("PATH", saved);
        }
        let out = result.expect("go version");
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
}
