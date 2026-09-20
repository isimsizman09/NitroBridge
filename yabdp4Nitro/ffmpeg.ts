/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE file for more information
 */

// Yabdp4Nitro — FFmpeg.WASM loader (clean-room rewrite).
// Same build as the original repo (version parity):
// https://github.com/riolubruh/YABDP4Nitro/tree/main/ffmpeg
// Loading is lazy (first clip downloads it); without it the clip features stay off.

const FFMPEG_BASE = "https://raw.githubusercontent.com/riolubruh/YABDP4Nitro/refs/heads/main/ffmpeg/";
const FETCH_TIMEOUT = 100000;
const SCRIPT_ID = "yabdp-ffmpeg-script";

let ffmpeg: any = null;
let loading: Promise<any> | null = null;

async function fetchWithTimeout(url: string, binary: boolean) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`ffmpeg dosyası inemedi ${res.status}: ${url}`);
        return binary ? new Uint8Array(await res.arrayBuffer()) : await res.text();
    } finally {
        clearTimeout(timer);
    }
}

async function getText(url: string) {
    return fetchWithTimeout(url, false) as Promise<string>;
}

function revoke(urls: (string | undefined)[]) {
    for (const u of urls) {
        if (!u) continue;
        try {
            if (u.startsWith("blob:")) URL.revokeObjectURL(u);
        } catch { /* sessiz geç */ }
    }
}

export function ffmpegLoaded() {
    try {
        return !!ffmpeg?.loaded;
    } catch {
        return false;
    }
}

export async function ensureFFmpeg() {
    if (ffmpegLoaded()) return ffmpeg;
    if (loading) return loading;
    loading = (async () => {
        let workerUrl: string | undefined;
        let blobUrl: string | undefined;
        let coreUrl: string | undefined;
        let wasmUrl: string | undefined;
        try {
            // Read the worker file name from the main script (survives version bumps).
            const main = await getText(`${FFMPEG_BASE}ffmpeg.js`);
            const chunk = main.match(/e\.u\((\d+)\)/)?.[1] ?? "814";
            const workerJs = await getText(`${FFMPEG_BASE}${chunk}.ffmpeg.js`);
            workerUrl = URL.createObjectURL(new Blob([workerJs], { type: "text/javascript" }));
            // Point the worker URL in the main script at the blob (original technique).
            // The 814 anchor comes first, generic pattern as backup.
            const anchor = "new URL(e.p+e.u(814),e.b)";
            const patched = main.includes(anchor)
                ? main.replace(anchor, `"${workerUrl}"`)
                : main.replace(/new URL\(e\.p\+e\.u\(\d+\),e\.b\)/, `"${workerUrl}"`);
            blobUrl = URL.createObjectURL(new Blob([patched], { type: "text/javascript" }));
            const coreJs = await getText(`${FFMPEG_BASE}ffmpeg-core.js`);
            coreUrl = URL.createObjectURL(new Blob([coreJs], { type: "text/javascript" }));
            const coreWasm = await fetchWithTimeout(`${FFMPEG_BASE}ffmpeg-core.wasm`, true) as Uint8Array;
            wasmUrl = URL.createObjectURL(new Blob([coreWasm as Uint8Array<ArrayBuffer>], { type: "application/wasm" }));
            // No stale tag on reloads.
            try {
                document.getElementById(SCRIPT_ID)?.remove();
            } catch { /* sessiz geç */ }
            await new Promise<void>((resolve, reject) => {
                const el = document.createElement("script");
                el.id = SCRIPT_ID;
                el.src = blobUrl!;
                el.onload = () => resolve();
                el.onerror = () => reject(new Error("ffmpeg betiği yüklenemedi (güvenlik engeli olabilir)"));
                document.head.appendChild(el);
            });
            const W = (window as any).FFmpegWASM;
            if (!W?.FFmpeg) throw new Error("FFmpegWASM bulunamadı");
            ffmpeg = new W.FFmpeg();
            await ffmpeg.load({ coreURL: coreUrl, wasmURL: wasmUrl });
            revoke([blobUrl, coreUrl, wasmUrl, workerUrl]);
            blobUrl = coreUrl = wasmUrl = workerUrl = undefined;
            return ffmpeg;
        } catch (err) {
            revoke([blobUrl, coreUrl, wasmUrl, workerUrl]);
            try {
                document.getElementById(SCRIPT_ID)?.remove();
            } catch { /* sessiz geç */ }
            throw err;
        }
    })();
    try {
        return await loading;
    } finally {
        if (!ffmpegLoaded()) loading = null;
    }
}

export function unloadFFmpeg() {
    try {
        ffmpeg?.terminate?.();
    } catch { /* sessiz geç */ }
    ffmpeg = null;
    loading = null;
    try {
        document.getElementById(SCRIPT_ID)?.remove();
    } catch { /* sessiz geç */ }
    try {
        if ((window as any).FFmpegWASM) delete (window as any).FFmpegWASM;
    } catch { /* sessiz geç */ }
}
