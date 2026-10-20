use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

use crate::config::AppConfig;
use crate::imprint::run_imprint_json;
use crate::yaml_cfg::parse_project_yaml;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProbe {
    pub port: i64,
    pub listening: bool,
    #[serde(default)]
    pub vault: String,
    #[serde(default)]
    pub rules: i64,
    #[serde(default)]
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShelvesStatus {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub indexed: bool,
    #[serde(default)]
    pub roots: Vec<String>,
    #[serde(default)]
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRow {
    pub id: String,
    pub enabled: bool,
    pub package: String,
    pub port: i64,
    pub running: bool,
    pub healthy: bool,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub error: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedHealthDetail {
    pub ok: bool,
    pub ready: bool,
    #[serde(default)]
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub project: String,
    pub vault: String,
    pub hint: String,
    pub host: RuntimeProbe,
    pub desk: RuntimeProbe,
    pub shelves: ShelvesStatus,
    pub embed: PluginRow,
    pub embed_health: Option<EmbedHealthDetail>,
    pub host_url: String,
    pub desk_url: String,
    pub sidecar_log_path: String,
    pub yaml_error: String,
}

fn default_probe() -> RuntimeProbe {
    RuntimeProbe {
        port: 0,
        listening: false,
        vault: String::new(),
        rules: 0,
        error: String::new(),
    }
}

fn host_url_from_listen(listen: &str) -> String {
    let listen = listen.trim();
    if listen.starts_with("http://") || listen.starts_with("https://") {
        listen.to_string()
    } else {
        format!("http://{listen}")
    }
}

pub fn fetch_snapshot(cfg: &AppConfig) -> Snapshot {
    let mut snap = Snapshot {
        project: cfg.project_root.clone(),
        vault: String::new(),
        hint: String::new(),
        host: default_probe(),
        desk: default_probe(),
        shelves: ShelvesStatus {
            enabled: false,
            indexed: false,
            roots: vec![],
            error: String::new(),
        },
        embed: PluginRow {
            id: "embed".into(),
            enabled: false,
            package: String::new(),
            port: 4174,
            running: false,
            healthy: false,
            url: String::new(),
            error: String::new(),
            name: String::new(),
            version: String::new(),
        },
        embed_health: None,
        host_url: "http://127.0.0.1:9470".into(),
        desk_url: "http://127.0.0.1:4173".into(),
        sidecar_log_path: String::new(),
        yaml_error: String::new(),
    };

    if cfg.project_root.is_empty() {
        snap.yaml_error = "no project selected".into();
        return snap;
    }

    let yaml_info = match parse_project_yaml(&cfg.project_root) {
        Ok(y) => y,
        Err(e) => {
            snap.yaml_error = e;
            return snap;
        }
    };

    snap.host_url = host_url_from_listen(&yaml_info.host_listen);
    snap.desk_url = format!("http://127.0.0.1:{}", yaml_info.desk_port);
    snap.shelves.enabled = yaml_info.shelves_enabled;
    snap.shelves.roots = yaml_info.shelves_roots;
    snap.embed.enabled = yaml_info.embed_enabled;
    snap.embed.package = yaml_info.embed_package_rel;
    snap.embed.port = yaml_info.embed_port as i64;
    snap.embed.url = format!("http://127.0.0.1:{}", yaml_info.embed_port);
    snap.desk.port = yaml_info.desk_port as i64;

    let cwd = std::path::Path::new(&cfg.project_root);
    let status: Result<Value, String> = run_imprint_json(cfg, cwd, &["status"]);
    if let Ok(v) = status {
        snap.project = v
            .get("project")
            .and_then(|x| x.as_str())
            .unwrap_or(&cfg.project_root)
            .to_string();
        snap.vault = v
            .get("vault")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        snap.hint = v
            .get("hint")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        if let Some(h) = v.get("host") {
            snap.host = serde_json::from_value(h.clone()).unwrap_or_else(|_| default_probe());
        }
        if let Some(d) = v.get("desk") {
            snap.desk = serde_json::from_value(d.clone()).unwrap_or_else(|_| default_probe());
        }
        if let Some(s) = v.get("shelves") {
            snap.shelves = serde_json::from_value(s.clone()).unwrap_or(snap.shelves);
        }
    }

    let plugins: Result<Value, String> = run_imprint_json(cfg, cwd, &["plugin", "list"]);
    if let Ok(v) = plugins {
        if let Some(arr) = v.as_array() {
            for item in arr {
                if item.get("id").and_then(|x| x.as_str()) == Some("embed") {
                    snap.embed = serde_json::from_value(item.clone()).unwrap_or(snap.embed);
                }
            }
        }
    }

    if !snap.vault.is_empty() {
        snap.sidecar_log_path = format!(
            "{}/state/plugins/embed/sidecar.log",
            snap.vault.trim_end_matches('/')
        );
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .ok();
    if let Some(c) = client {
        let health_url = format!("http://127.0.0.1:{}/health", yaml_info.embed_port);
        if let Ok(resp) = c.get(&health_url).send() {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<Value>() {
                    let ready = json.get("ready").and_then(|x| x.as_bool()).unwrap_or(false);
                    let ok = json.get("ok").and_then(|x| x.as_bool()).unwrap_or(true);
                    snap.embed_health = Some(EmbedHealthDetail {
                        ok,
                        ready,
                        raw: json,
                    });
                    // imprint plugin list is a one-shot CLI: it only marks running for
                    // children it spawned in-process. A sidecar started earlier still
                    // answers /health — treat that as running for the dashboard.
                    if ok {
                        snap.embed.running = true;
                        snap.embed.healthy = ready;
                    }
                }
            }
        }
    }

    snap
}
