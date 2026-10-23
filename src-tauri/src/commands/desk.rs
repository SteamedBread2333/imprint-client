use serde_json::Value;
use tauri::{AppHandle, State};

use crate::config::load_config;
use crate::services::host_api::{host_base_url, DeskApiError, DeskRequest};
use crate::state::AppState;
use crate::yaml_cfg::parse_project_yaml;

#[tauri::command]
pub async fn desk_request(
    app: AppHandle,
    state: State<'_, AppState>,
    request: DeskRequest,
) -> Result<Value, DeskApiError> {
    let cfg = load_config(&app).map_err(|detail| {
        let mut error = DeskApiError::new("CONFIG_ERROR", "failed to load Console config");
        error.source = "config";
        error.detail = Some(detail);
        error
    })?;
    if cfg.project_root.trim().is_empty() {
        return Err(DeskApiError::new(
            "NO_PROJECT",
            "select an imprint project before opening Audit",
        ));
    }
    let yaml = parse_project_yaml(&cfg.project_root).map_err(|detail| {
        let mut error = DeskApiError::new("PROJECT_CONFIG_ERROR", "failed to read imprint.yaml");
        error.source = "config";
        error.detail = Some(detail);
        error
    })?;
    let base = host_base_url(&yaml.host_listen)?;
    state.host_api.execute(base, request).await
}
