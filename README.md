<div align="center">

# NitroBridge

### YABDP4Nitro, rebuilt for Vencord.

[![License: OSL-3.0](https://img.shields.io/badge/License-OSL--3.0-blue.svg)](./LICENSE.md)
[![Platform: Vencord PTB](https://img.shields.io/badge/Vencord-PTB-5865F2.svg)](https://vencord.dev)
[![Discord: PTB](https://img.shields.io/badge/Discord-PTB-ED4245.svg)](https://discord.com/download)
![Languages: TR / EN](https://img.shields.io/badge/Languages-TR%20%2F%20EN-green.svg)

*Every Nitro-style trick — emojis, profiles, streams, clips — without Nitro.*

</div>

---

> ### Credit
>
> All feature ideas belong to **[YABDP4Nitro](https://github.com/riolubruh/YABDP4Nitro)** by **[Riolubruh](https://github.com/riolubruh)** (BetterDiscord, OSL-3.0), built with the author's kind permission — own repo, new name, credit given.
> This is a clean-room reimplementation for Vencord: no code was copied from the original.
>
> _"Discord" and "Nitro" are trademarks of Discord Inc. This project is not affiliated with, endorsed by, or monetarily benefiting from Discord Inc._

---

## Showcase

| | | |
|:--:|:--:|:--:|
| **Emoji bypass** — files, links, classic | **100MB Clips** — video, audio, any file | **Fake profile themes** |
| <img src="https://github.com/user-attachments/assets/23494137-ba02-4ada-9070-2fd80e47db0e" width="320"> | <img src="https://github.com/user-attachments/assets/b140c90a-4688-4e91-b696-97f01d314e5c" width="320"> | <img src="https://github.com/user-attachments/assets/e86cbe19-b042-4d52-918c-d08cf86ad48f" width="320"> |

## Features

<details open>
<summary><b>Emoji, stickers & soundmojis</b></summary>

- Other servers' emojis as **files** (full size, animated), **links**, or **classic** bare URLs
- Locked stickers arrive as files (animated ones become GIFs), sounds arrive as audio
- Links render as real emojis on your side, with empty previews hidden

<img src="https://github.com/user-attachments/assets/15df9ce9-cb2d-4ada-9070-2fd80e47db0e" width="480">

</details>

<details open>
<summary><b>Fake profiles (3y3 hidden codes)</b></summary>

- Profile **themes, effects, frames, banners, photos**, avatar decorations, nameplates, name styles
- Per-server codes, plugin **badges**, usrbg / userpfp database fallbacks
- Built-in invisible-code generator (copy → paste into bio)

</details>

<details open>
<summary><b>Streaming</b></summary>

- Quality unlocks, **custom resolution / FPS / bitrate**, frame rates up to **240**
- **Per-user sharpness slider** (right-click a stream), **custom camera background**
- GoLive ad hiding

<img src="https://github.com/user-attachments/assets/20f6f672-0b46-445d-a3cd-e198b1900" width="480">

</details>

<details open>
<summary><b>Clips — 100MB uploads</b></summary>

- **Video** files remuxed (no re-encode) + tagged as clips
- **Audio** wrapped into black-screen video clips
- **Any file** as a video-looking zip polyglot (open by removing `.mp4`)
- Converted locally at attach time with FFmpeg.WASM

</details>

<details>
<summary><b>Looks & extras</b></summary>

- Nitro gradient **themes** (kept locally so the server can't take them back), **app icons**
- Right-click extras: GIF copy/open, download-all-attachments as zip, user ignore toggles
- **Bilingual UI** — Turkish when Discord runs Turkish, English otherwise (automatic)

<img src="https://github.com/user-attachments/assets/f29582be-669f-4787-b724-974b2d41371b" width="480">

</details>

## Install

> Requires a **custom Vencord build** (stock Vencord cannot load outside plugins) + **Discord PTB**.

```powershell
# 1. Vencord (once)
cd $HOME\Documents
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install --frozen-lockfile
pnpm build
pnpm inject   # pick Discord PTB, then restart it

# 2. This plugin
Copy-Item -Recurse <this-repo>\yabdp4Nitro Vencord\src\userplugins\
cd Vencord
pnpm build
```

Restart Discord PTB (or press `Ctrl+R`), open Settings → Vencord → Plugins, enable **Yabdp4Nitro**.

## Notes & risks

- ⚠️ **Use a spare account for the risky toggles.** Clip uploads, stream unlocks, and status spoofing bend Discord's rules — risky settings say so in their descriptions.
- Clips convert locally; FFmpeg.WASM downloads on first use from a pinned build.
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
