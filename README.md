# NitroBridge

A Vencord port of [YABDP4Nitro](https://github.com/riolubruh/YABDP4Nitro) — the feature-rich BetterDiscord Nitro plugin — rebuilt for Vencord as a custom userplugin.

> **Credit:** all feature ideas come from **YABDP4Nitro by [Riolubruh](https://github.com/riolubruh)** ([original repo](https://github.com/riolubruh/YABDP4Nitro), OSL-3.0). This port is a clean-room reimplementation: no code was copied from the original. Thank you for the amazing plugin!
>
> _"Discord" and "Nitro" are trademarks of Discord Inc. This project is not affiliated with, endorsed by, or monetarily benefiting from Discord Inc._

## What it does

Unlocks Nitro-style features without Nitro, right inside Discord (PTB + custom Vencord build):

- **Emoji bypass** — send other servers' emojis as files (full size, animated), links, or classic bare URLs
- **Stickers & soundmojis** — locked stickers go as files (animated ones become GIFs), sounds go as audio
- **Fake profiles (3y3)** — hidden-code themes, effects, frames, avatar decorations, nameplates, name styles, banners, photos, plus badges
- **Streaming** — high-quality unlocks, custom resolution/FPS/bitrate, extra frame rates up to 240, per-user sharpness slider, custom camera background, GoLive ad hiding
- **Clips** — 100MB uploads for video, audio, and any file (zip polyglot), converted locally on attach
- **Looks** — Nitro gradient themes (kept locally), app icons, extra right-click menus (GIF tools, download-all-attachments)
- **Bilingual UI** — Turkish when Discord runs Turkish, English otherwise (automatic, no setting)

![Uploading Demonstration](https://github.com/user-attachments/assets/23494137-ba02-4ada-9070-2fd80e47db0e)
![Clips Example](https://github.com/user-attachments/assets/b140c90a-4688-4e91-b696-97f01d314e5c)
![Fake Profile Themes Demonstration](https://github.com/user-attachments/assets/e86cbe19-b042-4d52-918c-d08cf86ad48f)

## Install (custom Vencord build required)

Stock Vencord cannot load outside plugins, so build it yourself (once):

```powershell
cd $HOME\Documents
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install --frozen-lockfile
pnpm build
pnpm inject   # pick Discord PTB, then restart it
```

Then install this plugin:

```powershell
Copy-Item -Recurse <this-repo>\yabdp4Nitro Vencord\src\userplugins\
cd Vencord
pnpm build
```

Restart Discord PTB (or press Ctrl+R), open Settings → Vencord → Plugins, enable **Yabdp4Nitro**.

## Notes & risks

- **Use a spare account for the risky toggles.** Clip uploads, stream unlocks, and status spoofing bend Discord's rules; descriptions in settings say which ones.
- Clips convert locally with FFmpeg.WASM (downloaded on first use from this repo's pinned build).
- Fake profile codes only render for people running this (or a compatible 3y3) plugin.
- ZipClips open with 7-Zip/WinRAR after removing the trailing `.mp4` (Explorer's built-in zip cannot open them).

## Layout

```
yabdp4Nitro/
  index.tsx     plugin entry, patches, message pipeline
  settings.tsx  grouped settings + profile-code generator
  clips.ts      clip conversion logic (pure, unit-tested)
  ffmpeg.ts     lazy FFmpeg.WASM loader
  profile.ts    3y3 encode/decode helpers
  camera.ts     custom camera background installer
  sharpen.ts    per-user stream sharpness installer
  runtime.ts    late runtime patches (lazy chunks)
  wfind.ts      webpack module lookup helpers
  ignores.ts    per-user ignore store
  lang.ts       TR/EN language helpers
  styles.css    upsell-banner hiding
```

## License

Licensed under the **Open Software License version 3.0 (OSL-3.0)** — same as the original project. See [LICENSE.md](./LICENSE.md). Derivative works stay under OSL-3.0 with attribution preserved.
