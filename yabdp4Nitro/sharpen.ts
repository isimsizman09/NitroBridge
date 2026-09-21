/*
 * NitroBridge — Vencord port of YABDP4Nitro.
 * Copyright (c) 2026 isimsizman09
 * Inspired by YABDP4Nitro by Riolubruh (OSL-3.0, https://github.com/riolubruh/YABDP4Nitro).
 * Licensed under the Open Software License version 3.0 (OSL-3.0).
 * See LICENSE file for more information.
 *
 * NOTE: intentionally not the Vencord GPL header (this is OSL-3.0 code);
 * run eslint WITHOUT --fix on this folder.
 */

// Per-user stream sharpness (clean-room rewrite).
// Inspired by YABDP4Nitro's sharpenStreams (OSL-3.0, plugin lines
// 4509-4597 + 6600-6641). No copied code.
//
// How it works:
// - One hidden <svg> in the document holds a real <filter> per user.
//   Same-document `url(#id)` references are the only kind Chromium
//   (Discord desktop) applies to video tiles, so no data-URI tricks.
// - Tiles are found through the DOM, not webpack: an observer watches for
//   <video> nodes, reads the streamer id from the hosting React fiber
//   (participantOnScreen / stream props — Discord's own stable names) and
//   styles the tile. No export rebinding, no minified names, so Discord
//   updates can't silently break the install step.
// - Moving the slider updates the live filter element and any marked
//   tiles directly, so no React re-render is needed.

import { Logger } from "@utils/Logger";

import { settings } from "./settings";

const log = new Logger("Yabdp4Nitro");

const FILTER_PREFIX = "yabd-sharpen-";
const TILE_ATTR = "data-yabd-sharpen";
const SVG_NS = "http://www.w3.org/2000/svg";

let undo: Array<() => void> = [];
let installed = false;
let defsSvg: SVGSVGElement | null = null;
let observer: MutationObserver | null = null;
let sweepQueued = false;
let installGen = 0;

// Plain console mirror: visible even if the styled logger is filtered.
function say(level: "info" | "warn", msg: string) {
    try {
        if (level === "warn") {
            log.warn(msg);
            console.warn("[Yabdp4Nitro]", msg);
        } else {
            log.info(msg);
            console.info("[Yabdp4Nitro]", msg);
        }
    } catch { /* ignore */ }
}

export function isSharpenerInstalled(): boolean {
    try {
        return installed;
    } catch {
        return false;
    }
}

function filterId(userId: string): string {
    return `${FILTER_PREFIX}${userId}`;
}

function escapedId(id: string): string {
    try {
        return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
    } catch {
        return id;
    }
}

function filterSelector(userId: string): string {
    return `#${escapedId(filterId(userId))}`;
}

function clampPct(value: unknown): number {
    const v = Math.round(Number(value) || 0);
    if (!Number.isFinite(v)) return 0;
    return Math.min(100, Math.max(0, v));
}

export function getSharpen(userId: string | undefined): number {
    try {
        if (!userId) return 0;
        const prefs = (settings.store as any)?.sharpenPrefs as Record<string, number> | undefined;
        return clampPct(prefs?.[userId] ?? 0);
    } catch {
        return 0;
    }
}

// Hidden <svg> that owns every sharpen filter. Created once, removed on
// uninstall/stop.
function ensureDefs(): SVGSVGElement | null {
    try {
        if (defsSvg?.isConnected) return defsSvg;
        defsSvg = null;
        const doc = typeof document !== "undefined" ? document : null;
        if (!doc) return null;
        const svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
        svg.setAttribute("width", "0");
        svg.setAttribute("height", "0");
        svg.setAttribute("aria-hidden", "true");
        svg.style.position = "absolute";
        (doc.body ?? doc.documentElement)?.appendChild(svg);
        if (!svg.isConnected) {
            defsSvg = null;
            return null;
        }
        defsSvg = svg;
        return svg;
    } catch {
        return null;
    }
}

// Create (or refresh) the live filter for a user. Returns false when the
// document isn't ready, so callers can retry on the next render.
function ensureFilter(userId: string, pct: number): boolean {
    try {
        const svg = ensureDefs();
        if (!svg) return false;
        const id = filterId(userId);
        let filter = svg.querySelector(filterSelector(userId));
        if (!filter) {
            filter = document.createElementNS(SVG_NS, "filter");
            filter.setAttribute("id", id);
            filter.setAttribute("color-interpolation-filters", "sRGB");
            const matrix = document.createElementNS(SVG_NS, "feConvolveMatrix");
            matrix.setAttribute("order", "3");
            matrix.setAttribute("kernelMatrix", "0 -1 0 -1 5 -1 0 -1 0");
            matrix.setAttribute("result", "sharpen");
            const blend = document.createElementNS(SVG_NS, "feComposite");
            blend.setAttribute("in", "SourceGraphic");
            blend.setAttribute("in2", "sharpen");
            blend.setAttribute("operator", "arithmetic");
            blend.setAttribute("k1", "0");
            blend.setAttribute("k4", "0");
            blend.setAttribute("data-blend", "1");
            filter.appendChild(matrix);
            filter.appendChild(blend);
            svg.appendChild(filter);
        }
        const blend = filter.querySelector('[data-blend="1"]');
        if (!blend) return false;
        const amount = clampPct(pct) / 100;
        blend.setAttribute("k2", (1 - amount).toFixed(3));
        blend.setAttribute("k3", amount.toFixed(3));
        return true;
    } catch {
        return false;
    }
}

function removeFilter(userId: string) {
    try {
        defsSvg?.querySelector(filterSelector(userId))?.remove();
    } catch { /* ignore */ }
}

// Push the current preference onto every mounted tile of this user.
// This is what makes the slider feel live: already-open tiles update
// without waiting for Discord to re-render them. Returns tiles touched.
function paintTiles(userId: string, pct: number): number {
    let touched = 0;
    try {
        if (typeof document === "undefined" || !/^\d+$/.test(userId)) return 0;
        const nodes = document.querySelectorAll(`[${TILE_ATTR}="${userId}"]`);
        nodes.forEach(node => {
            try {
                const el = node as HTMLElement;
                if (pct > 0 && ensureFilter(userId, pct)) {
                    el.style.filter = `url(#${filterId(userId)})`;
                    touched++;
                } else {
                    el.removeAttribute(TILE_ATTR);
                    if (el.style.filter.includes(FILTER_PREFIX)) el.style.removeProperty("filter");
                }
            } catch { /* ignore */ }
        });
    } catch { /* ignore */ }
    return touched;
}

// Re-apply every saved preference (used after a late install so tiles
// marked earlier pick their filters back up without a reload).
export function repaintKnown() {
    try {
        const prefs = (settings.store as any)?.sharpenPrefs as Record<string, number> | undefined;
        if (!prefs) return;
        for (const [userId, v] of Object.entries(prefs)) {
            try {
                const pct = clampPct(v);
                if (!/^\d+$/.test(userId)) continue;
                if (pct > 0) ensureFilter(userId, pct);
                paintTiles(userId, pct);
            } catch { /* ignore */ }
        }
    } catch { /* ignore */ }
}

export function setSharpen(userId: string, value: number) {
    try {
        if (!userId || !/^\d+$/.test(userId)) return;
        const v = clampPct(value);
        const prefs = { ...((settings.store as any)?.sharpenPrefs ?? {}) };
        if (v <= 0) {
            delete prefs[userId];
            removeFilter(userId);
        } else {
            prefs[userId] = v;
            ensureFilter(userId, v);
        }
        (settings.store as any).sharpenPrefs = prefs;
        const touched = paintTiles(userId, v);
        if (v > 0 && touched > 0 && appliedNote.get(userId) !== v) {
            appliedNote.set(userId, v);
            say("info", `sharpness ${v}% applied to ${touched} tile(s)`);
        }
        if (v <= 0) appliedNote.delete(userId);
        // Tiles that mounted before any preference existed have no marker
        // yet: sweep once so 0 -> value applies instantly. Skip when this
        // user's tile is already marked (paintTiles covered it) to avoid a
        // full scan on every slider tick.
        try {
            if (v > 0 && touched === 0 && typeof document !== "undefined"
                && !document.querySelector(`[${TILE_ATTR}="${userId}"]`)) queueSweep();
        } catch { /* ignore */ }
    } catch { /* ignore */ }
}

// How many tiles currently carry our marker (proof the wrap is live).
export function markedTileCount(): number {
    try {
        if (typeof document === "undefined") return 0;
        return document.querySelectorAll(`[${TILE_ATTR}]`).length;
    } catch {
        return 0;
    }
}

export interface TileDiagnosis {
    userId: string | null;
    pct: number;
    marked: boolean;
}

// Snapshot of every video on screen: what id (if any) it resolves to,
// the saved preference for that id, and whether it carries our marker.
// Shown in the stream menu so diagnosis needs no console.
export function diagnoseTiles(): { videos: number; items: TileDiagnosis[]; } {
    const items: TileDiagnosis[] = [];
    try {
        if (typeof document === "undefined") return { videos: 0, items };
        const vids = document.querySelectorAll("video");
        vids.forEach(v => {
            try {
                const el = v as HTMLVideoElement;
                const userId = fiberUserId(el) ?? null;
                items.push({
                    userId,
                    pct: userId ? getSharpen(userId) : 0,
                    marked: userId ? el.getAttribute(TILE_ATTR) === userId : false,
                });
            } catch { /* ignore */ }
        });
    } catch { /* ignore */ }
    return { videos: items.length, items };
}

// Shape of a video's fiber ancestry for diagnosis: component names plus
// prop key names. Values are never printed (only string lengths of
// id-like keys, e.g. ownerId:s19), so nothing private leaks to the log.
export function shapeOf(video: Element): string {
    try {
        const anyEl = video as any;
        const fiberKey = Object.keys(anyEl).find(k => k.startsWith("__reactFiber$"));
        let fiber = fiberKey ? anyEl[fiberKey] : null;
        const parts: string[] = [];
        for (let depth = 0; depth < 6 && fiber; depth++) {
            try {
                const t = fiber.type;
                const tname = typeof t === "string" ? t : (t?.displayName ?? t?.name ?? "?");
                const mp = fiber.memoizedProps;
                let keys = "";
                if (mp && typeof mp === "object") {
                    keys = Object.keys(mp).slice(0, 14).map(k => {
                        try {
                            if (/id$/i.test(k)) {
                                const v = (mp as any)[k];
                                if (v !== null && typeof v !== "object") return `${k}:${typeof v === "string" ? "s" : "n"}${String(v).length}`;
                            }
                        } catch { /* ignore */ }
                        return k;
                    }).join(",");
                }
                parts.push(`${String(tname).slice(0, 40)}{${keys.slice(0, 160)}}`);
            } catch { /* ignore */ }
            fiber = fiber?.return;
        }
        return parts.join(" < ") || "(no fiber)";
    } catch {
        return "(shape failed)";
    }
}

// Strict anchors: trusted on any React-managed video. These prop names
// are Discord's own and identify a stream/camera tile unambiguously.
function strictAnchor(props: any): string | undefined {
    try {
        if (!props || typeof props !== "object") return;
        const direct = props.participantOnScreen?.user?.id
            ?? props.stream?.ownerId
            ?? props.participant?.user?.id;
        if (typeof direct !== "undefined" && /^\d+$/.test(String(direct))) return String(direct);
        // Owner id alone is ambiguous (channels have owners too):
        // only trust it next to a stream id.
        if (/^\d+$/.test(String(props.ownerId ?? "")) && props.streamId) return String(props.ownerId);
        return;
    } catch {
        return;
    }
}

// Loose anchors: only used after climbing from a fiber-less media node
// (the raw stream surface). Chat GIFs always carry fibers, so they never
// reach this branch.
function looseAnchor(props: any): string | undefined {
    try {
        const hit = strictAnchor(props);
        if (hit) return hit;
        if (!props || typeof props !== "object") return;
        if (/^\d+$/.test(String(props.userId ?? ""))) return String(props.userId);
        const u = props.user?.id;
        if (/^\d+$/.test(String(u ?? ""))) return String(u);
        return;
    } catch {
        return;
    }
}

function walkFiber(fiber: any, loose: boolean, maxDepth: number): string | undefined {
    try {
        let cur = fiber;
        for (let depth = 0; depth < maxDepth && cur; depth++) {
            try {
                const hit = loose ? looseAnchor(cur.memoizedProps) : strictAnchor(cur.memoizedProps);
                if (hit) return hit;
            } catch { /* ignore */ }
            cur = cur?.return;
        }
    } catch { /* ignore */ }
    return;
}

let lastShapesKey = "";

// Log unresolved videos' shapes, but only when the picture changed
// (menu opens often; the console shouldn't flood).
export function logTileShapesOnce() {
    try {
        if (typeof document === "undefined") return;
        const shapes: string[] = [];
        document.querySelectorAll("video").forEach(v => {
            try {
                shapes.push(shapeOf(v));
            } catch { /* ignore */ }
        });
        const key = shapes.join("|");
        if (key === lastShapesKey) return;
        lastShapesKey = key;
        console.info("[Yabdp4Nitro] tile shapes:", JSON.stringify(shapes.slice(0, 6)));
    } catch { /* ignore */ }
}

// Read the streamer id for a video tile:
// - React-managed video (camera previews, GIFs): strict anchors only, so
//   chat GIFs are never misattributed.
// - Fiber-less video (the media engine's raw stream surface): climb the
//   DOM to the nearest React-managed ancestor, then walk with loose
//   anchors. Returns undefined when nothing tile-like is found.
function fiberUserId(video: Element): string | undefined {
    try {
        const anyEl = video as any;
        const fiberKey = Object.keys(anyEl).find(k => k.startsWith("__reactFiber$"));
        if (fiberKey) return walkFiber(anyEl[fiberKey], false, 14);
        let node: Element | null = video.parentElement;
        for (let up = 0; up < 8 && node; up++) {
            try {
                const ak = Object.keys(node as any).find(k => k.startsWith("__reactFiber$"));
                if (ak) return walkFiber((node as any)[ak], true, 14);
            } catch { /* ignore */ }
            node = node.parentElement;
        }
    } catch { /* ignore */ }
    return;
}

// Style one video tile for its streamer. Skips tiles that already carry
// the right marker, so repeat sweeps are cheap. Logs once per user and
// value, so the console proves the style actually landed on a tile.
const appliedNote = new Map<string, number>();
function styleVideo(video: HTMLVideoElement) {
    try {
        const userId = fiberUserId(video);
        if (!userId) return;
        // Trust the marker only when the style is really ours; otherwise
        // repair (filter element may have been rebuilt meanwhile).
        if (video.getAttribute(TILE_ATTR) === userId && video.style.filter.includes(filterId(userId))) return;
        const pct = getSharpen(userId);
        if (pct > 0 && ensureFilter(userId, pct)) {
            video.setAttribute(TILE_ATTR, userId);
            video.style.filter = `url(#${filterId(userId)})`;
            if (appliedNote.get(userId) !== pct) {
                appliedNote.set(userId, pct);
                say("info", `sharpness ${pct}% applied to a tile`);
            }
        } else if (video.hasAttribute(TILE_ATTR) || video.style.filter.includes(FILTER_PREFIX)) {
            video.removeAttribute(TILE_ATTR);
            if (video.style.filter.includes(FILTER_PREFIX)) video.style.removeProperty("filter");
            appliedNote.delete(userId);
        }
    } catch { /* ignore */ }
}

// Walk all current videos (covers tiles that mounted before install or
// before a preference was set). Skips entirely when nobody wants
// sharpness and no tile carries our marker.
export function sweepTiles() {
    try {
        if (typeof document === "undefined") return;
        const prefs = (settings.store as any)?.sharpenPrefs as Record<string, number> | undefined;
        const wanted = prefs ? Object.values(prefs).some(v => clampPct(v) > 0) : false;
        if (!wanted && !document.querySelector(`[${TILE_ATTR}]`)) return;
        document.querySelectorAll("video").forEach(v => {
            try {
                styleVideo(v as HTMLVideoElement);
            } catch { /* ignore */ }
        });
    } catch { /* ignore */ }
}

function queueSweep() {
    try {
        if (sweepQueued) return;
        sweepQueued = true;
        const gen = installGen;
        const run = () => {
            sweepQueued = false;
            try {
                // Uninstalled while queued: never resurrect filters/tiles.
                if (gen !== installGen || !installed) return;
                sweepTiles();
            } catch { /* ignore */ }
        };
        if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(run);
        else setTimeout(run, 0);
    } catch { /* ignore */ }
}

// Discord ships its modules with getter-only exports and importers
// capture the originals, so runtime rebinding can't land. The DOM +
// fiber approach above needs none of that: no export tricks, no
// minified names.
export function uninstallSharpener() {
    const jobs = undo;
    undo = [];
    installed = false;
    installGen++;
    try {
        observer?.disconnect();
    } catch { /* ignore */ }
    observer = null;
    sweepQueued = false;
    for (const fn of jobs) {
        try {
            fn();
        } catch { /* ignore */ }
    }
    // Leave no stale styling behind: unmark tiles whose filter was ours.
    try {
        if (typeof document !== "undefined") {
            document.querySelectorAll(`[${TILE_ATTR}]`).forEach(node => {
                try {
                    const el = node as HTMLElement;
                    el.removeAttribute(TILE_ATTR);
                    if (el.style.filter.includes(FILTER_PREFIX)) el.style.removeProperty("filter");
                } catch { /* ignore */ }
            });
        }
    } catch { /* ignore */ }
    try {
        appliedNote.clear();
    } catch { /* ignore */ }
    try {
        defsSvg?.remove();
    } catch { /* ignore */ }
    defsSvg = null;
}

export function installSharpener(): boolean {
    try {
        uninstallSharpener();
        if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
            say("warn", "stream sharpener: no document available");
            return false;
        }
        const root = document.body ?? document.documentElement;
        if (!root) {
            say("warn", "stream sharpener: no document root");
            return false;
        }
        const obs = new MutationObserver(records => {
            try {
                for (const rec of records) {
                    rec.addedNodes.forEach(node => {
                        try {
                            if (!(node instanceof Element)) return;
                            if (node instanceof HTMLVideoElement) {
                                styleVideo(node);
                            } else if (typeof node.querySelectorAll === "function") {
                                // Style nested videos directly instead of a
                                // second full-document sweep.
                                node.querySelectorAll("video").forEach(v => {
                                    try {
                                        styleVideo(v as HTMLVideoElement);
                                    } catch { /* ignore */ }
                                });
                            }
                        } catch { /* ignore */ }
                    });
                }
            } catch { /* ignore */ }
        });
        obs.observe(root, { childList: true, subtree: true });
        observer = obs;
        undo.push(() => {
            try {
                obs.disconnect();
            } catch { /* ignore */ }
        });
        installed = true;
        say("info", "stream sharpener installed on dom-observer");
        // Tiles already on screen get styled immediately.
        sweepTiles();
        repaintKnown();
        return true;
    } catch (err) {
        say("warn", `stream sharpener: install threw (${String((err as Error)?.message ?? err)})`);
        try {
            uninstallSharpener();
        } catch { /* ignore */ }
        return false;
    }
}

// The overlay module may load after startup; retry on menu open.
export function ensureSharpener() {
    try {
        if (!installed) installSharpener();
    } catch { /* ignore */ }
}
