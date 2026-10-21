use std::process::Command;

use reqwest::blocking::Client;
use serde_json::Value;

use super::paths::IMPRINT_GITHUB;

const IMPRINT_GIT_URL: &str = "https://github.com/SteamedBread2333/imprint.git";

/// Latest release tag (e.g. `1.3.9`) without leading `v`.
pub fn latest_imprint_release_tag() -> Result<String, String> {
    if let Ok(tag) = latest_tag_via_git() {
        return Ok(tag);
    }
    latest_tag_via_api()
}

fn latest_tag_via_git() -> Result<String, String> {
    let out = Command::new("git")
        .args(["ls-remote", "--tags", IMPRINT_GIT_URL])
        .output()
        .map_err(|e| format!("git ls-remote: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let mut tags: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| {
            let name = line.split_whitespace().nth(1)?;
            let name = name.strip_prefix("refs/tags/")?;
            let name = name.strip_suffix("^{}")?;
            if !name.starts_with('v') {
                return None;
            }
            Some(name.trim_start_matches('v').to_string())
        })
        .collect();
    tags.sort_by(|a, b| semver_key(b).cmp(&semver_key(a)));
    tags.into_iter()
        .next()
        .ok_or_else(|| "no imprint git tags found".into())
}

fn semver_key(s: &str) -> (u64, u64, u64, String) {
    let base = s.split('+').next().unwrap_or(s);
    let mut parts = base.split('.');
    let a = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let b = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let c = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    (a, b, c, s.to_string())
}

fn latest_tag_via_api() -> Result<String, String> {
    let client = Client::builder()
        .user_agent("imprint-console")
        .build()
        .map_err(|e| e.to_string())?;
    let release: Value = client
        .get(format!(
            "https://api.github.com/repos/{IMPRINT_GITHUB}/releases/latest"
        ))
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    if let Some(msg) = release.get("message").and_then(|m| m.as_str()) {
        return Err(msg.to_string());
    }
    release
        .get("tag_name")
        .and_then(|v| v.as_str())
        .map(|t| t.trim_start_matches('v').to_string())
        .ok_or_else(|| "releases/latest: missing tag_name".into())
}
