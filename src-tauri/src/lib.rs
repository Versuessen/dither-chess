//! DITHER desktop shell: the same web app as the PWA in a Tauri v2 window, with SQLite storage
//! (tauri-plugin-sql) and a model store in the app data directory (models.rs).

mod linux;
mod models;
mod smoke;

pub fn run() {
    // Must run before anything starts a thread or initialises WebKitGTK.
    #[cfg(target_os = "linux")]
    linux::apply_webkit_workarounds();

    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            let store = models::ModelStore::new(app.handle())?;
            tauri::Manager::manage(app, store);
            if let Ok(path) = std::env::var("DITHER_SMOKE") {
                smoke::arm(app.handle().clone(), path.into());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            models::models_list,
            models::models_bundled,
            models::models_install,
            models::models_cancel,
            models::models_import_begin,
            models::models_import_chunk,
            models::models_import_finish,
            models::models_verify,
            models::models_read,
            models::models_remove,
            linux::platform_notes,
            smoke::smoke_packs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DITHER");
}
