pub mod github;
pub mod global_embed;
pub mod install;
pub mod manifest;
pub mod paths;
pub mod status;

pub use global_embed::{
    ensure_ready_for_plugin, GlobalEmbedDoc, embed_port, load as load_global_embed,
    save as save_global_embed,
};
pub use install::{ensure_all, update_component};
pub use status::{get_runtime_status, RuntimeStatus};
