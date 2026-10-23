use std::sync::Mutex;

use crate::imprint::JobHandle;
use crate::log_tail::TailHandle;
use crate::services::host_api::HostApi;

pub struct AppState {
    pub active_job: Mutex<Option<(String, std::sync::Arc<JobHandle>)>>,
    pub active_tail: Mutex<Option<(String, std::sync::Arc<TailHandle>)>>,
    pub host_api: HostApi,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            active_job: Mutex::new(None),
            active_tail: Mutex::new(None),
            host_api: HostApi::new(),
        }
    }
}
