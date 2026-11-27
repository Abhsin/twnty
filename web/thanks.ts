import { EyesComponent } from "../src/eyes/eyes";
import "./common";
import { DOWNLOAD_URLS, type DownloadOS } from "./release";

function detectOS(): DownloadOS {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const hint = `${nav.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  return hint.includes("win") && !hint.includes("darwin") ? "win" : "mac";
}

// Whitelist the query value; it is only ever used to pick a constant, never as a URL.
const param = new URLSearchParams(window.location.search).get("os");
const os: DownloadOS = param === "mac" || param === "win" ? param : detectOS();
const other: DownloadOS = os === "mac" ? "win" : "mac";
const url = DOWNLOAD_URLS[os];

// Happy eyes
const eyesEl = document.getElementById("thanks-eyes");
if (eyesEl) {
  const eyes = new EyesComponent(eyesEl, {
    style: "classic",
    progress: 0,
    mood: "happy",
    autoBlink: true,
    trackCursor: true,
  });
  eyes.celebrate(2400);
}

// Show only the matching install steps, and offer the other OS.
for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-os-steps]"))) {
  el.hidden = el.dataset.osSteps !== os;
}
const dlLink = document.getElementById("dl-link") as HTMLAnchorElement | null;
if (dlLink) dlLink.href = url;

const switchP = document.getElementById("switch-os");
const switchLink = document.getElementById("switch-os-link") as HTMLAnchorElement | null;
if (switchP && switchLink) {
  switchLink.href = `/thanks?os=${other}`;
  switchLink.textContent = other === "win" ? "Get the Windows version" : "Get the macOS version";
  switchP.hidden = false;
}

// Start the download shortly after load.
const status = document.getElementById("dl-status");
window.setTimeout(() => {
  if (status) {
    status.textContent = os === "mac" ? "Your macOS download is starting." : "Your Windows download is starting.";
  }
  window.location.href = url;
}, 600);
