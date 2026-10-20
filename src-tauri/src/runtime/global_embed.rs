use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use super::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalEmbedDoc {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub package: String,
    #[serde(default)]
    pub config: HashMap<String, serde_yaml::Value>,
}

impl Default for GlobalEmbedDoc {
    fn default() -> Self {
        let mut config = HashMap::new();
        config.insert(
            "port".into(),
            serde_yaml::Value::Number(4174.into()),
        );
        config.insert(
            "model".into(),
            serde_yaml::Value::String("BAAI/bge-small-zh-v1.5".into()),
        );
        config.insert(
            "duplicate_threshold".into(),
            serde_yaml::Value::Number(serde_yaml::Number::from(0.65f64)),
        );
        config.insert(
            "relate_contradiction_min".into(),
            serde_yaml::Value::Number(serde_yaml::Number::from(0.40f64)),
        );
        config.insert(
            "relate_entailment_min".into(),
            serde_yaml::Value::Number(serde_yaml::Number::from(0.35f64)),
        );
        config.insert(
            "relate_bidirectional".into(),
            serde_yaml::Value::Bool(true),
        );
        config.insert(
            "timeout_seconds".into(),
            serde_yaml::Value::Number(5.into()),
        );
        Self {
            enabled: true,
            package: String::new(),
            config,
        }
    }
}

pub fn load() -> Result<(GlobalEmbedDoc, String), String> {
    let path = paths::global_embed_yaml()?;
    if !path.is_file() {
        return Ok((GlobalEmbedDoc::default(), path.to_string_lossy().into_owned()));
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let doc: GlobalEmbedDoc = serde_yaml::from_str(&raw).map_err(|e| e.to_string())?;
    Ok((doc, path.to_string_lossy().into_owned()))
}

pub fn save(doc: &GlobalEmbedDoc) -> Result<String, String> {
    let path = paths::global_embed_yaml()?;
    write_path(&path, doc)
}

pub fn write_path(path: &Path, doc: &GlobalEmbedDoc) -> Result<String, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_yaml::to_string(doc).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("yaml.tmp");
    fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Ensure ~/.imprint/embed.yaml exists with embed enabled and absolute sidecar package path.
pub fn ensure_ready_for_plugin(app_data: &std::path::Path) -> Result<(), String> {
    use super::paths::sidecar_dir;
    let sidecar = sidecar_dir(&app_data.to_path_buf());
    if !sidecar.join("scripts/setup.sh").is_file() {
        return Err("embed sidecar 未安装 — 请先在「设置 → 运行环境」准备运行环境".into());
    }
    let (mut doc, _) = load().unwrap_or((GlobalEmbedDoc::default(), String::new()));
    doc.enabled = true;
    doc.package = sidecar.to_string_lossy().into_owned();
    save(&doc)?;
    Ok(())
}

pub fn embed_port(doc: &GlobalEmbedDoc) -> u16 {
    doc.config
        .get("port")
        .and_then(|v| match v {
            serde_yaml::Value::Number(n) => n.as_u64().map(|x| x as u16),
            _ => None,
        })
        .unwrap_or(4174)
}
