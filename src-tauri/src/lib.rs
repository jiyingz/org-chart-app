// The Mac app is a thin native window around the same web app that runs on iPhone.
// All data handling (local storage, GitHub sync) lives in the shared TypeScript code.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running OrgMap");
}
