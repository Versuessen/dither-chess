//! Installer smoke test: started with `DITHER_SMOKE=<file>`, the app writes what the web side
//! reports once it has booted (storage backend, cross-origin isolation, inference backend,
//! start-up errors) to that file as JSON and exits 0, or writes a timeout and exits 1.

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
        std::thread::sleep(Duration::from_secs(120));
        let _ = std::fs::write(&path, r#"{"error":"the app did not finish booting within 120 s"}"#);
        app.exit(1);
    });
}
