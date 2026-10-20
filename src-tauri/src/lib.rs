mod config;
mod imprint;
mod log_tail;
mod snapshot;
mod state;
mod yaml_cfg;

use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use config::{load_config, save_config, AppConfig};
use imprint::{check_python, kill_job, run_imprint_capture, spawn_streaming};
use snapshot::Snapshot;
use state::AppState;
use yaml_cfg::validate_project;

#[tauri::command]
fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    load_config(&app)
}

#[tauri::command]
fn save_app_config(app: AppHandle, cfg: AppConfig) -> Result<(), String> {
    save_config(&app, &cfg)
}

#[tauri::command]
async fn pick_project_folder(app: AppHandle) -> Result<Option<String>, String> {
    let path = app
        .dialog()
        .file()
        .set_title("选择 imprint 项目根目录")
        .blocking_pick_folder();
    Ok(path.map(|p| p.to_string()))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenProjectResult {
    project_root: String,
    embed_package: String,
}

#[tauri::command]
fn open_project(app: AppHandle, path: String) -> Result<OpenProjectResult, String> {
    let info = validate_project(&path)?;
    let mut cfg = load_config(&app)?;
    cfg.project_root = path.clone();
    save_config(&app, &cfg)?;
    Ok(OpenProjectResult {
        project_root: path,
        embed_package: info.embed_package_abs.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn get_snapshot(app: AppHandle) -> Snapshot {
    let cfg = load_config(&app).unwrap_or_default();
    snapshot::fetch_snapshot(&cfg)
}

#[tauri::command]
fn check_prerequisites(app: AppHandle) -> Result<serde_json::Value, String> {
    let cfg = load_config(&app)?;
    if cfg.project_root.is_empty() {
        return Err("select a project first".into());
    }
    let py = check_python()?;
    let info = validate_project(&cfg.project_root)?;
    Ok(serde_json::json!({
        "pythonVersion": py,
        "embedPackage": info.embed_package_abs,
        "embedPort": info.embed_port,
    }))
}

#[tauri::command]
fn run_imprint_simple(
    app: AppHandle,
    state: State<'_, AppState>,
    stream_id: String,
    args: Vec<String>,
) -> Result<(), String> {
    let cfg = load_config(&app)?;
    if cfg.project_root.is_empty() {
        return Err("select a project first".into());
    }
    ensure_no_job(&state)?;
    let cwd = PathBuf::from(&cfg.project_root);
    let bin = cfg.imprint_bin.clone();
    let handle = spawn_streaming(
        app.clone(),
        stream_id.clone(),
        cfg,
        cwd,
        bin,
        args,
        false,
    )?;
    *state.active_job.lock().map_err(|e| e.to_string())? = Some((stream_id, handle));
    Ok(())
}

#[tauri::command]
fn run_sidecar_setup(
    app: AppHandle,
    state: State<'_, AppState>,
    stream_id: String,
) -> Result<(), String> {
    let cfg = load_config(&app)?;
    if cfg.project_root.is_empty() {
        return Err("select a project first".into());
    }
    let info = validate_project(&cfg.project_root)?;
    ensure_no_job(&state)?;
    let script = info.embed_package_abs.join("scripts/setup.sh");
    let cmd = format!("sh {}", script.to_string_lossy());
    let handle = spawn_streaming(
        app.clone(),
        stream_id.clone(),
        cfg,
        info.embed_package_abs,
        cmd,
        vec![],
        true,
    )?;
    *state.active_job.lock().map_err(|e| e.to_string())? = Some((stream_id, handle));
    Ok(())
}

/// Clears a finished (or orphaned) job slot so the user need not restart the app.
#[tauri::command]
fn release_active_job(state: State<'_, AppState>) -> Result<bool, String> {
    let mut guard = state.active_job.lock().map_err(|e| e.to_string())?;
    let Some((_, handle)) = guard.as_ref() else {
        return Ok(false);
    };
    let finished = {
        let mut child_guard = handle.child.lock().map_err(|e| e.to_string())?;
        match child_guard.as_mut() {
            Some(child) => child.try_wait().ok().flatten().is_some(),
            None => true,
        }
    };
    if finished {
        *guard = None;
        return Ok(true);
    }
    Err("another task is running — wait or cancel".into())
}

#[tauri::command]
fn cancel_active_job(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.active_job.lock().map_err(|e| e.to_string())?;
    if let Some((_, h)) = guard.take() {
        kill_job(&h)?;
    }
    Ok(())
}

#[tauri::command]
fn start_sidecar_log_tail(
    app: AppHandle,
    state: State<'_, AppState>,
    stream_id: String,
) -> Result<(), String> {
    let cfg = load_config(&app)?;
    let snap = snapshot::fetch_snapshot(&cfg);
    if snap.sidecar_log_path.is_empty() {
        return Err("sidecar log path unknown (run imprint status first)".into());
    }
    stop_tail(&state)?;
    let handle = log_tail::tail_file(app, stream_id.clone(), snap.sidecar_log_path)?;
    *state.active_tail.lock().map_err(|e| e.to_string())? = Some((stream_id, handle));
    Ok(())
}

#[tauri::command]
fn stop_sidecar_log_tail(state: State<'_, AppState>) -> Result<(), String> {
    stop_tail(&state)
}

fn stop_tail(state: &State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.active_tail.lock().map_err(|e| e.to_string())?;
    if let Some((_, h)) = guard.take() {
        h.stop();
    }
    Ok(())
}

fn ensure_no_job(state: &State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.active_job.lock().map_err(|e| e.to_string())?;
    let Some((_, handle)) = guard.as_ref() else {
        return Ok(());
    };
    let finished = {
        let mut child_guard = handle.child.lock().map_err(|e| e.to_string())?;
        match child_guard.as_mut() {
            Some(child) => child.try_wait().ok().flatten().is_some(),
            None => true,
        }
    };
    if finished {
        *guard = None;
        return Ok(());
    }
    Err("another task is running — wait or cancel".into())
}

#[tauri::command]
fn imprint_up_down(app: AppHandle, up: bool) -> Result<String, String> {
    let cfg = load_config(&app)?;
    if cfg.project_root.is_empty() {
        return Err("select a project first".into());
    }
    let sub = if up { "up" } else { "down" };
    let (code, stdout, stderr) =
        run_imprint_capture(&cfg, PathBuf::from(&cfg.project_root).as_path(), &[sub])?;
    if code != 0 {
        return Err(if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        });
    }
    Ok(stdout)
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("path is empty".into());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("reveal in finder is macOS-only in this MVP".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_app_config,
            pick_project_folder,
            open_project,
            get_snapshot,
            check_prerequisites,
            run_imprint_simple,
            run_sidecar_setup,
            release_active_job,
            cancel_active_job,
            start_sidecar_log_tail,
            stop_sidecar_log_tail,
            imprint_up_down,
            reveal_in_finder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
