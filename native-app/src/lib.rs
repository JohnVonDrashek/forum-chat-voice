#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

// ============================================================================
// Desktop-only State & Commands
// ============================================================================

#[cfg(desktop)]
struct CloseToTrayState(Mutex<bool>);

#[cfg(desktop)]
#[tauri::command]
fn set_close_to_tray(enabled: bool, app: tauri::AppHandle) {
    let state = app.state::<CloseToTrayState>();
    *state.0.lock().unwrap() = enabled;
}

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))
            .manage(CloseToTrayState(Mutex::new(true)))
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
            .invoke_handler(tauri::generate_handler![set_close_to_tray]);
    }

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(desktop)]
            {
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
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
