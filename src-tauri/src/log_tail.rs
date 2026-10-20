use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

pub struct TailHandle {
    stop: Arc<AtomicBool>,
}

impl TailHandle {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

pub fn tail_file(app: AppHandle, stream_id: String, path: String) -> Result<Arc<TailHandle>, String> {
    if path.trim().is_empty() {
        return Err("log path is empty".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    thread::spawn(move || {
        let mut offset: u64 = 0;
        while !stop2.load(Ordering::SeqCst) {
            offset = tail_once(&app, &stream_id, &path, offset);
            thread::sleep(Duration::from_millis(150));
        }
    });
    Ok(Arc::new(TailHandle { stop }))
}

fn tail_once(app: &AppHandle, stream_id: &str, path: &str, offset: u64) -> u64 {
    let Ok(mut f) = File::open(Path::new(path)) else {
        return offset;
    };
    let Ok(meta) = f.metadata() else {
        return offset;
    };
    let size = meta.len();
    let mut off = offset;
    if size < off {
        off = 0;
    }
    if size <= off {
        return off;
    }
    if f.seek(SeekFrom::Start(off)).is_err() {
        return offset;
    }
    let mut buf = vec![0u8; (size - off) as usize];
    if f.read_exact(&mut buf).is_err() {
        return offset;
    }
    let text = String::from_utf8_lossy(&buf);
    for line in text.lines() {
        let _ = app.emit(
            "job-output",
            serde_json::json!({ "streamId": stream_id, "kind": "log", "line": line }),
        );
    }
    size
}
