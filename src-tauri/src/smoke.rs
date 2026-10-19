//! Installer smoke test: started with `DITHER_SMOKE=<file>`, the app writes what the web side
//! reports once it has booted (storage backend, cross-origin isolation, inference backend,
//! start-up errors) to that file as JSON and exits 0, or writes a timeout and exits 1.
//! With `DITHER_SMOKE_PACKS=<url>` as well, the web side first installs a model pack from that
//! directory through the desktop model store and runs it once.

use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Listener};

pub fn arm(app: AppHandle, path: PathBuf) {
    let out = path.clone();
    let handle = app.clone();
    app.listen("dither-booted", move |event| {
        let ok = std::fs::write(&out, event.payload()).is_ok();
        handle.exit(if ok { 0 } else { 2 });
    });
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(240));
        let _ = std::fs::write(&path, r#"{"error":"the app did not finish booting within 240 s"}"#);
        app.exit(1);
    });
}

/// The pack directory for the smoke test, only while a smoke test runs.
#[tauri::command]
pub fn smoke_packs() -> Option<String> {
    std::env::var_os("DITHER_SMOKE")?;
    std::env::var("DITHER_SMOKE_PACKS").ok().filter(|s| !s.is_empty())
}
