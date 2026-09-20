/*
 * NitroBridge — Vencord port of YABDP4Nitro.
 * Copyright (c) 2026 isimsizman09
 * Inspired by YABDP4Nitro by Riolubruh (OSL-3.0, https://github.com/riolubruh/YABDP4Nitro).
 * Licensed under the Open Software License version 3.0 (OSL-3.0).
 * See LICENSE file for more information.
 */

// Per-user stream sharpness (clean-room rewrite).
// Inspired by YABDP4Nitro's sharpenStreams (OSL-3.0). No copied code.
// Idea: the stream overlay component gets a sharpen SVG filter whose blend
// follows the per-user slider value. The SVG travels inside a data URI, so
// no extra DOM nodes are needed. All lookups happen at runtime.

import { Logger } from "@utils/Logger";
import { wreq } from "@webpack";

import { settings } from "./settings";
import { factorySource } from "./wfind";

const log = new Logger("Yabdp4Nitro");

let undo: Array<() => void> = [];
let installed = false;
let logged = false;
let scannedFactoryCount = -1;

function findComponent(needles: string[]): { mod: any; key: string; fn: any } | null {
    try {
        const factories = (wreq as any)?.m;
        if (!factories) return null;
        const ids = Object.keys(factories);
        // Nothing new loaded since the last miss: skip the expensive scan.
        if (scannedFactoryCount === ids.length) return null;
        scannedFactoryCount = ids.length;
        for (const id of ids) {
            let code = "";
            try {
                code = factorySource(factories[id]);
            } catch {
                continue;
            }
            if (!needles.every(n => code.includes(n))) continue;
            let mod: any;
            try {
                mod = (wreq as any)(id);
            } catch {
                continue;
            }
            if (!mod || typeof mod !== "object") continue;
            for (const key of Object.keys(mod)) {
                let fn: any;
                try {
                    fn = mod[key];
                } catch {
                    continue;
                }
                if (typeof fn !== "function") continue;
                const src = factorySource(fn);
                if (src.includes("backgroundKey") && src.includes("onForceIdle")) {
                    return { mod, key, fn };
                }
            }
        }
    } catch { /* ignore */ }
    return null;
}

export function getSharpen(userId: string | undefined): number {
    try {
        if (!userId) return 0;
        const prefs = (settings.store as any)?.sharpenPrefs as Record<string, number> | undefined;
        const v = Math.round(Number(prefs?.[userId] ?? 0));
        return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
    } catch {
        return 0;
    }
}

export function setSharpen(userId: string, value: number) {
    try {
        if (!userId || !/^\d+$/.test(userId)) return;
        const v = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
        const prefs = { ...((settings.store as any)?.sharpenPrefs ?? {}) };
        if (v <= 0) delete prefs[userId];
        else prefs[userId] = v;
        (settings.store as any).sharpenPrefs = prefs;
    } catch { /* ignore */ }
}

function filterFor(userId: string | undefined): string | undefined {
    const amount = getSharpen(userId) / 100;
    if (amount <= 0) return;
    const k2 = (1 - amount).toFixed(3);
    const k3 = amount.toFixed(3);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg'><filter id='yabd' color-interpolation-filters='sRGB'><feConvolveMatrix order='3' kernelMatrix='0 -1 0 -1 5 -1 0 -1 0' result='sharpen'/><feComposite in='SourceGraphic' in2='sharpen' operator='arithmetic' k1='0' k2='${k2}' k3='${k3}' k4='0'/></filter></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}#yabd")`;
}

export function uninstallSharpener() {
    const jobs = undo;
    undo = [];
    installed = false;
    scannedFactoryCount = -1;
    for (const fn of jobs) {
        try {
            fn();
        } catch { /* ignore */ }
    }
}

export function installSharpener(): boolean {
    uninstallSharpener();
    try {
        const found = findComponent(["backgroundKey", "onForceIdle", "renderBottomLeftControls"]);
        if (!found) return false;
        const { mod, key, fn: orig } = found;
        mod[key] = function (this: any, ...args: any[]) {
            const ret = orig.apply(this, args);
            try {
                const bgKey = args?.[0]?.backgroundKey;
                const userId = typeof bgKey === "string" ? bgKey.split(":")[3] : undefined;
                if (!userId || !/^\d+$/.test(userId)) return ret;
                const filter = filterFor(userId);
                const kids = ret?.props?.children;
                if (Array.isArray(kids) && kids[0]?.props && filter) {
                    kids[0] = { ...kids[0], props: { ...kids[0].props, style: { ...kids[0].props.style, filter } } };
                }
            } catch (err) {
                log.warn("sharpen apply failed", err);
            }
            return ret;
        };
        undo.push(() => { try { mod[key] = orig; } catch { /* ignore */ } });
        installed = true;
        if (!logged) {
            logged = true;
            log.info("stream sharpener installed");
        }
        return true;
    } catch {
        uninstallSharpener();
        return false;
    }
}

// The overlay component may load after startup; retry on menu open.
export function ensureSharpener() {
    try {
        if (!installed) installSharpener();
    } catch { /* ignore */ }
}
