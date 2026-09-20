/*
 * NitroBridge — Vencord port of YABDP4Nitro.
 * Copyright (c) 2026 isimsizman09
 * Inspired by YABDP4Nitro by Riolubruh (OSL-3.0, https://github.com/riolubruh/YABDP4Nitro).
 * Licensed under the Open Software License version 3.0 (OSL-3.0).
 * See LICENSE file for more information.
 */

// Yabdp4Nitro — clean-room port of BetterDiscord's YABDP4Nitro for Vencord.
// Inspired by YABDP4Nitro by Riolubruh (OSL-3.0) and Vencord's FakeNitro patterns.
// No code copied from the original. Settings live in "./settings".

import { addMessagePreEditListener, addMessagePreSendListener, removeMessagePreEditListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { SettingsStore } from "@api/Settings";
import { CloudDownloadIcon, CopyIcon, NoEntrySignIcon, OpenExternalIcon } from "@components/Icons";
import { ApngBlendOp, ApngDisposeOp, parseAPNG } from "@utils/apng";
import { copyToClipboard } from "@utils/clipboard";
import { fetchUserProfile, getCurrentGuild, sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import type { Emoji } from "@vencord/discord-types";
import { findByProps, findByPropsLazy, findLazy, proxyLazyWebpack } from "@webpack";
import { ChannelStore, ContextMenuApi, EmojiStore, FluxDispatcher, Menu, Parser, PermissionsBits, PermissionStore, PresenceStore, SoundboardStore, StickersStore, Toasts, UserProfileStore, UserSettingsActionCreators, UserSettingsProtoStore, UserStore } from "@webpack/common";
import { applyPalette, GIFEncoder, quantize } from "gifenc";

import { installCameraBg, uninstallCameraBg } from "./camera";
import { decideClip, transcodeAudio, transcodeVideo, transcodeZip } from "./clips";
import { ensureFFmpeg, unloadFFmpeg } from "./ffmpeg";
import { isIgnored, toggleIgnore } from "./ignores";
import { T } from "./lang";
import { badgesFor, bannerOf, clearRevealCache, decorOf, effectOf, extraFpsValues, frameOf, hasHiddenMark, photoOf, plateOf, styleOf, themeColorsOf } from "./profile";
import { installGoLiveUpsell, uninstallGoLiveUpsell } from "./runtime";
import { ProfileSettingsUI, settings } from "./settings";
import { ensureSharpener,getSharpen, installSharpener, setSharpen, uninstallSharpener } from "./sharpen";

// Menu header, so it's clear which plugin owns the item (like the original).
function menuLabel(text: string) {
    return (
        <span>
            <span style={{ fontSize: "11px", opacity: 0.7 }}>Yabdp4Nitro</span>
            <br />
            <span>{text}</span>
        </span>
    );
}
async function downloadAttachments(files: any[], zipName: string) {
    const items = files.filter((f: any) => typeof f?.url === "string");
    if (!items.length) {
        Toasts.show({ message: T("Ek bulunamadı", "No attachments found"), id: Toasts.genId(), type: Toasts.Type.FAILURE });
        return;
    }
    Toasts.show({ message: T("Ekler indiriliyor...", "Downloading attachments..."), id: Toasts.genId(), type: Toasts.Type.INFO });
    const settled = await Promise.allSettled(items.map(async f => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60000);
        try {
            const res = await fetch(f.url, { signal: ctrl.signal });
            if (!res.ok) throw new Error(`download failed ${res.status}`);
            const buf = new Uint8Array(await res.arrayBuffer());
            const name = cleanZipName(String(f?.filename ?? T("dosya", "file")));
            return { name, buf };
        } finally {
            clearTimeout(timer);
        }
    }));
    const zipped: Record<string, Uint8Array> = Object.create(null);
    let bad = 0;
    settled.forEach(r => {
        if (r.status !== "fulfilled") {
            bad++;
            return;
        }
        let { name } = r.value;
        if (zipped[name]) {
            const dot = name.lastIndexOf(".");
            const base = dot > 0 ? name.slice(0, dot) : name;
            const ext = dot > 0 ? name.slice(dot) : "";
            let n = 2;
            while (zipped[`${base} (${n})${ext}`]) n++;
            name = `${base} (${n})${ext}`;
        }
        zipped[name] = r.value.buf;
    });
    if (!Object.keys(zipped).length) {
        Toasts.show({ message: T("Hiçbir ek inemedi", "No attachment downloaded"), id: Toasts.genId(), type: Toasts.Type.FAILURE });
        return;
    }
    try {
        const { zipSync } = await import("fflate");
        const blob = new Blob([zipSync(zipped, { level: 6 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${zipName}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (err) {
        log.warn("zip failed", err);
        Toasts.show({ message: T("Zip oluşturulamadı", "Could not build the zip"), id: Toasts.genId(), type: Toasts.Type.FAILURE });
        return;
    }
    if (bad) {
        Toasts.show({ message: T(`${bad} ek atlandı`, `${bad} attachments skipped`), id: Toasts.genId(), type: Toasts.Type.FAILURE });
    }
}

// Sanitize zip/download names against path traversal.
function cleanZipName(raw: string) {
    return String(raw ?? "file").replace(/\.zip\.mp4$/, ".zip").replace(/\.7z\.mp4$/, ".7z").replace(/[\\/]+/g, "-").slice(0, 128) || "file";
}
import "./styles.css";

const log = new Logger("Yabdp4Nitro");

// Only Discord's own emoji CDN counts as a fake emoji.
const EMOJI_LINK_RE = /https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.(png|webp|gif|avif|jpg|jpeg)/;
const EMOJI_PREFIX = "https://cdn.discordapp.com/emojis/";
const EMOJI_MD_RE = /\[.*?\]\(https:\/\/cdn\.discordapp\.com\/emojis\/.*?\)/g;
const CUSTOM_EMOJI_RE = /(?<!\\)<a?:\w+:(\d+)>/gi;

// Clone keeping the class AND the hidden methods (Discord defines e.g.
// hasFlag as a non-enumerable own property; a plain spread drops it and
// any screen calling user.hasFlag() crashes the whole client).
function cloneWithProto<T extends object>(obj: T): T {
    try {
        const clone = Object.create(Object.getPrototypeOf(obj) ?? Object.prototype);
        for (const key of Reflect.ownKeys(obj)) {
            if (key === "__proto__") continue;
            try {
                Object.defineProperty(clone, key, Object.getOwnPropertyDescriptor(obj, key)!);
            } catch { /* skip locked slots */ }
        }
        return clone;
    } catch {
        return { ...(obj as any) } as T;
    }
}

// Compare ignoring the "&seq" suffix we append.
function normLink(url: string) {
    return url.replace(/&\d+$/, "");
}

// Emoji id from any Discord-hosted URL (direct or proxied).
function emojiIdOf(url: string | undefined): string | null {
    if (typeof url !== "string") return null;
    return url.match(/emojis\/(\d+)\./)?.[1] ?? null;
}

// All emoji link targets inside a message (suffix ignored).
function emojiHrefs(content: string): string[] {
    try {
        return content.match(EMOJI_MD_RE)?.map((l: string) => normLink(l.slice(l.indexOf("](") + 2, -1))) ?? [];
    } catch {
        return [];
    }
}

// Discord's file uploader (same pattern the voice message plugin uses).
const CloudUpload: any = findLazy(m => m?.prototype?.trackUploadFinished);

// Keep theme picks local instead of asking the server:
// without Nitro the server would just take the theme back.
const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");

function protoField(localName: string, protoClass: any) {
    const field = protoClass?.fields?.find((f: any) => f.localName === localName);
    if (!field) return;
    const getter = Object.values(field).find(v => typeof v === "function") as any;
    return getter?.();
}

const PreloadedSettingsActs = proxyLazyWebpack(() => UserSettingsActionCreators.PreloadedUserSettingsActionCreators);
const AppearanceActs = proxyLazyWebpack(() => protoField("appearance", PreloadedSettingsActs.ProtoClass));
const ClientThemeActs = proxyLazyWebpack(() => protoField("clientThemeSettings", AppearanceActs));

function canUseInChannel(channelId: string, perm: bigint) {
    const ch = ChannelStore.getChannel(channelId);
    if (!ch || ch.isPrivate?.()) return true;
    return PermissionStore.can(perm, ch);
}

function hasNitro() {
    try {
        // Only full Nitro (2) counts: Basic/Classic lack animated/external perks.
        return UserStore.getCurrentUser()?.premiumType === 2;
    } catch {
        return false;
    }
}

// Should this emoji be left alone? (unicode/blank/sprite/managed always;
// usable ones depend on the setting)
function skipEmoji(e: Emoji, channelId: string) {
    if (e.type === 0 || !e.id) return true;
    if ((e as any).useSpriteSheet || (e as any).managed) return true;
    if (!settings.store.bypassValid) return false;
    return usableHere(e, channelId);
}

// Would this emoji send normally here? If not, it needs the bypass.
function usableHere(e: Emoji, channelId: string) {
    if (e.type === 0) return true;
    if (!e.id || !e.guildId) return true;
    if (e.available === false) return false;
    // The target channel's guild counts, not the one being viewed.
    const mine = ChannelStore.getChannel(channelId)?.guild_id ?? getCurrentGuild()?.id;
    // Without Nitro only own-guild static emojis go through.
    if (!hasNitro()) return !e.animated && e.guildId === mine;
    if (e.guildId === mine) return true;
    const ch = ChannelStore.getChannel(channelId);
    if (!ch || ch.isPrivate?.()) return true;
    return PermissionStore.can(PermissionsBits.USE_EXTERNAL_EMOJIS, ch);
}

// Original URL shape: animated ones use .webp + animated=true.
function extOf(e: Emoji) {
    return e.animated ? ".webp" : settings.store.pngMode ? ".png" : ".webp";
}

function emojiUrl(e: Emoji, size: number) {
    return `${EMOJI_PREFIX}${e.id}${extOf(e)}?animated=${e.animated}&size=${size}&quality=lossless`;
}

// Match raw codes by id (still works on renamed emojis).
function rawPattern(id: string) {
    return new RegExp(`<a?:[^:<>\\s]+:${id}>`, "g");
}

function withBoundary(text: string, pos: number, len: number, insert: string) {
    const left = (!text[pos - 1] || /\s/.test(text[pos - 1])) ? "" : " ";
    const right = (!text[pos + len] || /\s/.test(text[pos + len])) ? "" : " ";
    return `${left}${insert}${right}`;
}

function isAnimatedHref(href: string, id: string) {
    if (href.includes("animated=true")) return true;
    const m = href.match(EMOJI_LINK_RE);
    if (m?.[2] === "gif") return true;
    return EmojiStore.getCustomEmojiById(id)?.animated === true;
}

function cleanFileName(name: string | undefined, ext: string) {
    const base = (name ?? "emoji").replace(/[^\w-]+/g, "").slice(0, 64) || "emoji";
    return `${base}${ext}`;
}

// Max bytes we ever pull for emoji/sticker/sound re-uploads.
const REUPLOAD_LIMIT = 8 * 1024 * 1024;

async function fetchSizedFile(url: string, filename: string, mime: RegExp, fallbackType: string) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`download failed ${res.status}`);
        const blob = await res.blob();
        if (!mime.test(blob.type)) throw new Error(`unexpected type ${blob.type}`);
        if (blob.size > REUPLOAD_LIMIT) throw new Error("file too big");
        return new File([blob], filename, { type: blob.type || fallbackType });
    } finally {
        clearTimeout(timer);
    }
}

function fetchFile(url: string, filename: string) {
    return fetchSizedFile(url, filename, /^image\//, "image/png");
}

function fetchAudioFile(url: string, filename: string) {
    return fetchSizedFile(url, filename, /^(audio\/|application\/octet-stream$)/, "audio/ogg");
}

// Turn animated (APNG) stickers into GIFs that play everywhere.
// Falls back to a static file (the caller has its own fallback).
// Repeat requests for the same URL come from cache (instant resend).
const STICKER_PREFIX = "https://media.discordapp.net/stickers/";
const STICKER_EDGE = 256; // deliberate: 256 instead of 4096 — downloads fast, stays under 8MB, sharp enough in chat
const SOUNDMOJI_RE = /<sound:\d+:\d+>/g;
const SOUND_PREFIX = "https://cdn.discordapp.com/soundboard-sounds/";
const USRBG_API = "https://usrbg.is-hardly.online/users";

interface UsrbgData {
    endpoint: string;
    bucket: string;
    prefix: string;
    users: Record<string, string>;
}

let usrbg: UsrbgData | null = null;

async function loadUsrbg() {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        const res = await fetch(USRBG_API, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return;
        usrbg = await res.json();
    } catch {
        usrbg = null;
    }
}

function usrbgUrl(userId: string | undefined): string | undefined {
    try {
        if (!userId || !usrbg?.users[userId]) return;
        const { endpoint, bucket, prefix, users } = usrbg;
        const base = (endpoint || "https://usrbg.is-hardly.online").replace(/\/$/, "");
        if (!/^https:\/\//i.test(base)) return;
        const pre = (prefix ?? "").endsWith("/") ? (prefix as string).slice(0, -1) : (prefix ?? "");
        const seg = (v: unknown) => encodeURIComponent(String(v ?? ""));
        return `${base}/${seg(bucket)}/${seg(pre)}/${seg(userId)}?${seg(users[userId])}`;
    } catch {
        return;
    }
}

// Same idea for profile photos (UserPFP database).
const USERPFP_API = "https://raw.githubusercontent.com/UserPFP/UserPFP/main/source/data.json";

let userpfp: Record<string, string> | null = null;

async function loadUserpfp() {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        const res = await fetch(USERPFP_API, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return;
        const data = await res.json();
        if (data && typeof data.avatars === "object") userpfp = data.avatars;
    } catch {
        userpfp = null;
    }
}

function userpfpUrl(userId: string | undefined): string | undefined {
    try {
        if (!userId || !userpfp) return;
        const url = userpfp[userId];
        if (typeof url !== "string" || !/^https:\/\//i.test(url)) return;
        return url;
    } catch {
        return;
    }
}

// Go-live FPS list (the array in the lazy chunk) — grabbed when patched,
// updated from settings after that (no restart needed).
let fpsListRef: number[] | null = null;
let fpsLabeledRef: any[] | null = null;
// The custom value we added (base values stay untouched).
let addedCustomFps = -1;
// The preset store, resolved once then reused.
let streamConstsRef: any = null;

// Remove a runtime-added custom FPS from the lists.
// Base values baked in at patch time (15/30/60) stay.
// Runs both on setting changes and on plugin stop.
function removeRuntimeFps() {
    try {
        const v = addedCustomFps;
        if (v <= 0) return;
        const SC = streamConstsRef;
        if (SC?.ZV && Array.isArray(SC.ZV)) {
            for (let i = SC.ZV.length - 1; i >= 0; i--) {
                if (SC.ZV[i]?.fps === v) SC.ZV.splice(i, 1);
            }
            delete SC.kn?.[`FPS_${v}`];
            delete SC.kn?.[v];
        }
        if (fpsListRef) {
            const at = fpsListRef.indexOf(v);
            if (at >= 0) fpsListRef.splice(at, 1);
        }
        if (fpsLabeledRef) {
            for (let i = fpsLabeledRef.length - 1; i >= 0; i--) {
                if (fpsLabeledRef[i]?.value === v) fpsLabeledRef.splice(i, 1);
            }
        }
    } catch { /* ignore */ }
    addedCustomFps = -1;
}

// Write the configured custom FPS into the live lists (enum + presets + menus).
function syncCustomFps() {
    try {
        if (!settings.store.streamUnlock) return;
        const c = Math.round(Number(settings.store.customFps));
        const want = Number.isFinite(c) && c >= 5 && c <= 240 ? c : -1;
        if (want === addedCustomFps) return;
        removeRuntimeFps();
        let ok = false;
        // 1) preset + enum store (main bundle, always loaded)
        try {
            if (!streamConstsRef?.ZV) {
                const found = findByProps("ZV", "kn") as any;
                if (found?.ZV && Array.isArray(found.ZV)) streamConstsRef = found;
            }
            const SC = streamConstsRef;
            if (!SC?.ZV || !Array.isArray(SC.ZV) || !SC?.kn) throw new Error("store missing");
            if (want > 0 && !SC.ZV.some((p: any) => p?.fps === want)) {
                const q = SC.ZV.find((p: any) => p?.fps === 60)?.quality;
                SC.ZV.push({ resolution: 0, fps: want, quality: q });
                for (const r of [720, 1080, 1440]) SC.ZV.push({ resolution: r, fps: want, quality: q });
                SC.kn[`FPS_${want}`] = want;
                SC.kn[want] = `FPS_${want}`;
            }
            ok = true;
        } catch (err) {
            log.warn("fps store sync failed", err);
        }
        // 2) open menu lists (if the lazy chunk loaded)
        try {
            if (fpsListRef) {
                if (want > 0 && !fpsListRef.includes(want)) fpsListRef.push(want);
            }
            if (fpsLabeledRef) {
                if (want > 0 && !fpsLabeledRef.some((o: any) => o?.value === want)) {
                    fpsLabeledRef.push({
                        value: want,
                        get label() {
                            return `${want} FPS`;
                        }
                    });
                }
            }
        } catch (err) {
            log.warn("fps menu sync failed", err);
            ok = false;
        }
        if (ok) addedCustomFps = want;
    } catch (err) {
        log.warn("fps sync skipped", err);
    }
}

// (Re)install the custom camera background from settings.
function syncCameraBg() {
    try {
        if (!settings.store.videoFilter) {
            uninstallCameraBg();
            return;
        }
        const link = String((settings.store as any).videoFilterLink ?? "").trim();
        if (!link) {
            uninstallCameraBg();
            return;
        }
        installCameraBg(link, String((settings.store as any).videoFilterType ?? "png") === "mp4");
    } catch { /* ignore */ }
}

// (Re)install the GoLive upsell hiding from settings.
function syncGoLiveUpsell() {
    try {
        installGoLiveUpsell();
    } catch { /* ignore */ }
}

// Quietly fetch profiles of people in view (so bio codes work
// without opening profiles). Skips anyone fetched in the last 5 minutes.
const fetchedAt = new Map<string, number>();

// Drop our own emoji-image previews from message data (link/bare modes).
// Runs on Flux events, before render. Only touches embeds whose image points
// at Discord's emoji CDN and is already linked in the message content.
function stripMessageEmbeds(msg: any) {
    try {
        if (!settings.store.showAsEmoji) return;
        if (!msg || !Array.isArray(msg.embeds) || !msg.embeds.length) return;
        if (typeof msg.content !== "string" || !msg.content.includes("cdn.discordapp.com/emojis/")) return;
        // Ids referenced in the text (markdown links and raw codes).
        const wanted = new Set<string>();
        for (const l of emojiHrefs(msg.content)) {
            const id = emojiIdOf(l);
            if (id) wanted.add(id);
        }
        CUSTOM_EMOJI_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CUSTOM_EMOJI_RE.exec(msg.content)) !== null) {
            if (m[1]) wanted.add(m[1]);
        }
        CUSTOM_EMOJI_RE.lastIndex = 0;
        if (!wanted.size) return;
        // Previews may come proxied (media host), so match by emoji id anywhere in the URL.
        const kept = msg.embeds.filter((e: any) => {
            const id = emojiIdOf(e?.url) ?? emojiIdOf(e?.image?.url);
            return !id || !wanted.has(id);
        });
        if (kept.length !== msg.embeds.length) msg.embeds = kept;
    } catch { /* ignore */ }
}

function fetchAuthors(ids: (string | undefined | null)[]) {
    try {
        if (!settings.store.fetchOnScroll) return;
        const me = UserStore.getCurrentUser()?.id;
        const now = Date.now();
        const want = new Set<string>();
        for (const id of ids) {
            if (!id || id === me || isIgnored(id)) continue;
            if (UserProfileStore.getUserProfile(id)) continue; // already cached
            const last = fetchedAt.get(id) ?? 0;
            if (now - last < 5 * 60 * 1000) continue;
            want.add(id);
            if (want.size >= 12) break; // don't burst on crowded opens
        }
        if (!want.size) return;
        for (const id of want) {
            fetchedAt.set(id, now);
            if (fetchedAt.size > 500) {
                const first = fetchedAt.keys().next().value;
                if (first !== undefined) fetchedAt.delete(first);
            }
            fetchUserProfile(id).catch(() => {});
        }
        } catch { /* ignore */ }
}

// Converted files (so the attach and send layers don't convert the same file twice).
let convertedFiles = new WeakSet<File>();
const gifCache = new Map<string, File>();
function gifCachePut(url: string, file: File) {
    gifCache.set(url, file);
    while (gifCache.size > 8) {
        const first = gifCache.keys().next().value;
        if (first === undefined) break;
        gifCache.delete(first);
    }
}
async function fetchStickerGif(url: string, gifName: string, pngName: string, edge: number) {
    const hit = gifCache.get(url);
    if (hit) return hit;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let parsed: { frames: any[]; width: number; height: number; };
    try {
        const head = await fetch(url, { signal: ctrl.signal, method: "HEAD" }).catch(() => undefined);
        if (Number(head?.headers.get("content-length") ?? 0) > 8 * 1024 * 1024) return fetchFile(url, pngName);
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`download failed ${res.status}`);
        const buf = await res.arrayBuffer();
        const maybe = await parseAPNG(buf).catch(() => null);
        if (!maybe || maybe.frames.length < 2 || maybe.frames.length > 120) return fetchFile(url, pngName);
        if (!maybe.width || !maybe.height || maybe.width * maybe.height > 4000000) return fetchFile(url, pngName);
        parsed = maybe;
    } finally {
        clearTimeout(timer);
    }
    const { frames, width, height } = parsed!;
    const gif = GIFEncoder();
    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const scale = edge / Math.max(width, height);
    ctx.scale(scale, scale);
    let prev: ImageData | undefined;
    for (const f of frames) {
        // Pixel read/write calls ignore the transform, so source
        // coords are converted to canvas scale (else non-256 sources corrupt).
        const sx = Math.round(f.left * scale);
        const sy = Math.round(f.top * scale);
        const sw = Math.round(f.width * scale);
        const sh = Math.round(f.height * scale);
        // Save the region first if a restore-frame is coming, skip the read otherwise.
        prev = f.disposeOp === ApngDisposeOp.PREVIOUS
            ? ctx.getImageData(sx, sy, sw, sh)
            : undefined;
        if (f.blendOp === ApngBlendOp.SOURCE) ctx.clearRect(f.left, f.top, f.width, f.height);
        ctx.drawImage(f.img, f.left, f.top, f.width, f.height);
        const { data } = ctx.getImageData(0, 0, edge, edge);
        const palette = quantize(data, 256);
        const index = applyPalette(data, palette);
        gif.writeFrame(index, edge, edge, { transparent: true, palette, delay: f.delay });
        if (f.disposeOp === ApngDisposeOp.BACKGROUND) ctx.clearRect(f.left, f.top, f.width, f.height);
        else if (f.disposeOp === ApngDisposeOp.PREVIOUS && prev) ctx.putImageData(prev, sx, sy);
    }
    gif.finish();
    const bytes = gif.bytesView() as Uint8Array<ArrayBuffer>;
    if (bytes.length > 8 * 1024 * 1024) return fetchFile(url, pngName);
    const out = new File([bytes], gifName, { type: "image/gif" });
    gifCachePut(url, out);
    return out;
}

export default definePlugin({
    name: "Yabdp4Nitro",
    description: "YABDP4Nitro port — emoji, profile, streaming (grouped settings).",
    authors: [{ name: "Port Sahibi", id: 898196216964337725n }],
    dependencies: ["MessageEventsAPI"],
    settings,
    settingsAboutComponent: ProfileSettingsUI,
    contextMenus: {
        "user-context": (children: any[], props: any) => {
            const id = props?.user?.id as string | undefined;
            if (!id) return;
            children.push(
                <Menu.MenuItem
                    id="yabdp-ignore-nitro"
                    label={menuLabel(`${T("Nitro süslerini yoksay", "Ignore nitro decorations")}${isIgnored(id, "nitro") ? T(" (açık)", " (on)") : ""}`)}
                    leadingAccessory={{ type: "icon", icon: NoEntrySignIcon }}
                    action={() => toggleIgnore(id, "nitro")}
                />,
                <Menu.MenuItem
                    id="yabdp-ignore-encoding"
                    label={menuLabel(`${T("3y3 kodlarını yoksay", "Ignore 3y3 codes")}${isIgnored(id, "encoding") ? T(" (açık)", " (on)") : ""}`)}
                    leadingAccessory={{ type: "icon", icon: NoEntrySignIcon }}
                    action={() => toggleIgnore(id, "encoding")}
                />
            );
        },
        "stream-context": (children: any[], props: any) => {
            try {
                if (!settings.store.sharpenStreams) return;
                ensureSharpener();
                const ownerId = props?.stream?.ownerId as string | undefined;
                if (!ownerId || !/^\d+$/.test(ownerId)) return;
                const ControlItem = (Menu as any)?.MenuControlItem;
                const SliderControl = (Menu as any)?.MenuSliderControl;
                if (!ControlItem || !SliderControl) return;
                children.push(
                    <ControlItem
                        id="yabdp-sharpen"
                        label={menuLabel(T("Netlik", "Sharpness"))}
                        control={(cprops: any, ref: any) => (
                            <SliderControl
                                {...cprops}
                                ref={ref}
                                minValue={0}
                                maxValue={100}
                                value={getSharpen(ownerId)}
                                onChange={(v: number) => setSharpen(ownerId, v)}
                                renderValue={(v: number) => `${Math.round(v)}`}
                            />
                        )}
                    />
                );
            } catch { /* ignore */ }
        },
        "message": (children: any[], props: any) => {
            if (!settings.store.extraMenus || !props?.message) return;
            const files = [
                ...(props.message?.attachments ?? []),
                ...(props?.message?.messageSnapshots?.[0]?.message?.attachments ?? [])
            ].filter((f: any) => typeof f?.url === "string");
            if (!files.length) return;
            children.push(
                <Menu.MenuItem
                    id="yabdp-download-all"
                    label={menuLabel(`${T("Tüm ekleri zip indir", "Download all as zip")} (${files.length})`)}
                    leadingAccessory={{ type: "icon", icon: CloudDownloadIcon }}
                    action={() => downloadAttachments(files, String(props.message?.id ?? T("ekler", "files")))}
                />
            );
        },
        "expression-picker": (children: any[], props: any) => {
            if (!settings.store.extraMenus) return;
            const t = props?.target as any;
            const src = String(t?.src ?? t?.firstChild?.src ?? "");
            if (!src) return;
            const m = src.match(/\/emojis\/(\d+)\.(png|webp|gif|avif|jpg|jpeg)/);
            let label = T("Çıkartma adresini aç", "Open sticker URL");
            let url = src;
            if (m) {
                label = T("Emoji adresini aç", "Open emoji URL");
                const e = EmojiStore.getCustomEmojiById(m[1]) as Emoji | undefined;
                if (e) {
                    url = emojiUrl(e, 4096);
                } else {
                    try {
                        const u = new URL(src);
                        u.searchParams.set("size", "4096");
                        url = u.toString();
                    } catch { /* keep as is */ }
                }
            }
            children.push(
                <Menu.MenuItem
                    id="yabdp-open-expression"
                    label={menuLabel(label)}
                    leadingAccessory={{ type: "icon", icon: OpenExternalIcon }}
                    action={() => {
                        try {
                            if (!url.startsWith("https://")) return;
                            VencordNative.native.openExternal(url);
                        } catch { /* ignore */ }
                    }}
                />
            );
        }
    },

    patches: [
        // Unlock the "external emoji" lock in the emoji picker.
        {
            find: ".GUILD_SUBSCRIPTION_UNAVAILABLE;",
            replacement: [
                {
                    match: /!\i\.available(?=\)return \i\.\i\.GUILD_SUBSCRIPTION_UNAVAILABLE;)/,
                    replace: "false"
                },
                {
                    match: /(?<=\|\|)\i\.\i\.canUseEmojisEverywhere\(\i\)/,
                    replace: "true"
                },
                {
                    match: /(?<=\|\|)\i\.\i\.canUseAnimatedEmojis\(\i\)/,
                    replace: "true"
                }
            ]
        },
        // Render outgoing links as real emojis.
        {
            find: '["strong","em","u","text","inlineCode","s","spoiler"]',
            replacement: [
                {
                    match: /1!==(\i)\.length\|\|1!==\i\.length/,
                    replace: (m, content) => `${m}||$self.shouldKeepEmojiLink(${content}[0])`
                },
                {
                    match: /(?=return{hasSpoilerEmbeds:\i,hasBailedAst:\i,content:(\i))/,
                    replace: (_, content) => `${content}=$self.transformContent(${content});`
                }
            ]
        },
        // Emoji link previews are stripped at the data layer (stripEmojiEmbeds):
        // the old render-site anchor no longer exists in current code.
        // Turn links back into emoji codes when the editor opens.
        // One registered handler covers both paths (shape verified).
        {
            find: "startEditMessage",
            predicate: () => settings.store.editEmoji,
            replacement: {
                match: /content:(\i\.content),source:/,
                replace: "content:$self.editStartContent($1),source:"
            }
        },
        // GIF picker right-click: copy URL / open in browser.
        // Shape is unique in current code (285961).
        {
            find: "renderGIF(){",
            predicate: () => settings.store.extraMenus,
            replacement: {
                match: /handleContextMenu=(\i)=>\{let\{onContextMenu:(\i),item:(\i)\}=this\.props;\2\?\.\(\i,\i\)\}/,
                replace: "handleContextMenu=$1=>{$self.gifMenu($1,$2,$3)}"
            }
        },
        // Stickers always count as sendable (unlocks the picker).
        // Find and pattern narrow to a single module in current code (361670).
        // The check runs live so the toggle needs no restart.
        {
            find: "G7:()=>_,Ux:",
            replacement: {
                match: /(function \i\(\i,\i,\i\)\{)(if\(null==\i\)return 2;)/,
                replace: (_, head, guard) => `${head}if($self.stickerUnlocked())return 0;${guard}`
            }
        },
        {
            find: 'SENDABLE_WITH_PREMIUM=1]="SENDABLE_WITH_PREMIUM"',
            replacement: {
                match: /(\i\.available)\?/,
                replace: "($self.stickerUnlocked()||$1)?"
            }
        },
        // Fake profile theme: read the hidden colors from the bio.
        {
            find: "UserProfileStore",
            replacement: {
                match: /(?<=getUserProfile\(\i\){return )(.+?)(?=})/,
                replace: "$self.themeHook($1)"
            }
        },
        // Fake banner: read the hidden Imgur code from the bio.
        // Same pattern as Vencord's working usrbg patch.
        {
            find: ':"SHOULD_LOAD");',
            predicate: () => settings.store.fakeBanners,
            replacement: {
                match: /\i(?:\?)?.getPreviewBanner\(\i,\i,\i\)(?=.{0,100}"COMPLETE")/,
                replace: "$self.bannerUrl(arguments[0])||$&"
            }
        },
        // Fake name style / avatar deco / plate: applied to user data.
        // Find narrows to one module (handleLoadCache only lives in UserStore).
        {
            find: "handleLoadCache",
            predicate: () => settings.store.displayStyles || settings.store.avatarDecos || settings.store.nameplates,
            replacement: {
                match: /getUser\((\i)\)\{if\(null!=\1\)return (\i)\[\1\]\}/,
                replace: "getUser($1){if(null!=$1)return $self.userHook($2[$1])}"
            }
        },
        // Fake profile photo: hidden Imgur code (or the userpfp database).
        // The User class module is unique in current code (verified).
        {
            find: "extractTimestamp(this.id)",
            predicate: () => settings.store.customPhotos !== false,
            replacement: {
                match: /(getAvatarURL\(\i,\i\)\{)/,
                replace: "$1const yabdpPhoto=$self.photoUrl(this.id);if(yabdpPhoto)return yabdpPhoto;"
            }
        },
        // Voice tile background from fake banners (verified shape, current code).
        {
            find: "pulseSpeakingIndicator:m",
            predicate: () => settings.store.voiceTile,
            replacement: {
                match: /userId:(\i)(,guildId:\i,pulseSpeakingIndicator:\i=!1,speaking:\i=!1,\.\.\.\i\}=\i,)(C=)(\i)(\?\?)(\i)(,)/,
                replace: "userId:$1$2$3($self.tileSrc($1)??$4)$5$6$7"
            }
        },
        // Client-side Nitro status spoof (off by default).
        {
            find: '"OverridePremiumTypeStore"',
            predicate: () => Number((settings.store as any).premiumType ?? -1) !== -1,
            replacement: {
                match: /(getPremiumTypeActual\(\)\{return )(\i\.\i+)(\})/,
                replace: "$1($self.premiumType()??$2)$3"
            }
        },
        // Force the GoLive video codec (off by default, matched by name not index).
        {
            find: "videoDecoders",
            predicate: () => Number(settings.store.videoCodec) >= 0,
            replacement: {
                match: /return\{videoEncoder:(\i),videoDecoders:(\i),(audioEncoder:\i,audioDecoders:\i)\}/,
                replace: "return{videoEncoder:$self.pickEncoder($1,$2),videoDecoders:$2,$3}"
            }
        },
        // Broad Nitro-feature gate (emoji/soundboard/icons/themes).
        {
            find: "product_catalog_can_user_use",
            replacement: {
                match: /(function \i\(\i,\i,\i\)\{)(if\(null!=\i&&\i\.isPremiumWithFractionalPremiumOnly\(\)&&)/,
                replace: "$1if($self.featureUnlocked(arguments[0]))return true;$2"
            }
        },
        // Unlock streaming + high-quality video uploads.
        {
            find: "canUseCustomStickersEverywhere:",
            replacement: [
                {
                    match: /(?<=canUseHighVideoUploadQuality:function\(\i\)\{)/,
                    replace: "return true;",
                    predicate: () => settings.store.streamUnlock
                },
                {
                    match: /(?<=canStreamQuality:function\(\i,\i\)\{)/,
                    replace: "return true;",
                    predicate: () => settings.store.streamUnlock
                },
                {
                    match: /(?<=canUseClientThemes:function\(\i\)\{)/,
                    replace: "return true;",
                    predicate: () => settings.store.clientThemes
                },
                {
                    match: /(?<=canUsePremiumAppIcons:function\(\i\)\{)/,
                    replace: "return true;",
                    predicate: () => settings.store.appIcons
                }
            ]
        },
        // Drop the server-boost requirement from stream FPS options.
        {
            find: "#{intl::STREAM_FPS_OPTION}",
            predicate: () => settings.store.streamUnlock,
            replacement: {
                match: /guildPremiumTier:\i\.\i\.TIER_\d,?/g,
                replace: ""
            }
        },
        // Add high values to the FPS list (90-240). Patterns are unique in current code (753070).
        {
            find: "Unknown frame rate: ",
            predicate: () => settings.store.streamUnlock,
            replacement: [
                {
                    match: /(\i)\[(\i)\.FPS_60=60\]="FPS_60"/,
                    replace: (m: string, o: string, e: string) =>
                        m + extraFpsValues(settings.store.customFps).map(v => `,${o}[${e}.FPS_${v}=${v}]="FPS_${v}"`).join("")
                },
                {
                    // Unknown values pass through instead of throwing
                    // (the engine still clamps out-of-range ones; see applyBitrates).
                    // The whole throw call is consumed so no fragment is left behind.
                    match: /return 60;default:throw Error\(`Unknown frame rate: \$\{\i\}`\)/,
                    replace: (m: string) =>
                        "return 60;" + extraFpsValues(settings.store.customFps).map(v => `case ${v}:return ${v};`).join("") + "default:return e;"
                },
                {
                    match: /(\{resolution:0,fps:60,quality:)(\i\.\i+\.\i+)(\})/,
                    replace: (m: string, pre: string, q: string, post: string) => {
                        const more: string[] = [];
                        for (const v of extraFpsValues(settings.store.customFps)) {
                            more.push(`{resolution:0,fps:${v},quality:${q}}`);
                            for (const r of [720, 1080, 1440]) more.push(`{resolution:${r},fps:${v},quality:${q}}`);
                        }
                        return pre + q + post + "," + more.join(",");
                    }
                },
                {
                    match: /(\i\(15\),(\i)\(30\),\2\(60\))(;)/,
                    replace: (m: string, head: string, h: string, semi: string) =>
                        head + extraFpsValues(settings.store.customFps).map(v => `,${h}(${v})`).join("") + semi
                },
                {
                    // The labeled list reference is kept (the floating preview reads it),
                    // wrapped with the static entries + the custom value.
                    // Note: the expression ends with `]`, no semicolon.
                    match: /(let (\i)=)(\[h\(15[\s\S]+?\{value:60\}\)\)\])/,
                    replace: (m: string, head: string, v: string, inner: string) => {
                        const tpl = inner.match(/([A-Za-z_$][\w$]*)\(60,\(\)=>[\s\S]*?\{value:60\}\)\)/);
                        if (!tpl) return m;
                        const add = [60, ...extraFpsValues(settings.store.customFps)]
                            .map(n => tpl[0].split("60").join(String(n))).join(",");
                        // Drop the leading "[" (the wrapper adds it); the trailing "]" stays out of the slice.
                        const items = inner.slice(1, inner.indexOf(tpl[0])) + add;
                        return `${head}$self.trackPList([${items}])`;
                    }
                }
            ]
        },
        // Add high values to the stream window's frame-rate list.
        // Pattern is unique in the lazy stream chunk (verified against the user's chunk).
        {
            find: "stream-option-frame-rate-",
            predicate: () => settings.store.streamUnlock,
            replacement: {
                match: /\[(\i\.\i+)\.FPS_15,(\i\.\i+)\.FPS_30,(\i\.\i+)\.FPS_60\]/,
                replace: (m: string, p1: string, p2: string, p3: string) =>
                    `$self.trackFpsList([${p1}.FPS_15,${p2}.FPS_30,${p3}.FPS_60` + extraFpsValues(settings.store.customFps).map(v => `,${p3}.FPS_${v}`).join("") + "])"
            }
        },
        // Anything can stream (validator gate opened, single PRESET_AUTO-anchored match).
        {
            find: "canStreamWithSettings",
            predicate: () => settings.store.streamUnlock,
            replacement: {
                match: /(function \i\(\i,\i,\i,\i,\i,\i\)\{)if\(\i===\i\.\i+\.PRESET_AUTO\)return[^;]+;/,
                replace: "$1return true;"
            }
        },
        // Apply custom bitrates to the stream/voice connection.
        // Find narrows to one module (videoQualityManager=new only exists in 904986).
        // The call goes INSIDE the method (a class body would break syntax).
        {
            find: "videoQualityManager=new",
            predicate: () => settings.store.streamUnlock,
            replacement: {
                match: /updateVideoQuality\(\i\)\{/,
                replace: "$&$self.applyBitrates(this);"
            }
        },
        // Clip locks: toggles + size limit + upload hook.
        // Patterns verified against current code (734066, 915725, 158045, 148494).
        {
            find: "useEnableClips",
            predicate: () => settings.store.useClipBypass || settings.store.useAudioClipBypass || settings.store.zipClip,
            replacement: {
                match: /(\{enableClips:\i\}=\i\.getConfig\(\{location:"areClipsEnabled"\}\);return )\i\|\|\i(\})/,
                replace: "$1true$2"
            }
        },
        {
            find: "?.clipsEnabled??",
            predicate: () => settings.store.useClipBypass || settings.store.useAudioClipBypass || settings.store.zipClip,
            replacement: [
                {
                    match: /(isClipsEnabledForUser\(\i\)\{)return \i\[\i\]\?\.clipsEnabled\?\?!1(\})/,
                    replace: "$1return true$2"
                },
                {
                    match: /(isVoiceRecordingAllowedForUse(r)?\(\i\)\{)return \i\[\i\]\?\.allowVoiceRecording\?\?!1(\})/,
                    replace: "$1return true$3"
                }
            ]
        },
        {
            find: ":S.TbF}",
            predicate: () => settings.store.useClipBypass || settings.store.useAudioClipBypass || settings.store.zipClip,
            replacement: {
                match: /:S\.TbF\}/,
                replace: ":Math.max(104857600,S.TbF)}"
            }
        },
        // GoLive upsell box is handled at runtime (see runtime.ts):
        // a static patch would also match the locale bundle and warn.
        // Clip conversion happens at ATTACH time (like the original).
        // Reason: Discord asks the server for upload permission as soon as a file
        // is attached; converting at send time is too late and the server
        // rejects the clip as unknown (413).
        {
            find: "popFirstFile",
            predicate: () => settings.store.useClipBypass || settings.store.useAudioClipBypass || settings.store.zipClip,
            replacement: [
                {
                    match: /addFiles\((\i)\)\{/,
                    replace: "async addFiles($1){await $self.attachConvertAll($1);"
                },
                {
                    match: /addFile\((\i)\)\{/,
                    replace: "async addFile($1){await $self.attachConvertOne($1);"
                }
            ]
        },
        {
            find: "async _sendMessage",
            predicate: () => settings.store.useClipBypass || settings.store.useAudioClipBypass || settings.store.zipClip,
            replacement: {
                match: /(\{channelId:\i,nonce:\i,items:)(\i)(,message:)/,
                replace: "$1(await $self.processUploads($2)??$2)$3"
            }
        },
        // Apply the colored theme pick to the local screen only, not the server.
        // Otherwise the server takes the theme back when there's no Nitro.
        {
            find: ",updateTheme(",
            predicate: () => settings.store.clientThemes,
            replacement: {
                match: /(function \i\(\i\){let{backgroundGradientPresetId:(\i).+?)(\i\.\i\.updateAsync.+?theme=(.+?),.+?},\i\))/,
                replace: (m, rest, presetId, originalCall, theme) => {
                    if (!rest || !presetId || !originalCall || !theme) return m;
                    return `${rest}$self.useLocalGradient(${presetId},${theme},()=>${originalCall});`;
                }
            }
        },
        // Keep server-pushed settings from stomping the local theme pick.
        {
            find: '"UserSettingsProtoStore"',
            predicate: () => settings.store.clientThemes,
            replacement: [
                {
                    match: /(?<=CONNECTION_OPEN:function\((\i)\){)/,
                    replace: (_, props) => `$self.keepLocalTheme(${props}.userSettingsProto,${props}.user);`
                },
                {
                    match: /let\{settings:\{proto:/,
                    replace: "arguments[0].local||$self.keepLocalTheme(arguments[0].settings.proto);$&"
                }
            ]
        }
    ],

    shouldKeepEmojiLink(link: any) {
        if (!settings.store.showAsEmoji) return false;
        try {
            return !!link?.target && EMOJI_LINK_RE.test(link.target);
        } catch {
            return false;
        }
    },

    editStartContent(content: string) {
        try {
            if (typeof content !== "string") return content;
            return content.replace(EMOJI_MD_RE, (link: string) => {
                const href = link.slice(link.indexOf("](") + 2, -1);
                const m = href.match(EMOJI_LINK_RE);
                if (!m) return link;
                const e = EmojiStore.getCustomEmojiById(m[1]) as Emoji | undefined;
                if (!e) return link;
                return `<${e.animated ? "a" : ""}:${e.originalName || e.name}:${e.id}>`;
            });
        } catch {
            return content;
        }
    },

    gifMenu(event: any, orig: any, item: any) {
        try {
            let url = item?.url ?? item?.src ?? "";
            if (url.startsWith("//")) url = "https:" + url;
            if (!url) {
                orig?.(event, item);
                return;
            }
            ContextMenuApi.openContextMenu(event, () => (
                <Menu.Menu
                    navId="yabdp-gif"
                    onClose={ContextMenuApi.closeContextMenu}
                    aria-label={T("GIF işlemleri", "GIF actions")}
                >
                    <Menu.MenuItem
                        id="yabdp-gif-copy"
                        label={menuLabel(T("GIF adresini kopyala", "Copy GIF URL"))}
                        leadingAccessory={{ type: "icon", icon: CopyIcon }}
                        action={() => copyToClipboard(url)}
                    />
                    <Menu.MenuItem
                        id="yabdp-gif-open"
                        label={menuLabel(T("GIF'i tarayıcıda aç", "Open GIF in browser"))}
                        leadingAccessory={{ type: "icon", icon: OpenExternalIcon }}
                        action={() => {
                            try {
                                if (!url.startsWith("https://")) return;
                                VencordNative.native.openExternal(url);
                            } catch { /* ignore */ }
                        }}
                    />
                </Menu.Menu>
            ));
        } catch {
            orig?.(event, item);
        }
    },

    transformContent(content: any[]) {
        if (!settings.store.showAsEmoji) return content;
        // Jumbo when the message is nothing but our emojis and whitespace.
        let jumboable = content.length === 1;
        if (!jumboable) {
            jumboable = content.length > 0 && content.every((n: any) => {
                try {
                    const href = n?.props?.href;
                    if (typeof href === "string" && EMOJI_LINK_RE.test(href)) return true;
                    const kids = n?.props?.children ?? (n as any)?.content;
                    if (typeof kids === "string") return /^\s*$/.test(kids);
                    if (typeof n === "string") return /^\s*$/.test(n);
                    return false;
                } catch {
                    return false;
                }
            });
        }
        const out: any[] = [];
        for (const node of content) {
            try {
                const href = node?.props?.href;
                const m = typeof href === "string" && href.match(EMOJI_LINK_RE);
                if (m) {
                    const id = m[1];
                    const name = EmojiStore.getCustomEmojiById(id)?.name ?? "emoji";
                    out.push(Parser.defaultRules.customEmoji.react({
                        jumboable,
                        animated: isAnimatedHref(href, id),
                        emojiId: id,
                        name,
                        fake: true
                    }, undefined, { key: out.length }));
                    continue;
                }
            } catch (err) {
                log.warn("emoji render skipped", err);
            }
            out.push(node);
        }
        return out;
    },

    preSend: null as any,
    preEdit: null as any,

    applyBitrates(conn: any) {
        try {
            const s = settings.store;
            if (!s.streamUnlock) return;
            // Clamp numbers into a safe range (-1 = let Discord decide, 0 counts as auto too).
            const clamp = (v: unknown, max: number) => {
                const n = Number(v);
                if (!Number.isFinite(n) || n <= 0) return -1;
                return Math.min(n, max);
            };
            const voice = clamp(s.voiceBitrate, 512);
            if (voice >= 0 && typeof conn.setVoiceBitRate === "function")
                conn.setVoiceBitRate(voice * 1000);
            const vqm = conn.videoQualityManager;
            if (!vqm) return;
            // Merge into one call (separate calls can stomp each other).
            const golive: any = {};
            let apply = false;
            if (s.customBitrate) {
                const maxB = clamp(s.maxBitrate, 100000);
                const minB = clamp(s.minBitrate, 100000);
                const targetB = clamp(s.targetBitrate, 100000);
                golive.bitrateMax = maxB > 0 ? maxB * 1000 : null;
                golive.bitrateMin = minB >= 0 ? minB * 1000 : null;
                golive.bitrateTarget = targetB >= 0 ? targetB * 1000 : null;
                if (vqm.options) vqm.options.videoBitrateFloor = minB > 0 ? minB * 1000 : 150000;
                apply = true;
            }
            // Custom resolution/FPS (both off by default, -1 = leave alone; assumes landscape).
            const resRaw = Number(s.customRes);
            const fpsRaw = Number(s.customFps);
            const res = Number.isFinite(resRaw) && resRaw >= 144 && resRaw <= 2160 ? Math.round(resRaw) : -1;
            const fps = Number.isFinite(fpsRaw) && fpsRaw >= 5 && fpsRaw <= 240 ? Math.round(fpsRaw) : -1;
            if (res > 0 || fps > 0) {
                const shot: any = {};
                if (res > 0) {
                    const w = Math.round((res * 16) / 9 / 2) * 2; // even numbers (encoder requirement)
                    shot.width = w;
                    shot.height = res;
                    shot.pixelCount = w * res;
                }
                if (fps > 0) shot.framerate = fps;
                golive.capture = { ...shot };
                golive.encode = { ...shot };
                apply = true;
            }
            if (apply && typeof vqm.setGoliveQuality === "function") vqm.setGoliveQuality(golive);
            if (apply && conn.context === "default" && typeof vqm.setQualityOverwrite === "function")
                vqm.setQualityOverwrite({ ...golive });
        } catch (err) {
            log.warn("bitrate apply failed", err);
        }
    },

    // Conversion that runs when files get attached (so the clip is ready before send).
    // Input: Discord's file wrappers {file, ...}, replaced in place.
    clipOpts() {
        const s = settings.store;
        return {
            video: s.useClipBypass,
            forceClip: s.forceClip,
            audio: s.useAudioClipBypass,
            forceAudio: s.forceAudioClip,
            zip: s.zipClip
        };
    },

    clipStamp() {
        return Number((settings.store as any).clipTimestamp ?? 2);
    },

    async transcodeAs(job: string, ff: any, file: File, me: string, stamp: number) {
        return job === "video"
            ? transcodeVideo(ff, file, me, stamp)
            : job === "audio"
                ? transcodeAudio(ff, file, me, stamp)
                : transcodeZip(ff, file, me, stamp);
    },

    async loadClipFFmpeg() {
        Toasts.show({
            message: T("Klip dönüştürücü yükleniyor...", "Loading the clip converter..."),
            id: Toasts.genId(),
            type: Toasts.Type.INFO
        });
        return ensureFFmpeg();
    },

    async clipConvertWrappers(wrappers: any[]) {
        try {
            const s = settings.store;
            if (!s.useClipBypass && !s.useAudioClipBypass && !s.zipClip) return;
            const list = Array.isArray(wrappers) ? wrappers : [];
            if (!list.length) return;
            const opts = this.clipOpts();
            const stamp = this.clipStamp();
            const jobs: { w: any; file: File; job: string }[] = [];
            for (const w of list) {
                try {
                    const file = w?.file;
                    if (!(file instanceof File)) continue;
                    if (w?.clip || convertedFiles.has(file)) continue; // already converted
                    const job = decideClip(
                        { name: file.name, size: file.size, type: file.type },
                        opts
                    );
                    if (job !== "skip") jobs.push({ w, file, job });
                } catch { /* try the next file */ }
            }
            if (!jobs.length) return;
            const me = UserStore.getCurrentUser()?.id ?? "";
            let ff: any;
            try {
                ff = await this.loadClipFFmpeg();
            } catch (err) {
                log.warn("converter failed to load, sending normally", err);
                return;
            }
            for (const j of jobs) {
                try {
                    const out = await this.transcodeAs(j.job, ff, j.file, me, stamp);
                    j.w.file = out.file;
                    j.w.clip = out.clip;
                    convertedFiles.add(out.file);
                } catch (err) {
                    log.warn("clip skipped, sending normally", err);
                }
            }
        } catch (err) {
            log.warn("clip pipeline skipped", err);
        }
    },

    // Multi-add path (file picker, drag-and-drop).
    async attachConvertAll(arg: any) {
        try {
            await this.clipConvertWrappers(arg?.files);
        } catch (err) {
            log.warn("attach conversion failed", err);
        }
    },

    // Single-add path.
    async attachConvertOne(arg: any) {
        try {
            const w = arg?.file;
            if (w) await this.clipConvertWrappers([w]);
        } catch (err) {
            log.warn("attach conversion failed", err);
        }
    },

    async processUploads(uploads: any[]) {
        try {
            const s = settings.store;
            if (!s.useClipBypass && !s.useAudioClipBypass && !s.zipClip) return uploads;
            const list = Array.isArray(uploads) ? uploads : [];
            if (!list.length) return uploads;
            const opts = this.clipOpts();
            const stamp = this.clipStamp();
            const needed = list.some(up => {
                const file = up?.item?.file;
                if (!(file instanceof File)) return false;
                if (up?.clip || up?.item?.clip || convertedFiles.has(file)) return false;
                return decideClip({ name: file.name, size: file.size, type: file.type }, opts) !== "skip";
            });
            if (!needed) return uploads;
            const me = UserStore.getCurrentUser()?.id ?? "";
            let ff: any;
            try {
                ff = await this.loadClipFFmpeg();
            } catch (err) {
                log.warn("converter failed to load, sending normally", err);
                return uploads;
            }
            for (const up of list) {
                try {
                    const file = up?.item?.file;
                    if (!(file instanceof File)) continue;
                    if (up?.clip || up?.item?.clip || convertedFiles.has(file)) continue; // converted at attach time
                    const job = decideClip(
                        { name: file.name, size: file.size, type: file.type },
                        opts
                    );
                    if (job === "skip") continue;
                    const out = await this.transcodeAs(job, ff, file, me, stamp);
                    up.item.file = out.file;
                    up.item.clip = out.clip;
                    convertedFiles.add(out.file);
                    try {
                        up.filename = out.file.name;
                    } catch { /* ignore */ }
                    try {
                        up.clip = out.clip;
                    } catch { /* ignore */ }
                } catch (err) {
                    log.warn("clip skipped, sending normally", err);
                }
            }
        } catch (err) {
            log.warn("clip pipeline skipped", err);
        }
        return uploads;
    },

    keepLocalTheme(proto: any, user?: any) {
        try {
            if (proto == null || typeof proto === "string") return;
            const premium = user?.premium_type ?? UserStore?.getCurrentUser()?.premiumType ?? 0;
            if (premium === 2) return;
            proto.appearance ??= AppearanceActs.create();
            const saved = UserSettingsProtoStore.settings.appearance;
            proto.appearance = AppearanceActs.create({
                ...proto.appearance,
                theme: saved?.theme,
                clientThemeSettings: saved?.clientThemeSettings
            });
            // The background store empties on restart; restore the saved preset if there is one.
            const preset = saved?.clientThemeSettings?.backgroundGradientPresetId?.value;
            if (preset != null) {
                FluxDispatcher.dispatch({ type: "UPDATE_BACKGROUND_GRADIENT_PRESET", presetId: preset });
            }
        } catch (err) {
            log.warn("theme keep failed", err);
        }
    },

    useLocalGradient(presetId: number | undefined, theme: number, original: () => void) {
        try {
            const premium = UserStore?.getCurrentUser()?.premiumType ?? 0;
            if (premium === 2 || presetId == null) return original();
            if (!PreloadedSettingsActs || !AppearanceActs || !ClientThemeActs || !BINARY_READ_OPTIONS) return original();
            const current = PreloadedSettingsActs.getCurrentValue().appearance;
            const fresh = current != null
                ? AppearanceActs.fromBinary(AppearanceActs.toBinary(current), BINARY_READ_OPTIONS)
                : AppearanceActs.create();
            fresh.theme = theme;
            const dummy = ClientThemeActs.create({ backgroundGradientPresetId: { value: presetId } });
            fresh.clientThemeSettings ??= dummy;
            fresh.clientThemeSettings.backgroundGradientPresetId = dummy.backgroundGradientPresetId;
            const proto = PreloadedSettingsActs.ProtoClass.create();
            proto.appearance = fresh;
            FluxDispatcher.dispatch({
                type: "USER_SETTINGS_PROTO_UPDATE",
                local: true,
                partial: true,
                settings: { type: 1, proto }
            });
            // Notify the gradient background store (otherwise the theme looks washed out).
            if (presetId != null) {
                FluxDispatcher.dispatch({ type: "UPDATE_BACKGROUND_GRADIENT_PRESET", presetId });
            }
        } catch (err) {
            log.warn("theme apply failed", err);
        }
    },

    bannerUrl(arg: any) {
        try {
            const displayProfile = arg?.displayProfile;
            if (!displayProfile || !settings.store.fakeBanners) return;
            if (displayProfile?.banner) return; // real banner wins, don't touch
            const bio = UserProfileStore.getUserProfile(displayProfile?.userId)?.bio as string | undefined;
            const code = bannerOf(bio);
            if (code) return code;
            if (settings.store.userBg) return usrbgUrl(displayProfile?.userId);
            return;
        } catch {
            return;
        }
    },

    tileSrc(userId: string | undefined): string | undefined {
        try {
            if (!userId || !settings.store.voiceTile) return;
            if (isIgnored(userId, "encoding")) return;
            const bio = UserProfileStore.getUserProfile(userId)?.bio as string | undefined;
            const code = bannerOf(bio);
            if (code) return code;
            if (settings.store.userBg) return usrbgUrl(userId);
            return;
        } catch {
            return;
        }
    },

    trackFpsList(arr: any) {
        try {
            if (Array.isArray(arr)) fpsListRef = arr;
        } catch { /* ignore */ }
        return arr;
    },

    stickerUnlocked() {
        try {
            return !!(settings.store.stickerBypass || (settings.store as any).forceStickers);
        } catch {
            return false;
        }
    },

    photoUrl(userId: string | undefined): string | undefined {
        try {
            if (!userId || settings.store.customPhotos === false) return;
            if (isIgnored(userId, "encoding")) return;
            const bio = UserProfileStore.getUserProfile(userId)?.bio as string | undefined;
            const fromBio = photoOf(bio);
            if (fromBio) return fromBio;
            try {
                const status = (PresenceStore as any)?.getActivities?.(userId)?.find?.(
                    (a: any) => a?.name === "Custom Status" || a?.id === "custom"
                )?.state as string | undefined;
                const fromStatus = photoOf(status);
                if (fromStatus) return fromStatus;
            } catch { /* ignore */ }
            if (settings.store.userPfp !== false) return userpfpUrl(userId);
            return;
        } catch {
            return;
        }
    },

    premiumType(): number | undefined {
        try {
            const v = Number((settings.store as any).premiumType ?? -1);
            return v === -1 ? undefined : v;
        } catch {
            return;
        }
    },

    pickEncoder(current: any, decoders: any[]) {
        try {
            const idx = Number((settings.store as any).videoCodec ?? -1);
            if (idx < 0 || !Array.isArray(decoders)) return current;
            const names = ["av1", "h265", "h264", "vp8"];
            const want = names[idx];
            const byName = want && decoders.find((d: any) => String(d?.name ?? "").toLowerCase().includes(want));
            return byName ?? decoders[idx] ?? current;
        } catch {
            return current;
        }
    },

    featureUnlocked(feature: any) {
        try {
            const map: Record<string, string> = {
                emojisEverywhere: "emojiBypass",
                animatedEmojis: "emojiBypass",
                appIcons: "appIcons",
                clientThemes: "clientThemes",
                soundboardEverywhere: "soundmoji"
            };
            const key = map[String(feature?.name ?? "")];
            if (!key) return false;
            return !!(settings.store as any)[key];
        } catch {
            return false;
        }
    },

    trackPList(arr: any) {
        try {
            if (Array.isArray(arr)) fpsLabeledRef = arr;
        } catch { /* ignore */ }
        return arr;
    },

    themeHook(profile: any) {
        try {
            if (!profile) return profile;
            const s = settings.store;
            // Ignored user: hide real Nitro decor on them, don't read codes.
            if (profile.userId && isIgnored(profile.userId, "nitro")) {
                const out = cloneWithProto(profile);
                out.collectibles = undefined;
                out.profileEffect = undefined;
                out.profileFrame = undefined;
                out.themeColors = undefined;
                out.premiumType = 0;
                return out;
            }
            const encodingOff = !profile.userId || isIgnored(profile.userId, "encoding");
            // Effect hiding works without any bio (like the original).
            if (s.hideAllEffects && profile.profileEffect) {
                profile = cloneWithProto(profile);
                profile.profileEffect = {};
            }
            if (!s.fakeThemes && !s.showBadges && !s.profileEffects && !s.profileFrames && !(s.profileV2 && !encodingOff)) return profile;

            const bio = profile.bio as string | undefined;
            let out = profile;
            const touch = () => {
                if (out === profile) out = cloneWithProto(profile);
            };
            // Forcing the new layout needs code reading on (like the original).
            // Deliberate difference: the original writes unconditionally, we only
            // fill in blanks to protect real Nitro (same visible result).
            if (!encodingOff && s.profileV2 && !out.premiumType) {
                touch();
                out.premiumType = 2;
            }
            const marked = !!bio && hasHiddenMark(bio);
            if (!marked) return out;
            if (s.fakeThemes && !encodingOff) {
                if (!out.premiumType) {
                    touch();
                    out.premiumType = 2;
                }
                const colors = themeColorsOf(bio);
                if (colors) {
                    touch();
                    out.themeColors = colors;
                }
            }
            if (s.profileEffects && !encodingOff) {
                const sku = effectOf(bio);
                if (sku) {
                    touch();
                    out.profileEffect = { skuId: sku, expiresAt: undefined };
                }
            }
            if (s.profileFrames && !encodingOff) {
                const sku = frameOf(bio);
                if (sku) {
                    touch();
                    out.profileFrame = { skuId: sku, expiresAt: undefined };
                }
            }
            if (s.showBadges && out.userId) {
                const cur = out.badges;
                const has = cur && Object.values(cur).some((b: any) => b?.id?.startsWith?.("yabdp"));
                if (!has) {
                    const extra = badgesFor(out.userId, marked);
                    if (extra.length) {
                        touch();
                        out.badges = [...Object.values(cur ?? {}), ...extra];
                    }
                }
            }
            return out;
        } catch (err) {
            log.warn("theme patch skipped", err);
        }
        return profile;
    },

    userHook(user: any) {
        try {
            if (!user || !user.id) return user;
            // Ignored user: hide real Nitro decor on them, don't read codes.
            if (isIgnored(user.id, "nitro")) {
                const out = cloneWithProto(user);
                out.displayNameStyles = { colors: [] };
                out.avatarDecorationData = {};
                out.avatarDecoration = {};
                out.collectibles = {};
                return out;
            }
            if (isIgnored(user.id, "encoding")) return user;
            const s = settings.store;
            if (!s.displayStyles && !s.avatarDecos && !s.nameplates) return user;
            const bio = UserProfileStore.getUserProfile(user.id)?.bio as string | undefined;
            if (!bio || !hasHiddenMark(bio)) return user;

            let out = user;
            const touch = () => {
                if (out === user) out = cloneWithProto(user);
            };
            if (s.displayStyles) {
                const st = styleOf(bio);
                if (st) {
                    touch();
                    out.displayNameStyles = { fontId: st.fontId, effectId: st.effectId, colors: st.colors };
                }
            }
            if (s.avatarDecos) {
                const sku = decorOf(bio);
                if (sku) {
                    touch();
                    out.avatarDecorationData = { skuId: sku };
                }
            }
            if (s.nameplates) {
                const m = plateOf(bio);
                if (m) {
                    touch();
                    out.collectibles = { ...(out.collectibles ?? {}) };
                    out.collectibles.nameplate = { skuId: m[0], palette: m[1] };
                }
            }
            return out;
        } catch (err) {
            log.warn("user patch skipped", err);
        }
        return user;
    },

    start() {
        if (settings.store.userBg) void loadUsrbg();
        if (settings.store.userPfp !== false) void loadUserpfp();
        if (settings.store.appIcons) {
            try {
                FluxDispatcher.dispatch({ type: "APP_ICON_UPDATED", id: settings.store.appIcon });
            } catch { /* ignore */ }
        }
        syncCustomFps();
        syncCameraBg();
        if (settings.store.sharpenStreams) installSharpener();
        installGoLiveUpsell();
        // The settings window never calls the defined onChange, so listen to the store directly.
        try {
            SettingsStore.addChangeListener("plugins.Yabdp4Nitro.customFps", syncCustomFps);
            SettingsStore.addChangeListener("plugins.Yabdp4Nitro.videoFilter", syncCameraBg);
            SettingsStore.addChangeListener("plugins.Yabdp4Nitro.videoFilterLink", syncCameraBg);
            SettingsStore.addChangeListener("plugins.Yabdp4Nitro.videoFilterType", syncCameraBg);
            SettingsStore.addChangeListener("plugins.Yabdp4Nitro.streamUnlock", syncGoLiveUpsell);
        } catch { /* ignore */ }
        FluxDispatcher.subscribe("MESSAGE_CREATE", this.handleNewMessage);
        FluxDispatcher.subscribe("LOAD_MESSAGES_SUCCESS", this.handleLoadedMessages);
        FluxDispatcher.subscribe("MESSAGE_UPDATE", this.handleUpdatedMessage);
        if (!settings.store.emojiBypass && !settings.store.stickerBypass && !settings.store.soundmoji) return;

        this.preSend = addMessagePreSendListener(async (channelId, msg, options) => {
            // On unexpected errors restore the original message and send normally (never lose a message).
            const origContent = msg.content;
            const origStickers = (options as any)?.stickerIds;
            try {
            const size = settings.store.emojiSize;
            const uploadMode = settings.store.bypassType === "upload";
            const canAttach = canUseInChannel(channelId, PermissionsBits.ATTACH_FILES);
            // Stickers go as files in both modes (like the original).
            // No file permission -> link fallback. Unknown stickers never stay
            // in the list (the server would reject them with a Clyde error).
            const stickerJobs: { url: string; filename: string; label: string; gifName?: string }[] = [];
            const stickerLinks: string[] = [];
            const sids = (options as any)?.stickerIds as string[] | undefined;
            // Nitro users send everything normally, leave them alone.
            // Free Discord stickers (packs) and own-server stickers go normally too.
            // Only genuinely locked ones get file-ified.
            const nitro = hasNitro();
            if (settings.store.stickerBypass && !nitro && sids?.length) {
                const here = ChannelStore.getChannel(channelId)?.guild_id ?? getCurrentGuild()?.id;
                for (const sid of [...sids]) {
                    if (!/^\d+$/.test(sid)) continue;
                    const st = StickersStore.getStickerById(sid) as any;
                    if (st && "pack_id" in st) continue; // free sticker: goes normally
                    // Animated json stickers can't be file-ified: link them (left in the list, the server rejects).
                    if (st?.format_type === 3) {
                        (options as any).stickerIds = ((options as any).stickerIds as string[]).filter(s => s !== sid);
                        stickerLinks.push(`[${st?.name ?? T("çıkartma", "sticker")}](${STICKER_PREFIX}${sid}.json)`);
                        continue;
                    }
                    if (st?.guild_id && st.guild_id === here) continue; // own server goes normally
                    // Unknown ones get the list cleared anyway; png is assumed, links on failure.
                    // Animated (APNG) ones become GIFs (when gifName is set).
                    const ext = st?.format_type === 4 ? ".gif" : ".png";
                    const label = st?.name ?? T("çıkartma", "sticker");
                    const base = cleanFileName(label, "");
                    const item = {
                        url: `${STICKER_PREFIX}${sid}${ext}?size=${STICKER_EDGE}&quality=lossless`,
                        filename: cleanFileName(label, ext),
                        label,
                        gifName: st?.format_type === 2 ? `${base}.gif` : undefined
                    };
                    (options as any).stickerIds = ((options as any).stickerIds as string[]).filter(s => s !== sid);
                    if (canAttach) stickerJobs.push(item);
                    else stickerLinks.push(`[${st?.name ?? T("çıkartma", "sticker")}](${item.url})`);
                }
            }

            const list = msg.validNonShortcutEmojis ?? [];

            // Soundmojis (<sound:..:..>) go as audio files.
            const audioJobs: { url: string; filename: string; label: string }[] = [];
            const audioLinks: string[] = [];
            if (settings.store.soundmoji) {
                SOUNDMOJI_RE.lastIndex = 0;
                const found = msg.content.match(SOUNDMOJI_RE) ?? [];
                SOUNDMOJI_RE.lastIndex = 0;
                for (const raw of [...new Set(found)]) {
                    const sid = raw.match(/<sound:(\d+):(\d+)>/)?.[2];
                    if (!sid) continue;
                    let snd: any;
                    try {
                        snd = (SoundboardStore as any)?.getSoundById?.(sid);
                    } catch { snd = undefined; }
                    if (!snd) continue;
                    const soundId = /^\d+$/.test(String(snd.soundId ?? "")) ? String(snd.soundId) : sid;
                    // Talk over the code (like the original), or plain name.
                    let spoken = `( ${snd.name ?? T("ses", "sound")} )`;
                    if (snd.emojiId) {
                        const em = EmojiStore.getCustomEmojiById(String(snd.emojiId)) as Emoji | undefined;
                        const ename = em?.name ?? snd.emojiName ?? T("ses", "sound");
                        spoken = `( [${ename}](${EMOJI_PREFIX}${snd.emojiId}.${em?.animated ? "webp" : "png"}?size=32) ${snd.name ?? ""} )`;
                    } else if (snd.emojiName) {
                        spoken = `( ${snd.emojiName} ${snd.name ?? ""} )`;
                    }
                    msg.content = msg.content.split(raw).join(spoken.replace(/ +/g, " "));
                    const item = {
                        url: `${SOUND_PREFIX}${soundId}`,
                        filename: cleanFileName(snd.name ?? T("ses", "sound"), ".ogg"),
                        label: snd.name ?? T("ses", "sound")
                    };
                    if (canAttach) audioJobs.push(item);
                    else audioLinks.push(`[${item.label}](${item.url})`);
                }
            }
            if (!list.length && !stickerJobs.length && !stickerLinks.length && !audioJobs.length && !audioLinks.length) return { cancel: false };
            // Our own resends carry no raw emoji codes; nothing to do, don't touch.
            CUSTOM_EMOJI_RE.lastIndex = 0;
            const hasRaw = CUSTOM_EMOJI_RE.test(msg.content);
            CUSTOM_EMOJI_RE.lastIndex = 0;
            if (!hasRaw && !stickerJobs.length && !stickerLinks.length && !audioJobs.length && !audioLinks.length) return { cancel: false };

            // Match each emoji by id: list dupes and renamed
            // emojis are fine. A leading "-" is an escape.
            // Offsets are recomputed fresh every step (no drift).
            const seen = new Set<string>();
            const targets: Emoji[] = [];
            for (const e of list as Emoji[]) {
                const id = String(e.id ?? "");
                if (!/^\d+$/.test(id) || skipEmoji(e, channelId)) continue;
                if (seen.has(id)) continue;
                seen.add(id);
                targets.push(e);
            }
            // Emoji toggle off: pass sticker/sound through untouched.
            if (!settings.store.emojiBypass) targets.length = 0;

            // Strip escapes first: "-<:...:>" -> "<:...:>", and that emoji skips the bypass.
            const skipped = new Set<string>();
            for (const e of targets) {
                const id = String(e.id);
                const next = msg.content.replace(new RegExp(`-(<a?:[^:<>\\s]+:${id}>)`, "g"), "$1");
                if (next !== msg.content) {
                    msg.content = next;
                    skipped.add(id);
                }
            }

            // One compiled pattern per emoji id, reused by every helper below.
            const patterns = new Map<string, RegExp>();
            const patternFor = (id: string) => {
                let re = patterns.get(id);
                if (!re) {
                    re = rawPattern(id);
                    patterns.set(id, re);
                }
                re.lastIndex = 0;
                return re;
            };
            const stripId = (text: string, id: string) => {
                const re = patternFor(id);
                let out = text;
                let m: RegExpExecArray | null;
                while ((m = re.exec(out)) !== null) {
                    out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
                    re.lastIndex = m.index;
                }
                return out;
            };
            const swapId = (text: string, id: string, insert: string) => {
                const re = patternFor(id);
                let out = text;
                let m: RegExpExecArray | null;
                while ((m = re.exec(out)) !== null) {
                    const piece = withBoundary(out, m.index, m[0].length, insert);
                    out = out.slice(0, m.index) + piece + out.slice(m.index + m[0].length);
                    re.lastIndex = m.index + piece.length;
                }
                return out;
            };
            const hasId = (text: string, id: string) => {
                const re = patternFor(id);
                const found = re.test(text);
                re.lastIndex = 0;
                return found;
            };

            if (!uploadMode && !stickerJobs.length && !audioJobs.length) {
                let i = 0;
                let touched = stickerLinks.length > 0 || audioLinks.length > 0;
                const bare = settings.store.bypassType === "bare";
                for (const e of targets) {
                    const id = String(e.id);
                    if (skipped.has(id) || !hasId(msg.content, id)) continue;
                    touched = true;
                    const url = `${emojiUrl(e, size)}&${i++}`;
                    msg.content = swapId(msg.content, id, bare ? url : `[${e.name}](${url})`);
                }
                if (stickerLinks.length) msg.content = `${msg.content.trim()} ${stickerLinks.join(" ")}`.trim();
                if (audioLinks.length) msg.content = `${msg.content.trim()} ${audioLinks.join(" ")}`.trim();
                if (!touched) return { cancel: false };
                if (!canUseInChannel(channelId, PermissionsBits.EMBED_LINKS))
                    log.warn("no embed permission in channel, others will see links");
                return { cancel: false };
            }

            // Upload path (the original default): emojis become files.
            const jobs: { url: string; filename: string; label: string; gifName?: string; audio?: boolean }[] = [...stickerJobs, ...audioJobs.map(a => ({ ...a, audio: true }))];
            const links: string[] = [...stickerLinks, ...audioLinks];
            let i = 0;
            for (const e of targets) {
                const id = String(e.id);
                if (skipped.has(id) || !hasId(msg.content, id)) continue;
                msg.content = stripId(msg.content, id);
                const item = { url: emojiUrl(e, size), filename: cleanFileName(e.name, extOf(e)), label: e.name };
                // No file permission, or 10 files reached: fall back to a link.
                if (!canAttach || jobs.length >= 10) links.push(`[${e.name}](${item.url}&${i++})`);
                else jobs.push(item);
            }
            if (!jobs.length && !links.length) return { cancel: false };

            // Discord caps a message at 10 files; the rest become links.
            if (jobs.length > 10) {
                const extra = jobs.splice(10);
                for (const j of extra) links.push(`[${j.label}](${j.url})`);
            }

            const text = `${msg.content.trim()}${links.length ? " " + links.join(" ") : ""}`.trim();
            if (!canAttach && links.length) {
                Toasts.show({
                    message: T("Bu odada dosya iznin yok, bağlantı olarak gitti", "No file permission here, sent as links"),
                    id: Toasts.genId(),
                    type: Toasts.Type.INFO
                });
            }
            if (jobs.length) {
                // Each file gets its own attempt: one bad link doesn't sink the rest.
                const settled = await Promise.allSettled(jobs.map(j =>
                    j.audio ? fetchAudioFile(j.url, j.filename)
                        : j.gifName ? fetchStickerGif(j.url, j.gifName, j.filename, STICKER_EDGE)
                            : fetchFile(j.url, j.filename)
                ));
                const uploads: any[] = [];
                settled.forEach((r, k) => {
                    if (r.status === "fulfilled") {
                        uploads.push(new CloudUpload({ file: r.value, isThumbnail: false, platform: 1 }, channelId));
                    } else {
                        log.warn("file fetch failed, falling back to link", jobs[k].url, r.reason);
                        links.push(`[${jobs[k].label}](${jobs[k].url})`);
                    }
                });
                if (uploads.length) {
                    const body = `${text}${links.length ? " " + links.join(" ") : ""}`.trim();
                    await sendMessage(channelId, { content: body }, true, { attachmentsToUpload: uploads as any });
                } else {
                    const body = `${text}${links.length ? " " + links.join(" ") : ""}`.trim();
                    await sendMessage(channelId, { content: body }, true, {});
                }
            } else {
                await sendMessage(channelId, { content: text }, true, {});
            }
            return { cancel: true };
            } catch (err) {
                log.warn("send guard kicked in", err);
                msg.content = origContent;
                if (origStickers !== undefined) (options as any).stickerIds = origStickers;
                return { cancel: false };
            }
        });

        this.preEdit = addMessagePreEditListener((channelId, _id, msg) => {
            const size = settings.store.emojiSize;
            const bare = settings.store.bypassType === "bare";
            // Edits can't add files, so both modes become links (like the original).
            msg.content = msg.content.replace(CUSTOM_EMOJI_RE, (raw: string, id: string, off: number, full: string) => {
                const e = EmojiStore.getCustomEmojiById(id) as Emoji | undefined;
                if (!e || !/^\d+$/.test(String(e.id ?? "")) || skipEmoji(e, channelId)) return raw;
                const url = `${emojiUrl(e, size)}&0`;
                return withBoundary(full, off, raw.length, bare ? url : `[${e.name}](${url})`);
            });
            return { cancel: false };
        });
    },

    handleNewMessage(e: any) {
        fetchAuthors([e?.message?.author?.id]);
        stripMessageEmbeds(e?.message);
    },

    handleLoadedMessages(e: any) {
        const list = e?.messages;
        if (!Array.isArray(list)) return;
        fetchAuthors(list.map((m: any) => m?.author?.id));
        for (const m of list) stripMessageEmbeds(m);
    },

    handleUpdatedMessage(e: any) {
        stripMessageEmbeds(e?.message);
    },

    stop() {
        try {
            removeMessagePreSendListener(this.preSend);
            removeMessagePreEditListener(this.preEdit);
        } catch { /* ignore */ }
        this.preSend = this.preEdit = null;
        try {
            FluxDispatcher.unsubscribe("MESSAGE_CREATE", this.handleNewMessage);
            FluxDispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", this.handleLoadedMessages);
            FluxDispatcher.unsubscribe("MESSAGE_UPDATE", this.handleUpdatedMessage);
            SettingsStore.removeChangeListener("plugins.Yabdp4Nitro.customFps", syncCustomFps);
            SettingsStore.removeChangeListener("plugins.Yabdp4Nitro.videoFilter", syncCameraBg);
            SettingsStore.removeChangeListener("plugins.Yabdp4Nitro.videoFilterLink", syncCameraBg);
            SettingsStore.removeChangeListener("plugins.Yabdp4Nitro.videoFilterType", syncCameraBg);
            SettingsStore.removeChangeListener("plugins.Yabdp4Nitro.streamUnlock", syncGoLiveUpsell);
        } catch { /* ignore */ }
        removeRuntimeFps();
        uninstallCameraBg();
        uninstallSharpener();
        uninstallGoLiveUpsell();
        unloadFFmpeg();
        usrbg = null;
        userpfp = null;
        clearRevealCache();
        convertedFiles = new WeakSet();
        gifCache.clear();
        fetchedAt.clear();
        fpsListRef = fpsLabeledRef = null;
        streamConstsRef = null;
    }
});
