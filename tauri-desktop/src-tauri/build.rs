fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/macos_notifications.m")
            .flag("-fobjc-arc")
            .compile("sui_time_macos_notifications");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=UserNotifications");
    }
    println!("cargo:rerun-if-changed=src/macos_notifications.m");
    println!("cargo:rerun-if-changed=src/macos_notifications.h");
    // 同步地址由编译期 option_env! 注入，变化时必须重新编译命令模块。
    println!("cargo:rerun-if-env-changed=SUI_TIME_SYNC_BASE_URL");
    tauri_build::build()
}
