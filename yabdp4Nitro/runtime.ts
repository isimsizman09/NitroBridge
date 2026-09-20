/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE file for more information
 */

// Late runtime patches (clean-room rewrite).
// Some targets live in lazy chunks or share find-strings with unrelated
// modules, where a static patch would either miss or spam "had no effect"
// warnings. These install silently at runtime with exact shape checks.

import { settings } from "./settings";
import { factorySource, findModuleByNeedles } from "./wfind";

let undo: Array<() => void> = [];

// GoLive Nitro upsell box: hide it. The component is uniquely identified by
// its trial check; static patching would also hit the locale bundle.
export function installGoLiveUpsell(): boolean {
    uninstallGoLiveUpsell();
    try {
        if (!settings.store.streamUnlock) return false;
        const mod = findModuleByNeedles(["GO_LIVE_MODAL_V2", "subscriptionTrial", "+f+cqk"]);
        if (!mod || typeof mod !== "object") return false;
        for (const key of Object.keys(mod)) {
            let fn: any;
            try {
                fn = mod[key];
            } catch {
                continue;
            }
            if (typeof fn !== "function") continue;
            const src = factorySource(fn);
            if (!src.includes("subscriptionTrial") || !src.includes("GO_LIVE_MODAL_V2")) continue;
            const orig = fn;
            mod[key] = function (this: any, ...args: any[]) {
                try {
                    if (settings.store.streamUnlock) return null;
                } catch { /* fall through */ }
                return orig.apply(this, args);
            };
            undo.push(() => { try { mod[key] = orig; } catch { /* ignore */ } });
            return true;
        }
        return false;
    } catch {
        uninstallGoLiveUpsell();
        return false;
    }
}

export function uninstallGoLiveUpsell() {
    const jobs = undo;
    undo = [];
    for (const fn of jobs) {
        try {
            fn();
        } catch { /* ignore */ }
    }
}
