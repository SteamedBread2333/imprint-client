use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::config::{self, AppConfig};
use crate::state::AppState;

pub fn extra_env(cfg: &AppConfig) -> HashMap<String, String> {
    let mut m = HashMap::new();
    if !cfg.hf_endpoint.trim().is_empty() {
        m.insert("HF_ENDPOINT".into(), cfg.hf_endpoint.trim().into());
    }
    if !cfg.imprint_hf_endpoint.trim().is_empty() {
        m.insert(
            "IMPRINT_HF_ENDPOINT".into(),
            cfg.imprint_hf_endpoint.trim().into(),
        );
    }
    m
}

pub fn run_imprint_capture(
    cfg: &AppConfig,
    cwd: &Path,
    args: &[&str],
) -> Result<(i32, String, String), String> {
    let mut cmd = Command::new(config::effective_imprint_bin(cfg));
    cmd.args(args).current_dir(cwd).stdout(Stdio::piped()).stderr(Stdio::piped());
    for (k, v) in extra_env(cfg) {
        cmd.env(k, v);
    }
    let out = cmd.output().map_err(|e| format!("failed to run imprint: {e}"))?;
    let code = out.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    Ok((code, stdout, stderr))
}

pub fn run_imprint_json(cfg: &AppConfig, cwd: &Path, subcmd: &[&str]) -> Result<Value, String> {
    let mut args = vec!["--json"];
    args.extend(subcmd);
    let (code, stdout, stderr) = run_imprint_capture(cfg, cwd, &args)?;
    if code != 0 {
        let msg = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(if msg.is_empty() {
            format!("imprint exited with code {code}")
        } else {
            msg
        });
    }
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(trimmed).map_err(|e| format!("invalid json from imprint: {e}"))
}

pub struct JobHandle {
    pub child: Mutex<Option<std::process::Child>>,
}

pub fn spawn_streaming(
    app: AppHandle,
    stream_id: String,
    cfg: AppConfig,
    cwd: std::path::PathBuf,
    program: String,
    program_args: Vec<String>,
    shell: bool,
) -> Result<Arc<JobHandle>, String> {
    let mut cmd = if shell {
        let mut c = Command::new("sh");
        c.arg("-c").arg(program).current_dir(&cwd);
        c
    } else {
        let mut c = Command::new(&program);
        c.args(&program_args).current_dir(&cwd);
        c
    };
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    for (k, v) in extra_env(&cfg) {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let handle = Arc::new(JobHandle {
        child: Mutex::new(Some(child)),
    });
    let app1 = app.clone();
    let sid1 = stream_id.clone();
    if let Some(out) = stdout {
        thread::spawn(move || stream_reader(app1, sid1, out, "stdout"));
    }
    let app2 = app.clone();
    let sid2 = stream_id.clone();
    if let Some(err) = stderr {
        thread::spawn(move || stream_reader(app2, sid2, err, "stderr"));
    }
    let h2 = handle.clone();
    let app3 = app.clone();
    thread::spawn(move || {
        loop {
            let finished = {
                let mut guard = match h2.child.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                match guard.as_mut() {
                    Some(child) => child.try_wait().ok().flatten().is_some(),
                    None => true,
                }
            };
            if finished {
                if let Some(state) = app3.try_state::<AppState>() {
                    if let Ok(mut guard) = state.active_job.lock() {
                        let ours = guard
                            .as_ref()
                            .map(|(sid, _)| sid == &stream_id)
                            .unwrap_or(false);
                        if ours {
                            *guard = None;
                        }
                    }
                }
                let _ = app3.emit(
                    "job-finished",
                    serde_json::json!({ "streamId": stream_id }),
                );
                break;
            }
            thread::sleep(std::time::Duration::from_millis(200));
        }
    });
    Ok(handle)
}

fn stream_reader(app: AppHandle, stream_id: String, pipe: impl std::io::Read + Send + 'static, kind: &'static str) {
    let reader = BufReader::new(pipe);
    for line in reader.lines() {
        match line {
            Ok(l) => {
                let _ = app.emit(
                    "job-output",
                    serde_json::json!({ "streamId": stream_id, "kind": kind, "line": l }),
                );
            }
            Err(_) => break,
        }
    }
}

pub fn kill_job(handle: &JobHandle) -> Result<(), String> {
    let mut guard = handle.child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        child.kill().map_err(|e| e.to_string())?;
    }
    *guard = None;
    Ok(())
}

pub fn python_version_at(bin: &std::path::Path) -> Result<String, String> {
    let out = Command::new(bin)
        .arg("-c")
        .arg("import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        .output()
        .map_err(|e| format!("python failed: {e}"))?;
    if !out.status.success() {
        return Err("managed python failed version check".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn check_python() -> Result<String, String> {
    let out = Command::new("python3")
        .arg("-c")
        .arg("import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}'); sys.exit(0 if sys.version_info >= (3, 11) else 1)")
        .output()
        .map_err(|e| format!("python3 not found: {e}"))?;
    if !out.status.success() {
        return Err("Python 3.11+ required (set PYTHON=... if needed)".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
