//! Model packs on the desktop, in `<app data>/models` (the web build uses OPFS instead; both sit
//! behind src/models/store.ts). Downloads resume from a `.part` file with HTTP Range, every pack
//! is hashed with SHA-256 before it is moved into place, and nothing unverified is ever served.
//! The full-offline build bundles the packs as resources; they are copied and verified the same way.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPack {
    pub id: String,
    pub version: String,
    pub file: String,
    pub sha256: String,
    pub size: u64,
    pub verified_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PackSpec {
    pub id: String,
    pub version: String,
    pub file: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    phase: &'static str,
    done: u64,
    total: u64,
}

pub struct ModelStore {
    dir: PathBuf,
    bundled: Option<PathBuf>,
    index_lock: Mutex<()>,
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    import: Mutex<Option<(String, std::fs::File)>>,
}

type Res<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Pack file names come from the manifest; refuse anything that could leave the directory.
fn safe_name(name: &str) -> Res<&str> {
    let ok = !name.is_empty()
        && name.len() < 128
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !name.starts_with('.')
        && name.ends_with(".dpk");
    if ok { Ok(name) } else { Err(format!("invalid pack file name: {name}")) }
}

fn safe_sha(sha: &str) -> Res<String> {
    let s = sha.to_ascii_lowercase();
    if s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()) { Ok(s) } else { Err("invalid checksum".into()) }
}

/// RFC 3339 UTC timestamp without a date library (civil-from-days, Howard Hinnant).
fn now_iso() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn hash_file(path: &Path, total: u64, progress: &Channel<Progress>) -> Res<String> {
    let mut f = std::fs::File::open(path).map_err(err)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut done = 0u64;
    let mut last = 0u64;
    loop {
        let n = f.read(&mut buf).map_err(err)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        done += n as u64;
        if done - last >= 8 << 20 || done == total {
            last = done;
            let _ = progress.send(Progress { phase: "verify", done, total });
        }
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

impl ModelStore {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?.join("models");
        std::fs::create_dir_all(&dir)?;
        let bundled = app.path().resource_dir().ok().map(|r| r.join("models")).filter(|p| p.is_dir());
        Ok(Self { dir, bundled, index_lock: Mutex::new(()), cancels: Mutex::new(HashMap::new()), import: Mutex::new(None) })
    }

    fn index_path(&self) -> PathBuf {
        self.dir.join("index.json")
    }

    fn read_index(&self) -> Vec<StoredPack> {
        std::fs::read(self.index_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn write_index(&self, list: &[StoredPack]) -> Res<()> {
        let tmp = self.dir.join("index.json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(list).map_err(err)?).map_err(err)?;
        std::fs::rename(tmp, self.index_path()).map_err(err)
    }

    fn record(&self, pack: &PackSpec) -> Res<StoredPack> {
        let _g = self.index_lock.lock().map_err(err)?;
        let mut list: Vec<StoredPack> = self.read_index().into_iter().filter(|p| p.id != pack.id).collect();
        let stored = StoredPack {
            id: pack.id.clone(),
            version: pack.version.clone(),
            file: pack.file.clone(),
            sha256: pack.sha256.to_ascii_lowercase(),
            size: pack.size,
            verified_at: now_iso(),
        };
        list.push(stored.clone());
        self.write_index(&list)?;
        Ok(stored)
    }

    /// Hash `staged`, and move it into place as `pack.file` when it matches.
    fn finish(&self, staged: &Path, pack: &PackSpec, progress: &Channel<Progress>) -> Res<StoredPack> {
        let sha = safe_sha(&pack.sha256)?;
        let len = std::fs::metadata(staged).map_err(err)?.len();
        if len != pack.size {
            let _ = std::fs::remove_file(staged);
            return Err(format!("{} is {len} bytes; expected {}", pack.file, pack.size));
        }
        let got = hash_file(staged, len, progress)?;
        if got != sha {
            let _ = std::fs::remove_file(staged);
            return Err(format!("{} failed verification (SHA-256 mismatch); it was discarded", pack.file));
        }
        std::fs::rename(staged, self.dir.join(safe_name(&pack.file)?)).map_err(err)?;
        self.record(pack)
    }
}

#[tauri::command]
pub fn models_list(store: State<'_, ModelStore>) -> Vec<StoredPack> {
    store
        .read_index()
        .into_iter()
        .filter(|p| safe_name(&p.file).is_ok() && std::fs::metadata(store.dir.join(&p.file)).map(|m| m.len() == p.size).unwrap_or(false))
        .collect()
}

#[tauri::command]
pub async fn models_install(store: State<'_, ModelStore>, pack: PackSpec, urls: Vec<String>, progress: Channel<Progress>) -> Res<StoredPack> {
    let file = safe_name(&pack.file)?.to_string();
    safe_sha(&pack.sha256)?;
    let cancel = Arc::new(AtomicBool::new(false));
    store.cancels.lock().map_err(err)?.insert(pack.id.clone(), cancel.clone());
    let part = store.dir.join(format!("{file}.part"));
    let result = async {
        // Full-offline build: the pack ships as a resource. Copying and hashing block, so they
        // run with block_in_place: they must not hold up the runtime's workers, which also serve
        // the database and every other command while packs install.
        if let Some(b) = &store.bundled {
            let src = b.join(&file);
            if src.is_file() {
                return tokio::task::block_in_place(|| {
                    std::fs::copy(&src, &part).map_err(err)?;
                    store.finish(&part, &pack, &progress)
                });
            }
        }
        let client = reqwest::Client::builder().user_agent(concat!("DITHER/", env!("CARGO_PKG_VERSION"))).build().map_err(err)?;
        let mut last_error = String::from("no download source is configured");
        // The app's own origin (tauri.localhost, the web mirror's relative path) has no packs.
        let remote = |u: &&String| (u.starts_with("https://") || u.starts_with("http://")) && !u.contains("://tauri.localhost");
        for url in urls.iter().filter(remote) {
            match download(&client, url, &part, pack.size, &cancel, &progress).await {
                Ok(()) => return tokio::task::block_in_place(|| store.finish(&part, &pack, &progress)),
                Err(e) if cancel.load(Ordering::Relaxed) => return Err(e),
                Err(e) => last_error = format!("{url}: {e}"),
            }
        }
        Err(last_error)
    }
    .await;
    store.cancels.lock().map_err(err)?.remove(&pack.id);
    result
}

async fn download(client: &reqwest::Client, url: &str, part: &Path, total: u64, cancel: &AtomicBool, progress: &Channel<Progress>) -> Res<()> {
    use tokio::io::AsyncWriteExt;
    let have = tokio::fs::metadata(part).await.map(|m| m.len()).unwrap_or(0);
    if have > total {
        tokio::fs::remove_file(part).await.map_err(err)?;
    }
    let have = have.min(total);
    if have == total {
        return Ok(());
    }
    let mut req = client.get(url);
    if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let resp = req.send().await.map_err(err)?;
    let status = resp.status();
    let (mut file, mut done) = if status == reqwest::StatusCode::PARTIAL_CONTENT && have > 0 {
        (tokio::fs::OpenOptions::new().append(true).open(part).await.map_err(err)?, have)
    } else if status.is_success() {
        (tokio::fs::File::create(part).await.map_err(err)?, 0)
    } else {
        return Err(format!("HTTP {status}"));
    };
    let mut stream = resp.bytes_stream();
    let mut last = done;
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            file.flush().await.map_err(err)?;
            return Err("cancelled".into());
        }
        let chunk = chunk.map_err(err)?;
        file.write_all(&chunk).await.map_err(err)?;
        done += chunk.len() as u64;
        if done - last >= 1 << 20 || done == total {
            last = done;
            let _ = progress.send(Progress { phase: "download", done, total });
        }
    }
    file.flush().await.map_err(err)?;
    if done != total {
        return Err(format!("download ended at {done} of {total} bytes"));
    }
    Ok(())
}

/// Pack files shipped inside the app (full-offline build), installed on first start.
#[tauri::command]
pub fn models_bundled(store: State<'_, ModelStore>) -> Vec<String> {
    let Some(dir) = &store.bundled else { return Vec::new() };
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<String> = entries
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| safe_name(n).is_ok())
        .collect();
    out.sort();
    out
}

#[tauri::command]
pub fn models_cancel(store: State<'_, ModelStore>, id: String) {
    if let Ok(map) = store.cancels.lock() {
        if let Some(c) = map.get(&id) {
            c.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub fn models_import_begin(store: State<'_, ModelStore>, file: String) -> Res<()> {
    let name = safe_name(&file)?.to_string();
    let f = std::fs::File::create(store.dir.join(format!("{name}.import"))).map_err(err)?;
    *store.import.lock().map_err(err)? = Some((name, f));
    Ok(())
}

/// Raw body: the next chunk of the file being imported (header `x-file` names it).
#[tauri::command]
pub fn models_import_chunk(store: State<'_, ModelStore>, request: Request<'_>) -> Res<()> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let named = request.headers().get("x-file").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
    let mut guard = store.import.lock().map_err(err)?;
    let Some((name, f)) = guard.as_mut() else {
        return Err("no import in progress".into());
    };
    if *name != named {
        return Err("import chunk for a different file".into());
    }
    f.write_all(bytes).map_err(err)
}

#[tauri::command]
pub async fn models_import_finish(store: State<'_, ModelStore>, pack: PackSpec, progress: Channel<Progress>) -> Res<StoredPack> {
    let name = safe_name(&pack.file)?.to_string();
    {
        let mut guard = store.import.lock().map_err(err)?;
        match guard.take() {
            Some((n, mut f)) if n == name => f.flush().map_err(err)?,
            _ => return Err("no import in progress for this pack".into()),
        }
    }
    tokio::task::block_in_place(|| store.finish(&store.dir.join(format!("{name}.import")), &pack, &progress))
}

#[tauri::command]
pub async fn models_verify(store: State<'_, ModelStore>, id: String, sha256: String, size: u64, progress: Channel<Progress>) -> Res<bool> {
    let sha = safe_sha(&sha256)?;
    let Some(p) = store.read_index().into_iter().find(|p| p.id == id) else {
        return Ok(false);
    };
    let path = store.dir.join(safe_name(&p.file)?);
    let len = match std::fs::metadata(&path) {
        Ok(m) => m.len(),
        Err(_) => return Ok(false),
    };
    if len != size {
        return Ok(false);
    }
    let ok = tokio::task::block_in_place(|| hash_file(&path, len, &progress))? == sha;
    if ok {
        let spec = PackSpec { id: p.id, version: p.version, file: p.file, sha256: sha, size };
        store.record(&spec)?;
    }
    Ok(ok)
}

#[tauri::command]
pub async fn models_read(store: State<'_, ModelStore>, file: String, offset: u64, length: u64) -> Res<Response> {
    let path = store.dir.join(safe_name(&file)?);
    let mut f = std::fs::File::open(path).map_err(err)?;
    let size = f.metadata().map_err(err)?.len();
    if offset > size || length > size - offset {
        return Err("read past the end of the pack".into());
    }
    f.seek(SeekFrom::Start(offset)).map_err(err)?;
    let mut buf = vec![0u8; length as usize];
    f.read_exact(&mut buf).map_err(err)?;
    Ok(Response::new(buf))
}

#[tauri::command]
pub fn models_remove(store: State<'_, ModelStore>, id: String) -> Res<()> {
    let _g = store.index_lock.lock().map_err(err)?;
    let mut list = store.read_index();
    if let Some(p) = list.iter().find(|p| p.id == id) {
        if let Ok(name) = safe_name(&p.file) {
            let _ = std::fs::remove_file(store.dir.join(name));
            let _ = std::fs::remove_file(store.dir.join(format!("{name}.part")));
        }
    }
    list.retain(|p| p.id != id);
    store.write_index(&list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_cannot_escape_the_directory() {
        assert!(safe_name("maia3-23m-1.0.0.dpk").is_ok());
        for bad in ["../x.dpk", "a/b.dpk", "a\\b.dpk", ".dpk", "x.onnx", "", "x .dpk"] {
            assert!(safe_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn checksums_are_hex() {
        assert!(safe_sha(&"A".repeat(64)).is_ok());
        assert!(safe_sha(&"g".repeat(64)).is_err());
        assert!(safe_sha("abc").is_err());
    }

    #[test]
    fn timestamps_are_rfc3339() {
        let t = now_iso();
        assert_eq!(t.len(), 20);
        assert!(t.ends_with('Z'));
        assert_eq!(&t[4..5], "-");
    }
}
