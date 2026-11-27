// Single source of truth for release links. When you bump the version, update
// APP_VERSION here (and the static copies noted in docs/LAUNCH.md).
export const APP_VERSION = "0.1.0";
export const REPO_URL = "https://github.com/Abhsin/twnty";
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const MAC_URL = `${RELEASES_URL}/download/twnty_${APP_VERSION}_universal.dmg`;
export const WIN_URL = `${RELEASES_URL}/download/twnty_${APP_VERSION}_x64-setup.exe`;
export const LATEST_API = "https://api.github.com/repos/Abhsin/twnty/releases/latest";

export type DownloadOS = "mac" | "win";
export const DOWNLOAD_URLS: Record<DownloadOS, string> = { mac: MAC_URL, win: WIN_URL };
