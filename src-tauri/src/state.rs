use std::sync::Mutex;

use crate::imprint::JobHandle;
use crate::log_tail::TailHandle;

pub struct AppState {
    pub active_job: Mutex<Option<(String, std::sync::Arc<JobHandle>)>>,
    pub active_tail: Mutex<Option<(String, std::sync::Arc<TailHandle>)>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            active_job: Mutex::new(None),
            active_tail: Mutex::new(None),
        }
    }
}
