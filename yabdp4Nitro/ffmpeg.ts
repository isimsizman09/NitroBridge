/*
 * NitroBridge — Vencord port of YABDP4Nitro.
 * Copyright (c) 2026 isimsizman09
 * Inspired by YABDP4Nitro by Riolubruh (OSL-3.0, https://github.com/riolubruh/YABDP4Nitro).
 * Licensed under the Open Software License version 3.0 (OSL-3.0).
 * See LICENSE file for more information.
 */

// Yabdp4Nitro — FFmpeg.WASM loader (clean-room rewrite).
// Pinned to one upstream commit (supply-chain safety): both the file set and
// every byte are verified before anything runs. To bump versions, update
// FFMPEG_COMMIT plus the four hashes below (they are printed by the build).
// Loading is lazy (first clip downloads it); without it the clip features stay off.

const FFMPEG_COMMIT = "3f336c0a378cb29e503a6a83c3063532e46cfef1";
const FFMPEG_BASE = `https://raw.githubusercontent.com/riolubruh/YABDP4Nitro/${FFMPEG_COMMIT}/ffmpeg/`;

const EXPECTED_HASHES: Record<string, string> = {
    "ffmpeg.js": "ad4cfe957589995dea03fc8de1fd5e9f5cb4558a7282913172203082a65bbfaa",
    "814.ffmpeg.js": "976f4174ae7da80c0d4f9523ee6dde3ecbce7dc2ee392b2a5322049abb9b8627",
    "ffmpeg-core.js": "b266ab5b952555881dd6310663986994a182acb2b7ff25cf10a25f7a37ac2b21",
    "ffmpeg-core.wasm": "9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7"
};

import { Logger } from "@utils/Logger";

const FETCH_TIMEOUT = 100000;
const SCRIPT_ID = "yabdp-ffmpeg-script";

const log = new Logger("Yabdp4Nitro");

let ffmpeg: any = null;
let loading: Promise<any> | null = null;

async function sha256Hex(data: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function fetchVerified(name: string): Promise<Uint8Array> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
        const res = await fetch(`${FFMPEG_BASE}${name}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`ffmpeg file failed ${res.status}: ${name}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const expected = EXPECTED_HASHES[name];
        if (expected) {
            const actual = await sha256Hex(bytes);
            if (actual !== expected.toLowerCase()) {
                throw new Error(`ffmpeg file failed verification, refusing to run: ${name} (got ${actual.slice(0, 16)}…)`);
            }
        }
        return bytes;
    } finally {
        clearTimeout(timer);
    }
}

function revoke(urls: (string | undefined)[]) {
    for (const u of urls) {
        if (!u) continue;
        try {
            if (u.startsWith("blob:")) URL.revokeObjectURL(u);
        } catch { /* ignore */ }
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
            // Read the worker file name from the main script (survives renames).
            const mainBytes = await fetchVerified("ffmpeg.js");
            const main = new TextDecoder().decode(mainBytes);
            const chunk = main.match(/e\.u\((\d+)\)/)?.[1] ?? "814";
            const workerName = `${chunk}.ffmpeg.js`;
            const workerBytes = await fetchVerified(workerName);
            // The pinned set only knows 814: anything else fails closed.
            if (!EXPECTED_HASHES[workerName]) throw new Error(`unexpected worker chunk: ${workerName}`);
            const workerJs = new TextDecoder().decode(workerBytes);
            workerUrl = URL.createObjectURL(new Blob([workerJs], { type: "text/javascript" }));
            // Point the worker URL in the main script at the blob (original technique).
            // The 814 anchor comes first, generic pattern as backup.
            const anchor = "new URL(e.p+e.u(814),e.b)";
            let patched: string;
            let count: number;
            if (main.includes(anchor)) {
                count = main.split(anchor).length - 1;
                patched = main.split(anchor).join(`"${workerUrl}"`);
            } else {
                const re = /new URL\(e\.p\+e\.u\(\d+\),e\.b\)/g;
                count = (main.match(re) ?? []).length;
                patched = main.replace(re, `"${workerUrl}"`);
            }
            if (!count) throw new Error("worker pattern not found");
            blobUrl = URL.createObjectURL(new Blob([patched], { type: "text/javascript" }));
            const coreJs = new TextDecoder().decode(await fetchVerified("ffmpeg-core.js"));
            coreUrl = URL.createObjectURL(new Blob([coreJs], { type: "text/javascript" }));
            const coreWasm = await fetchVerified("ffmpeg-core.wasm");
            wasmUrl = URL.createObjectURL(new Blob([coreWasm as Uint8Array<ArrayBuffer>], { type: "application/wasm" }));
            // No stale tag on reloads.
            try {
                document.getElementById(SCRIPT_ID)?.remove();
            } catch { /* ignore */ }
            await new Promise<void>((resolve, reject) => {
                const el = document.createElement("script");
                el.id = SCRIPT_ID;
                el.src = blobUrl!;
                el.onload = () => resolve();
                el.onerror = () => reject(new Error("ffmpeg script failed to load (possible security block)"));
                document.head.appendChild(el);
            });
            const W = (window as any).FFmpegWASM;
            if (!W?.FFmpeg) throw new Error("FFmpegWASM missing");
            ffmpeg = new W.FFmpeg();
            await ffmpeg.load({ coreURL: coreUrl, wasmURL: wasmUrl });
            revoke([blobUrl, coreUrl, wasmUrl, workerUrl]);
            blobUrl = coreUrl = wasmUrl = workerUrl = undefined;
            return ffmpeg;
        } catch (err) {
            revoke([blobUrl, coreUrl, wasmUrl, workerUrl]);
            try {
                document.getElementById(SCRIPT_ID)?.remove();
            } catch { /* ignore */ }
            try {
                if ((window as any).FFmpegWASM) delete (window as any).FFmpegWASM;
            } catch { /* ignore */ }
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
    } catch { /* ignore */ }
    ffmpeg = null;
    loading = null;
    try {
        document.getElementById(SCRIPT_ID)?.remove();
    } catch { /* ignore */ }
    try {
        if ((window as any).FFmpegWASM) delete (window as any).FFmpegWASM;
    } catch { /* ignore */ }
}
