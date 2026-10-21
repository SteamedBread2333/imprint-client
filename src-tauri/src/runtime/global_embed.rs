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
        config.insert("port".into(), serde_yaml::Value::Number(4174.into()));
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
        config.insert("relate_bidirectional".into(), serde_yaml::Value::Bool(true));
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
        return Ok((
            GlobalEmbedDoc::default(),
            path.to_string_lossy().into_owned(),
        ));
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let doc: GlobalEmbedDoc = serde_yaml::from_str(&raw).map_err(|e| e.to_string())?;
    Ok((doc, path.to_string_lossy().into_owned()))
}

pub fn validate(doc: &GlobalEmbedDoc) -> Result<(), String> {
    if let Some(v) = doc.config.get("port") {
        let ok = match v {
            serde_yaml::Value::Number(n) => {
                n.as_u64().filter(|p| (1..=65535).contains(p)).is_some()
            }
            _ => false,
        };
        if !ok {
            return Err("embed port must be an integer from 1 to 65535".into());
        }
    }
    if let Some(v) = doc.config.get("model") {
        let ok = matches!(v, serde_yaml::Value::String(s) if !s.trim().is_empty());
        if !ok {
            return Err("embed model must be a non-empty string".into());
        }
    }
    for key in [
        "duplicate_threshold",
        "relate_contradiction_min",
        "relate_entailment_min",
    ] {
        if let Some(v) = doc.config.get(key) {
            let ok = match v {
                serde_yaml::Value::Number(n) => {
                    n.as_f64().filter(|x| (0.0..=1.0).contains(x)).is_some()
                }
                _ => false,
            };
            if !ok {
                return Err(format!("{key} must be a number from 0 to 1"));
            }
        }
    }
    if let Some(v) = doc.config.get("timeout_seconds") {
        let ok = match v {
            serde_yaml::Value::Number(n) => n.as_u64().filter(|x| (1..=3600).contains(x)).is_some(),
            _ => false,
        };
        if !ok {
            return Err("timeout_seconds must be an integer from 1 to 3600".into());
        }
    }
    if let Some(v) = doc.config.get("relate_bidirectional") {
        if !matches!(v, serde_yaml::Value::Bool(_)) {
            return Err("relate_bidirectional must be a boolean".into());
        }
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_doc_survives_json_roundtrip() {
        let doc = GlobalEmbedDoc::default();
        let json = serde_json::to_string(&doc).expect("serialize");
        let back: GlobalEmbedDoc = serde_json::from_str(&json).expect("deserialize");
        validate(&back).expect("valid");
        assert!(back.enabled);
        assert_eq!(embed_port(&back), 4174);
        match back.config.get("model") {
            Some(serde_yaml::Value::String(s)) => assert_eq!(s, "BAAI/bge-small-zh-v1.5"),
            other => panic!("model: {other:?}"),
        }
    }

    #[test]
    fn rejects_port_out_of_range() {
        let mut doc = GlobalEmbedDoc::default();
        doc.config
            .insert("port".into(), serde_yaml::Value::Number(0.into()));
        assert!(validate(&doc).is_err());
    }
}
