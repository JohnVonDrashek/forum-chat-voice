use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

// ============================================================================
// State
// ============================================================================

struct CloseToTrayState(Mutex<bool>);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForumManifest {
    pub forumline_version: String,
    pub name: String,
    pub domain: String,
    pub icon_url: String,
    pub api_base: String,
    pub web_base: String,
    pub capabilities: Vec<String>,
    pub description: Option<String>,
    pub banner_url: Option<String>,
    pub accent_color: Option<String>,
    pub member_count: Option<u64>,
    pub invite_required: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForumMembership {
    pub domain: String,
    pub name: String,
    pub icon_url: String,
    pub web_base: String,
    pub api_base: String,
    pub capabilities: Vec<String>,
    pub accent_color: Option<String>,
    pub session_token: Option<String>,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnreadCounts {
    pub notifications: u32,
    pub chat_mentions: u32,
    pub dms: u32,
}

struct ForumListState(Mutex<Vec<ForumMembership>>);
struct UnreadCountsState(Mutex<HashMap<String, UnreadCounts>>);
struct ActiveForumState(Mutex<Option<String>>);

// ============================================================================
// IPC Commands
// ============================================================================

#[tauri::command]
fn set_close_to_tray(enabled: bool, app: tauri::AppHandle) {
    let state = app.state::<CloseToTrayState>();
    *state.0.lock().unwrap() = enabled;
}

/// Add a forum by URL — fetches the manifest and adds it to the forum list
#[tauri::command]
async fn add_forum(url: String, app: tauri::AppHandle) -> Result<ForumManifest, String> {
    // Normalize the URL and fetch the manifest
    let manifest_url = if url.contains("/.well-known/forumline-manifest.json") {
        url.clone()
    } else {
        let base = url.trim_end_matches('/');
        format!("{base}/.well-known/forumline-manifest.json")
    };

    let resp = reqwest::get(&manifest_url)
        .await
        .map_err(|e| format!("Failed to fetch manifest: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Forum returned HTTP {}: not a valid Forumline forum",
            resp.status()
        ));
    }

    let manifest: ForumManifest = resp
        .json()
        .await
        .map_err(|e| format!("Invalid manifest JSON: {e}"))?;

    if manifest.forumline_version != "1" {
        return Err(format!(
            "Unsupported Forumline version: {}",
            manifest.forumline_version
        ));
    }

    // Add to forum list if not already present
    let forum_list = app.state::<ForumListState>();
    let mut forums = forum_list.0.lock().unwrap();

    if forums.iter().any(|f| f.domain == manifest.domain) {
        return Ok(manifest);
    }

    let membership = ForumMembership {
        domain: manifest.domain.clone(),
        name: manifest.name.clone(),
        icon_url: manifest.icon_url.clone(),
        web_base: manifest.web_base.clone(),
        api_base: manifest.api_base.clone(),
        capabilities: manifest.capabilities.clone(),
        accent_color: manifest.accent_color.clone(),
        session_token: None,
        added_at: chrono::Utc::now().to_rfc3339(),
    };

    forums.push(membership);

    // Initialize unread counts
    let unread_state = app.state::<UnreadCountsState>();
    unread_state.0.lock().unwrap().insert(
        manifest.domain.clone(),
        UnreadCounts {
            notifications: 0,
            chat_mentions: 0,
            dms: 0,
        },
    );

    Ok(manifest)
}

/// Switch the active forum
#[tauri::command]
fn switch_forum(domain: String, app: tauri::AppHandle) -> Result<(), String> {
    let forum_list = app.state::<ForumListState>();
    let forums = forum_list.0.lock().unwrap();

    let forum = forums
        .iter()
        .find(|f| f.domain == domain)
        .ok_or_else(|| format!("Forum not found: {domain}"))?;

    let _web_base = forum.web_base.clone();

    let active_state = app.state::<ActiveForumState>();
    *active_state.0.lock().unwrap() = Some(domain.clone());

    // Emit event to frontend to navigate
    app.emit("forum-switched", &domain)
        .map_err(|e| format!("Failed to emit event: {e}"))?;

    Ok(())
}

/// Get the list of joined forums
#[tauri::command]
fn get_forum_list(app: tauri::AppHandle) -> Vec<ForumMembership> {
    let forum_list = app.state::<ForumListState>();
    forum_list.0.lock().unwrap().clone()
}

/// Get unread counts for all forums
#[tauri::command]
fn get_unread_counts(app: tauri::AppHandle) -> HashMap<String, UnreadCounts> {
    let unread_state = app.state::<UnreadCountsState>();
    unread_state.0.lock().unwrap().clone()
}

/// Get the active forum domain
#[tauri::command]
fn get_active_forum(app: tauri::AppHandle) -> Option<String> {
    let active_state = app.state::<ActiveForumState>();
    active_state.0.lock().unwrap().clone()
}

/// Remove a forum from the list
#[tauri::command]
fn remove_forum(domain: String, app: tauri::AppHandle) -> Result<(), String> {
    let forum_list = app.state::<ForumListState>();
    let mut forums = forum_list.0.lock().unwrap();
    forums.retain(|f| f.domain != domain);

    let unread_state = app.state::<UnreadCountsState>();
    unread_state.0.lock().unwrap().remove(&domain);

    // If the removed forum was active, clear the active state
    let active_state = app.state::<ActiveForumState>();
    let mut active = active_state.0.lock().unwrap();
    if active.as_deref() == Some(&domain) {
        *active = None;
    }

    Ok(())
}

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_shell::init())
        .manage(CloseToTrayState(Mutex::new(true)))
        .manage(ForumListState(Mutex::new(Vec::new())))
        .manage(UnreadCountsState(Mutex::new(HashMap::new())))
        .manage(ActiveForumState(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // System tray
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let close_to_tray = app.state::<CloseToTrayState>();
                if *close_to_tray.0.lock().unwrap() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_close_to_tray,
            add_forum,
            switch_forum,
            get_forum_list,
            get_unread_counts,
            get_active_forum,
            remove_forum,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
