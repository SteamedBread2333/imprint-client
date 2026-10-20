use std::path::PathBuf;

pub const IMPRINT_GITHUB: &str = "SteamedBread2333/imprint";
pub const SIDECAR_REPO: &str = "https://github.com/SteamedBread2333/imprint-embed-sidecar.git";

pub fn user_imprint_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".imprint"))
}

pub fn global_embed_yaml() -> Result<PathBuf, String> {
    Ok(user_imprint_dir()?.join("embed.yaml"))
}

pub fn global_sidecar_log() -> Result<PathBuf, String> {
    Ok(user_imprint_dir()?
        .join("state")
        .join("plugins")
        .join("embed")
        .join("sidecar.log"))
}

pub fn runtime_root(app_data: &PathBuf) -> PathBuf {
    app_data.join("runtime")
}

pub fn sidecar_dir(app_data: &PathBuf) -> PathBuf {
    runtime_root(app_data).join("embed-sidecar")
}

pub fn python_dir(app_data: &PathBuf) -> PathBuf {
    runtime_root(app_data).join("python")
}

pub fn managed_python_bin(app_data: &PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        return python_dir(app_data).join("python.exe");
    }
    #[cfg(not(windows))]
    {
        let p3 = python_dir(app_data).join("bin").join("python3");
        if p3.is_file() {
            return p3;
        }
        python_dir(app_data).join("bin").join("python")
    }
}

pub fn manifest_path(app_data: &PathBuf) -> PathBuf {
    runtime_root(app_data).join("manifest.json")
}

fn home_dir() -> Result<PathBuf, String> {
    dirs_home().ok_or_else(|| "home directory unknown".to_string())
}

fn dirs_home() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

/// (go dist os, go dist arch) for imprint release archives.
pub fn imprint_release_triple() -> Result<(&'static str, &'static str), String> {
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    match (os, arch) {
        ("macos", "aarch64") => Ok(("darwin", "arm64")),
        ("macos", "x86_64") => Ok(("darwin", "amd64")),
        ("linux", "x86_64") => Ok(("linux", "amd64")),
        ("linux", "aarch64") => Ok(("linux", "arm64")),
        ("windows", "x86_64") => Ok(("windows", "amd64")),
        ("windows", "aarch64") => Ok(("windows", "arm64")),
        _ => Err(format!("unsupported OS/arch: {os}/{arch}")),
    }
}
