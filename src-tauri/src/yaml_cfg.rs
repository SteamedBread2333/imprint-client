use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
struct ImprintYaml {
    host: Option<HostSection>,
    shelves: Option<ShelvesSection>,
    plugins: Option<HashMap<String, PluginEntry>>,
}

#[derive(Debug, Deserialize)]
struct HostSection {
    listen: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ShelvesSection {
    enabled: Option<bool>,
    config: Option<ShelvesConfigInner>,
}

#[derive(Debug, Deserialize)]
struct ShelvesConfigInner {
    roots: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct PluginEntry {
    enabled: Option<bool>,
    package: Option<String>,
    config: Option<HashMap<String, serde_yaml::Value>>,
}

pub struct ProjectYamlInfo {
    pub host_listen: String,
    pub embed_enabled: bool,
    pub embed_port: u16,
    pub embed_package_rel: String,
    pub embed_package_abs: PathBuf,
    pub desk_port: u16,
    #[allow(dead_code)]
    pub desk_enabled: bool,
    pub shelves_enabled: bool,
    pub shelves_roots: Vec<String>,
}

fn plugin_port(entry: &PluginEntry, default_port: u16) -> u16 {
    entry
        .config
        .as_ref()
        .and_then(|c| c.get("port"))
        .and_then(|v| match v {
            serde_yaml::Value::Number(n) => n.as_u64().map(|x| x as u16),
            _ => None,
        })
        .unwrap_or(default_port)
}

pub fn parse_project_yaml(project_root: &str) -> Result<ProjectYamlInfo, String> {
    let root = Path::new(project_root);
    let yaml_path = super::config::resolve_imprint_yaml(project_root)
        .ok_or_else(|| "imprint.yaml not found in project root".to_string())?;
    let raw = std::fs::read_to_string(&yaml_path).map_err(|e| e.to_string())?;
    let doc: ImprintYaml = serde_yaml::from_str(&raw).map_err(|e| e.to_string())?;

    let host_listen = doc
        .host
        .and_then(|h| h.listen)
        .unwrap_or_else(|| "127.0.0.1:9470".into());

    let shelves_enabled = doc.shelves.as_ref().and_then(|s| s.enabled).unwrap_or(false);
    let shelves_roots = doc
        .shelves
        .as_ref()
        .and_then(|s| s.config.as_ref())
        .and_then(|c| c.roots.clone())
        .unwrap_or_default();

    let plugins = doc.plugins.unwrap_or_default();
    let embed = plugins.get("embed");
    let embed_enabled = embed.and_then(|e| e.enabled).unwrap_or(false);
    let embed_package_rel = embed
        .and_then(|e| e.package.clone())
        .unwrap_or_default();
    let embed_port = embed
        .map(|e| plugin_port(e, 4174))
        .unwrap_or(4174);

    let desk = plugins.get("desk");
    let desk_enabled = desk.and_then(|d| d.enabled).unwrap_or(false);
    let desk_port = desk.map(|d| plugin_port(d, 4173)).unwrap_or(4173);

    let embed_package_abs = if embed_package_rel.is_empty() {
        PathBuf::new()
    } else {
        root.join(&embed_package_rel)
            .canonicalize()
            .unwrap_or_else(|_| root.join(&embed_package_rel))
    };

    Ok(ProjectYamlInfo {
        host_listen,
        embed_enabled,
        embed_port,
        embed_package_rel,
        embed_package_abs,
        desk_port,
        desk_enabled,
        shelves_enabled,
        shelves_roots,
    })
}

pub fn validate_project(project_root: &str) -> Result<ProjectYamlInfo, String> {
    if project_root.trim().is_empty() {
        return Err("project root is empty".into());
    }
    let root = Path::new(project_root);
    if !root.is_dir() {
        return Err(format!("not a directory: {project_root}"));
    }
    let info = parse_project_yaml(project_root)?;
    if !info.embed_enabled {
        return Err("plugins.embed is not enabled in imprint.yaml".into());
    }
    if info.embed_package_abs.as_os_str().is_empty() || !info.embed_package_abs.is_dir() {
        return Err(format!(
            "embed package path missing or not a directory: {}",
            info.embed_package_rel
        ));
    }
    let setup = info.embed_package_abs.join("scripts/setup.sh");
    if !setup.is_file() {
        return Err("embed package missing scripts/setup.sh".into());
    }
    let manifest = info.embed_package_abs.join("imprint.plugin.json");
    if !manifest.is_file() {
        return Err("embed package missing imprint.plugin.json".into());
    }
    Ok(info)
}
