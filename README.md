# Sui Time

Sui Time is a local-first desktop to-do planner for the Chinese product "岁岁时光". It helps one person collect tasks, arrange them by week or month, and keep category labels under control.

## Desktop Architecture

```text
sui-time/
├── desktop-client/   # Vue 3 + TypeScript desktop UI
├── tauri-desktop/    # Tauri 2 + Rust + SQLite native layer
└── .github/          # macOS/Windows release and updater workflow
```

Tasks, labels, accounts, and the local session are stored in the application's SQLite database. No server or cloud account is required for the first release.

## Development

```bash
cd desktop-client
npm install

cd ../tauri-desktop
npm install
npm run tauri:dev
```

## Release Configuration

The updater workflow needs GitHub Secrets/Variables for the signing key and the dedicated OSS distribution path. See `.github/workflows/release.yml`; never place these values in the repository.

## Scope

The first release includes local login, task management, weekly/monthly planning, label management, and desktop updates. Synchronization, reminders, recurring tasks, and mobile clients are intentionally out of scope.
