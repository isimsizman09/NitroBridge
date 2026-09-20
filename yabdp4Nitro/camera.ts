/*
 * NitroBridge — Vencord port of YABDP4Nitro.
 * Copyright (c) 2026 isimsizman09
 * Inspired by YABDP4Nitro by Riolubruh (OSL-3.0, https://github.com/riolubruh/YABDP4Nitro).
 * Licensed under the Open Software License version 3.0 (OSL-3.0).
 * See LICENSE file for more information.
 */

// Custom camera background (clean-room rewrite).
// Inspired by YABDP4Nitro's customCameraBackground (OSL-3.0). No copied code.
// Idea: append a "My Custom Background" preset to Discord's background list,
// and when it gets picked, feed the media engine our own image/video bytes.
// All lookups happen at runtime (minified names shift every build).

import { Logger } from "@utils/Logger";
import { findAll } from "@webpack";

import { factorySource, findModuleByNeedles } from "./wfind";

const log = new Logger("Yabdp4Nitro");
const CUSTOM_ID = 69;
const PRESET_ANCHOR = "52f91129995158682c465310f61e64cd61fbf227f0dc6b43313c5e8226818661";
const HANDLER_ANCHOR = ".gO.BACKGROUND_BLUR);if";
const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;
// Camera backgrounds bigger than this are refused (memory safety).
const MAX_BG_BYTES = 32 * 1024 * 1024;

let undo: Array<() => void> = [];
let installGen = 0;

async function fetchBytes(link: string, signal?: AbortSignal): Promise<Uint8ClampedArray> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    const onAbort = () => ctrl.abort();
    try {
        try {
            signal?.addEventListener("abort", onAbort, { once: true });
        } catch { /* ignore */ }
        const res = await fetch(link, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`background download failed ${res.status}`);
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_BG_BYTES) throw new Error("background too large");
        return new Uint8ClampedArray(buf);
    } finally {
        clearTimeout(timer);
        try {
            signal?.removeEventListener?.("abort", onAbort);
        } catch { /* ignore */ }
    }
}

async function fetchImage(link: string, signal?: AbortSignal) {
    const bytes = await fetchBytes(link, signal);
    const url = URL.createObjectURL(new Blob([bytes as Uint8ClampedArray<ArrayBuffer>]));
    try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("background image unreadable"));
            img.src = url;
        });
        const canvas = document.createElement("canvas");
        canvas.width = TARGET_WIDTH;
        canvas.height = TARGET_HEIGHT;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        const { data } = ctx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        return { data, width: TARGET_WIDTH, height: TARGET_HEIGHT, pixelFormat: "rgba" };
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function uninstallCameraBg() {
    const jobs = undo;
    undo = [];
    installGen++;
    for (const fn of jobs) {
        try {
            fn();
        } catch { /* ignore */ }
    }
}

export function installCameraBg(link: string, video: boolean): boolean {
    uninstallCameraBg();
    try {
        if (!link || !/^https:\/\//i.test(link)) return false;
        const enumMod = findAll((m: any) => {
            try {
                return m?.Tr?.CAMERA_BACKGROUND_LIVE && m?.gO?.BACKGROUND_REPLACEMENT && m?.Qo?.INPUT_DEVICE;
            } catch {
                return false;
            }
        })?.[0];
        const mediaMod = findAll((m: any) => {
            try {
                return typeof m?.wq === "function" && typeof m?.Oo === "function";
            } catch {
                return false;
            }
        })?.[0];
        const presetMod = findModuleByNeedles([PRESET_ANCHOR]);
        const handlerMod = findModuleByNeedles([HANDLER_ANCHOR]);
        const enumsOk = enumMod?.Tr?.CAMERA_BACKGROUND_LIVE && enumMod?.gO?.BACKGROUND_REPLACEMENT && enumMod?.Qo?.INPUT_DEVICE;
        const mediaWq = mediaMod && typeof mediaMod.wq === "function" ? mediaMod.wq : null;
        if (!enumsOk || !presetMod || typeof presetMod.A !== "function" || !mediaWq || !handlerMod) {
            uninstallCameraBg();
            return false;
        }
        const replacement = enumMod.gO.BACKGROUND_REPLACEMENT;
        // 1. extra preset in the background list
        const origA = presetMod.A;
        presetMod.A = function (this: any, ...args: any[]) {
            const res = origA.apply(this, args);
            try {
                if (res && typeof res === "object") {
                    const taken = res[CUSTOM_ID];
                    if (taken && taken.id !== CUSTOM_ID && taken.source !== link) return res;
                    res[CUSTOM_ID] = {
                        id: CUSTOM_ID,
                        name: "My Custom Background",
                        source: link,
                        isVideo: video
                    };
                }
            } catch { /* ignore */ }
            return res;
        };
        undo.push(() => { try { presetMod.A = origA; } catch { /* ignore */ } });
        // 2. feed our bytes when the custom preset gets picked
        let wrapped = false;
        for (const key of Object.keys(handlerMod)) {
            let orig: any;
            try {
                orig = handlerMod[key];
            } catch {
                continue;
            }
            if (typeof orig !== "function") continue;
            if (!factorySource(orig).includes("BACKGROUND_REPLACEMENT")) continue;
            handlerMod[key] = function (this: any, ...args: any[]) {
                try {
                    const [type, target, option] = args;
                    if (option === CUSTOM_ID) {
                        const gen = installGen;
                        const ctrl = new AbortController();
                        void (async () => {
                            try {
                                const payload = video
                                    ? { blob: await fetchBytes(link, ctrl.signal) }
                                    : { image: await fetchImage(link, ctrl.signal) };
                                if (gen !== installGen) return;
                                mediaWq({ [type]: { graph: replacement, target, ...payload } });
                            } catch (err) {
                                log.warn("custom background apply failed", err);
                            }
                        })();
                        return;
                    }
                } catch { /* fall through to original */ }
                return orig.apply(this, args);
            };
            undo.push(() => { try { handlerMod[key] = orig; } catch { /* ignore */ } });
            wrapped = true;
            break;
        }
        if (!wrapped) {
            uninstallCameraBg();
            return false;
        }
        return true;
    } catch {
        uninstallCameraBg();
        return false;
    }
}
