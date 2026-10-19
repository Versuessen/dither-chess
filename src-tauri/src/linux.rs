//! WebKitGTK workarounds for NVIDIA's proprietary driver on Linux.
//!
//! With the NVIDIA driver, WebKitGTK can show a blank window, fail with a DMA-BUF framebuffer
//! error, or crash with Wayland "Error 71" (tauri-apps/tauri#9394, WebKit bug 261874). Tauri's
//! Linux graphics guide lists the fixes in order of cost:
//!   `__NV_DISABLE_EXPLICIT_SYNC=1`        no performance cost (Wayland Error 71)
//!   `WEBKIT_DISABLE_DMABUF_RENDERER=1`    fixes both, gives up the faster rendering path
//! and warns against applying them unconditionally. So they are applied only when the NVIDIA
//! driver is loaded. The user decides instead when they set either variable themselves, or with
//! `DITHER_DMABUF=on` (never apply) / `DITHER_DMABUF=off` (always apply).

use std::sync::OnceLock;

static NOTE: OnceLock<Option<String>> = OnceLock::new();

#[cfg(target_os = "linux")]
fn nvidia_driver_loaded() -> bool {
    use std::path::Path;
    Path::new("/proc/driver/nvidia/version").exists() || Path::new("/sys/module/nvidia_drm").exists()
}

#[cfg(target_os = "linux")]
pub fn apply_webkit_workarounds() {
    const DMABUF: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    const SYNC: &str = "__NV_DISABLE_EXPLICIT_SYNC";
    let apply = || {
        // SAFETY: called first thing in main, before any other thread exists.
        unsafe {
            std::env::set_var(SYNC, "1");
            std::env::set_var(DMABUF, "1");
        }
    };
    let note = if std::env::var_os(DMABUF).is_some() || std::env::var_os(SYNC).is_some() {
        Some(format!("{DMABUF} or {SYNC} is set in the environment; left as is."))
    } else {
        match std::env::var("DITHER_DMABUF").as_deref() {
            Ok("on") => Some("DMA-BUF renderer kept on (DITHER_DMABUF=on).".to_string()),
            Ok("off") => {
                apply();
                Some("DMA-BUF renderer turned off (DITHER_DMABUF=off).".to_string())
            }
            _ if nvidia_driver_loaded() => {
                apply();
                Some("NVIDIA driver detected: WebKitGTK's DMA-BUF renderer and explicit sync turned off to avoid a blank window.".to_string())
            }
            _ => None,
        }
    };
    if let Some(n) = &note {
        eprintln!("dither: {n}");
    }
    let _ = NOTE.set(note);
}

/// What the platform layer changed at start-up, for the Settings screen.
#[tauri::command]
pub fn platform_notes() -> Vec<String> {
    NOTE.get().cloned().flatten().into_iter().collect()
}
