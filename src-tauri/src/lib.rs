mod commands;
mod config;
mod imprint;
mod imprint_resolve;
mod log_tail;
mod runtime;
mod services;
mod snapshot;
mod state;
mod yaml_cfg;

use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use config::{load_config, save_config, AppConfig};
use imprint::{check_python, kill_job, run_imprint_capture, spawn_streaming};
use snapshot::Snapshot;
use state::AppState;
use yaml_cfg::validate_project;

#[tauri::command]
async fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    tauri::async_runtime::spawn_blocking(move || load_config(&app))
        .await
        .map_err(|e| e.to_string())?
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
    stopped_stack: bool,
}

fn normalize_project_path(path: &str) -> &str {
    path.trim().trim_end_matches(['/', '\\'])
}

fn should_stop_previous_stack(current: &str, next: &str) -> bool {
    let current = normalize_project_path(current);
    let next = normalize_project_path(next);
    !current.is_empty() && current != next
}

/// `imprint down` stops the project Host and project plugins. Embed stays up.
fn stop_previous_stack(cfg: &config::AppConfig, next_path: &str) -> Result<bool, String> {
    if !should_stop_previous_stack(&cfg.project_root, next_path) {
        return Ok(false);
    }
    let current = normalize_project_path(&cfg.project_root);
    let snap = snapshot::fetch_snapshot(cfg);
    let was_up = snap.host.listening;
    let (code, stdout, stderr) =
        run_imprint_capture(cfg, std::path::Path::new(current), &["down"])?;
    if code != 0 {
        let stderr = stderr.trim();
        let stdout = stdout.trim();
        return Err(if !stderr.is_empty() {
            stderr.to_string()
        } else if !stdout.is_empty() {
            stdout.to_string()
        } else {
            format!("imprint down exited with code {code}")
        });
    }
    Ok(was_up)
}

#[tauri::command]
async fn open_project(app: AppHandle, path: String) -> Result<OpenProjectResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let info = validate_project(&path)?;
        let mut cfg = load_config(&app)?;
        let stopped_stack = stop_previous_stack(&cfg, &path)?;
        config::remember_project(&mut cfg, &path);
        save_config(&app, &cfg)?;
        let _info = info;
        Ok(OpenProjectResult {
            project_root: path,
            stopped_stack,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_snapshot(app: AppHandle) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = load_config(&app).unwrap_or_default();
        Ok(snapshot::fetch_snapshot(&cfg))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_prerequisites(app: AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let py_path = runtime::paths::managed_python_bin(&app_data);
        let py_version = if py_path.is_file() {
            imprint::python_version_at(&py_path)?
        } else {
            check_python()?
        };
        let (embed, _) = runtime::load_global_embed()?;
        Ok(serde_json::json!({
            "pythonVersion": py_version,
            "embedPackage": embed.package,
            "embedPort": runtime::embed_port(&embed),
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn run_imprint_simple(
    app: AppHandle,
    state: State<'_, AppState>,
    stream_id: String,
    args: Vec<String>,
) -> Result<(), String> {
    let cfg = load_config(&app)?;
    ensure_no_job(&state)?;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let embed_global = is_embed_global_cmd(&args);
    if embed_global {
        runtime::ensure_ready_for_plugin(&app_data)?;
        let bin = config::effective_imprint_bin(&cfg);
        if !crate::imprint_resolve::imprint_supports_global_embed(std::path::Path::new(&bin)) {
            return Err(
                "当前 imprint 过旧（v1.3.9 无法启动 embed）。请在「设置 → 运行环境」对 imprint 点「更新」，或在 imprint 仓库执行：go install ./cmd/imprint ./cmd/imprint-mcp"
                    .into(),
            );
        }
    }
    let cwd = if embed_global {
        runtime::paths::sidecar_dir(&app_data)
    } else if cfg.project_root.is_empty() {
        return Err("select a project first".into());
    } else {
        PathBuf::from(&cfg.project_root)
    };
    let bin = config::effective_imprint_bin(&cfg);
    let handle = spawn_streaming(app.clone(), stream_id.clone(), cfg, cwd, bin, args, false)?;
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
    ensure_no_job(&state)?;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let sidecar = runtime::paths::sidecar_dir(&app_data);
    let script = sidecar.join("scripts/setup.sh");
    if !script.is_file() {
        return Err("sidecar not installed — run ensure runtime first".into());
    }
    let py = runtime::paths::managed_python_bin(&app_data);
    let cmd = format!(
        "PYTHON={} sh {}",
        shell_escape(&py.to_string_lossy()),
        script.to_string_lossy()
    );
    let handle = spawn_streaming(
        app.clone(),
        stream_id.clone(),
        cfg,
        sidecar,
        cmd,
        vec![],
        true,
    )?;
    *state.active_job.lock().map_err(|e| e.to_string())? = Some((stream_id, handle));
    Ok(())
}

fn is_embed_global_cmd(args: &[String]) -> bool {
    if args.first().map(|s| s.as_str()) == Some("embed") {
        return true;
    }
    if args.len() >= 3 && args[0] == "plugin" && (args[1] == "start" || args[1] == "stop") {
        return args[2..].iter().any(|s| s == "embed");
    }
    false
}

fn shell_escape(s: &str) -> String {
    if s.contains(' ') || s.contains('\'') {
        format!("'{}'", s.replace('\'', "'\\''"))
    } else {
        s.to_string()
    }
}

#[tauri::command]
async fn get_runtime_status_cmd(app: AppHandle) -> Result<runtime::RuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let cfg = load_config(&app)?;
        Ok(runtime::get_runtime_status(&app_data, &cfg))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_global_embed_cmd() -> Result<runtime::GlobalEmbedDoc, String> {
    runtime::load_global_embed().map(|(d, _)| d)
}

#[tauri::command]
fn save_global_embed_cmd(doc: runtime::GlobalEmbedDoc) -> Result<(), String> {
    runtime::validate_global_embed(&doc)?;
    runtime::save_global_embed(&doc).map(|_| ())
}

#[tauri::command]
fn ensure_runtime(
    app: AppHandle,
    state: State<'_, AppState>,
    stream_id: String,
) -> Result<(), String> {
    ensure_no_job(&state)?;
    if !runtime::status::git_available() {
        return Err("git is required to clone embed sidecar".into());
    }
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let app2 = app.clone();
    let sid = stream_id.clone();
    let handle = Arc::new(imprint::JobHandle {
        child: std::sync::Mutex::new(None),
    });
    *state.active_job.lock().map_err(|e| e.to_string())? =
        Some((stream_id.clone(), handle.clone()));
    thread::spawn(move || {
        let result = runtime::ensure_all(&app2, &app_data, &sid);
        if result.is_ok() {
            if let Ok(mut cfg) = load_config(&app2) {
                if config::sync_global_imprint_bin(&mut cfg) {
                    let _ = save_config(&app2, &cfg);
                }
            }
        }
        if let Err(e) = result {
            let _ = app2.emit(
                "job-output",
                serde_json::json!({ "streamId": sid, "kind": "stderr", "line": e }),
            );
        }
        if let Some(st) = app2.try_state::<AppState>() {
            if let Ok(mut guard) = st.active_job.lock() {
                if guard.as_ref().map(|(s, _)| s == &sid).unwrap_or(false) {
                    *guard = None;
                }
            }
        }
        let _ = app2.emit("job-finished", serde_json::json!({ "streamId": sid }));
    });
    Ok(())
}

#[tauri::command]
fn update_runtime_component(
    app: AppHandle,
    state: State<'_, AppState>,
    stream_id: String,
    name: String,
) -> Result<(), String> {
    ensure_no_job(&state)?;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let app2 = app.clone();
    let sid = stream_id.clone();
    let component = name.clone();
    let handle = Arc::new(imprint::JobHandle {
        child: std::sync::Mutex::new(None),
    });
    *state.active_job.lock().map_err(|e| e.to_string())? = Some((stream_id.clone(), handle));
    thread::spawn(move || {
        let result = runtime::update_component(&app2, &app_data, &sid, &component);
        if result.is_ok() && component == "imprint" {
            if let Ok(mut cfg) = load_config(&app2) {
                if config::sync_global_imprint_bin(&mut cfg) {
                    let _ = save_config(&app2, &cfg);
                }
            }
        }
        if let Err(e) = result {
            let _ = app2.emit(
                "job-output",
                serde_json::json!({ "streamId": sid, "kind": "stderr", "line": e }),
            );
        }
        if let Some(st) = app2.try_state::<AppState>() {
            if let Ok(mut guard) = st.active_job.lock() {
                if guard.as_ref().map(|(s, _)| s == &sid).unwrap_or(false) {
                    *guard = None;
                }
            }
        }
        let _ = app2.emit("job-finished", serde_json::json!({ "streamId": sid }));
    });
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
    let log_path = runtime::paths::global_sidecar_log()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned();
    if log_path.is_empty() {
        return Err("sidecar log path unknown".into());
    }
    stop_tail(&state)?;
    let handle = log_tail::tail_file(app, stream_id.clone(), log_path)?;
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
async fn imprint_up_down(app: AppHandle, up: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new());

    #[cfg(all(debug_assertions, feature = "e2e"))]
    let builder = builder
        .plugin(tauri_plugin_wdio_webdriver::init())
        .plugin(tauri_plugin_wdio::init());

    builder
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
            get_runtime_status_cmd,
            ensure_runtime,
            update_runtime_component,
            get_global_embed_cmd,
            save_global_embed_cmd,
            commands::desk::desk_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::should_stop_previous_stack;

    #[test]
    fn switch_stops_only_when_leaving_another_project() {
        assert!(!should_stop_previous_stack("", "/work/b"));
        assert!(!should_stop_previous_stack("/work/a", "/work/a"));
        assert!(!should_stop_previous_stack("/work/a/", "/work/a"));
        assert!(should_stop_previous_stack("/work/a", "/work/b"));
    }
}
