# twnty launch & discoverability checklist

What's already in the site (branch `website-growth`) vs. what only you can do.
Work top to bottom — earlier items unblock later ones.

## 0. Make downloads actually work (blocker)

The v0.1.0 release is a **draft with zero files**: the CI build failed on a Tauri
version mismatch (`tauri` crate 2.10.3 vs `@tauri-apps/api` 2.12.4). This branch pins
`@tauri-apps/api` and `@tauri-apps/cli` to 2.10.1.

1. Merge this branch to `main`.
2. The old `v0.1.0` tag points at a commit **without** the fix, so re-tag at the merge commit:
   ```bash
   gh release delete v0.1.0 --yes --cleanup-tag   # removes the empty draft + old tag
   git checkout main && git pull
   git tag v0.1.0 && git push origin v0.1.0        # triggers "Build & Release"
   ```
   **Heads-up: a successful run publishes the release publicly**: its last job runs
   `gh release edit --draft=false`.
3. Confirm the release is published and has `twnty_0.1.0_universal.dmg` and
   `twnty_0.1.0_x64-setup.exe`. The site links straight to
   `/releases/latest/download/<those names>`, so **asset names must stay the same**; when you
   bump the version, update `APP_VERSION` in `web/release.ts`, the static links in
   `web/index.html`, `web/20-20-20-rule.html`, `web/thanks.html`, and `web/public/llms*.txt`.

## 1. Code signing (biggest install-rate lever after #0)

Unsigned builds get Gatekeeper ("can't be opened") and SmartScreen ("Windows protected your PC")
warnings. The site explains the workaround, but many people still bail.

- **macOS:** Apple Developer Program ($99/yr) → Developer ID cert + notarization. Tauri supports
  it via `APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` secrets in the
  release workflow. Required for an official Homebrew cask.
- **Windows:** Azure Trusted Signing (cheapest, ~$10/mo) or an OV/EV certificate.
- After signing, remove the "First launch" warnings on the homepage + FAQ + `llms-full.txt`.

## 2. Search engines (Day 1 after deploy)

**Google Search Console** — https://search.google.com/search-console
1. Add property → **Domain** → `twnty.app` → verify with the DNS TXT record at your registrar
   (recommended; covers www + all paths, and needs no code change). Only if you choose a
   URL-prefix property instead, paste the **real** meta tag Google gives you into the `<head>` of
   `web/index.html` (the site ships no placeholder tokens).
2. Sitemaps → submit `https://twnty.app/sitemap.xml`.
3. URL Inspection → `https://twnty.app/` and `/20-20-20-rule` → **Request indexing**.
4. After a few days, check Enhancements for structured-data errors. Don't expect FAQ or star-rating
   snippets in results: Google limits FAQ rich results to authoritative gov/health sites, and app
   snippets need real ratings. The schema still helps Google and AI assistants understand the pages.

**Bing Webmaster Tools** — https://www.bing.com/webmasters (also feeds ChatGPT search, DuckDuckGo,
Copilot): "Import from Google Search Console" is one click. Submit the sitemap.

**Validate:** https://search.google.com/test/rich-results and https://validator.schema.org on both
pages; https://www.opengraph.xyz for the share card.

## 3. Vercel settings

- Make `twnty.app` the **primary** domain; `vercel.json` already 301s `twnty-eight.vercel.app`
  and `www.twnty.app` to it (confirm with `curl -I https://twnty-eight.vercel.app`).
- **Enable Web Analytics:** Vercel dashboard → Project → Analytics → Enable. The site already
  loads `/_vercel/insights/script.js` (same origin, cookieless), so the CSP needs no change.
  Page views appear right away; the custom `download` event (with an `os` property) needs a
  plan that supports custom events and is simply ignored otherwise.

## 4. GitHub repo (GitHub itself ranks for these searches)

- Settings → Website: `https://twnty.app` (currently `twnty-eight.vercel.app`).
- Topics: `20-20-20`, `eye-strain`, `break-reminder`, `eye-care`, `menubar-app`, `system-tray`,
  `tauri`, `rust`, `macos`, `windows`, `productivity`, `health`.
- Social preview: upload `web/public/og-image.png`.
- README: add a GIF of the eyes reddening + the break card at the top, and link to twnty.app.

## 5. Launch & backlinks (one per week is fine)

| Where | Notes |
|---|---|
| AlternativeTo | List as alternative to LookAway, Time Out, Stretchly, EyeLeo, BreakTimer. Highest value / lowest effort. |
| Show HN | "Show HN: twnty – tiny Tauri app whose eyes get tired as you work". Lead with the few-MB-vs-Electron angle. Post weekday ~8am PT. |
| Product Hunt | Use the OG image + a 20s GIF; schedule for 12:01am PT. |
| Reddit | r/macapps, r/opensource, r/software, r/Windows11, r/productivity, r/Ergonomics — read each sub's self-promo rules. |
| Awesome lists (PRs) | awesome-mac, serhii-londar/open-source-mac-os-apps, awesome-tauri, awesome-windows. |
| Package managers | Own Homebrew tap now (`brew install abhsin/twnty/twnty`); official cask needs signing + 75★. winget PR to microsoft/winget-pkgs; Scoop extras. |
| Download sites | MacUpdate, Softpedia, Uptodown, Open Source Mac. |
| Listicle outreach | Email authors of "best break reminder apps" posts asking to be included (vendor blogs; Windows listicles currently lack twnty). |
| dev.to / Hashnode | "Building a tiny menu-bar app with Tauri + Rust" post linking to the site. |

## 6. AI assistants / answer engines

Already done: `robots.txt` explicitly allows GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot,
Google-Extended, etc.; `/llms.txt` + `/llms-full.txt`; JSON-LD on both pages; FAQ written as
direct answers. These engines mostly cite pages that rank in Bing/Google and are mentioned on
Reddit/HN/AlternativeTo — so sections 2 and 5 are what actually gets twnty recommended.

## 7. Content roadmap (one page every few weeks)

Each targets a long-tail query from the research; add each to `sitemap.xml` and
`vite.web.config.ts` inputs.

1. `/eye-break-app-windows` — Windows is underserved in search results.
2. `/timer` — a browser 20-20-20 timer (earns links; funnels to download).
3. Changelog page per release (fresh content + release keywords).
