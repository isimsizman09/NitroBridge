/*
 * NitroBridge — Vencord port of YABDP4Nitro.
 * Copyright (c) 2026 isimsizman09
 * Inspired by YABDP4Nitro by Riolubruh (OSL-3.0, https://github.com/riolubruh/YABDP4Nitro).
 * Licensed under the Open Software License version 3.0 (OSL-3.0).
 * See LICENSE file for more information.
 */

// Yabdp4Nitro — profile tricks, 3y3 hidden-text decoding (clean-room rewrite).
// Idea: read bio-hidden data and apply it to profiles.
// Inspired by YABDP4Nitro (OSL-3.0) and Vencord's FakeProfileThemes. No copied code.
//
// Code formats (compatible with the original):
//   renk:    "[#aabbcc,#ddeeff]"
//   effect:  "fx<skuId>"
//   frame:   "pf<skuId>"
//   deco:    "/a<skuId>"
//   plate:   "n{skuId,palette}"
//   style:   "S{font,effect,colors...}"
//   photo:   "P{imgurId}"
//   banner:  "B{imgurId}"
// Every code carries an invisible signature; unsigned matches are ignored
// (so plain words like "gfx123" don't grant fake features).

const HIDDEN_LO = 0xe0000;
const HIDDEN_RANGE = 0x200;

// Same bio gets read over and over (member list); cache the decode in bounds.
const revealCache = new Map<string, string | null>();

export function revealHiddenCached(text: string | null | undefined): string | null {
    if (!text) return null;
    const hit = revealCache.get(text);
    if (hit !== undefined) return hit;
    const out = revealHidden(text);
    revealCache.set(text, out);
    if (revealCache.size > 200) {
        const first = revealCache.keys().next().value;
        if (first !== undefined) revealCache.delete(first);
    }
    return out;
}

export function clearRevealCache() {
    revealCache.clear();
}

// Map chars in the hidden range back to plain letters.
export function revealHidden(text: string | null | undefined): string | null {
    if (!text) return null;
    let found = false;
    const out = [...text].map(ch => {
        const cp = ch.codePointAt(0)!;
        if (cp > HIDDEN_LO && cp < HIDDEN_LO + HIDDEN_RANGE) {
            found = true;
            return String.fromCodePoint(cp - HIDDEN_LO);
        }
        return ch;
    }).join("");
    return found ? out : null;
}

// Map plain text into hidden text (ASCII only).
export function hidePlain(text: string): string {
    return [...text].map(ch => {
        const cp = ch.codePointAt(0)!;
        if (cp > 0 && cp < 127) return String.fromCodePoint(cp + HIDDEN_LO);
        return ch;
    }).join("");
}

// Invisible signature prepended to every code, for original compatibility.
// The escapes below match the original markers one-to-one
// (YABDP4Nitro.plugin.js lines 930, 1029, 1043, 1048, 1086, 1105, 1114).
// They're invisible chars: never typed by hand, the copy button adds them.
export const MARK = { theme: "\u{E005B}\u{E0023}", effect: "\u{E0066}\u{E0078}", frame: "\u{E0070}\u{E0066}", style: "\u{E0053}\u{E007B}", decor: "\u{E002F}\u{E0061}", plate: "\u{E006E}\u{E007B}", banner: "\u{E0042}\u{E007B}", photo: "\u{E0050}\u{E007B}" } as const;

function hideWith(marker: string, payload: string) {
    return " " + marker + hidePlain(payload);
}

function cleanId(raw: string | undefined, maxLen = 32): string | null {
    if (!raw) return null;
    const v = raw.trim();
    return /^\d+$/.test(v) && v.length <= maxLen ? v : null;
}

function cleanToken(raw: string | undefined, maxLen = 32): string | null {
    if (!raw) return null;
    const v = raw.trim();
    return /^[\w-]+$/.test(v) && v.length <= maxLen ? v : null;
}

// ---- generators (used by the copy buttons in settings) ----
export const makeThemeCode = (primaryHex: string, accentHex: string) =>
    hideWith(MARK.theme, `[#${primaryHex},#${accentHex}]`);
export const makeEffectCode = (skuId: string) => hideWith(MARK.effect, `fx${skuId}`);
export const makeFrameCode = (skuId: string) => hideWith(MARK.frame, `pf${skuId}`);
export const makeDecorCode = (skuId: string) => hideWith(MARK.decor, `/a${skuId}`);
export const makePlateCode = (skuId: string, palette: string) => hideWith(MARK.plate, `n{${skuId},${palette}}`);
export const makeStyleCode = (fontId: string, effectId: string, colors: string) =>
    hideWith(MARK.style, `S{${fontId},${effectId}${colors ? "," + colors : ""}}`);
export const makeBannerCode = (imgurId: string) => hideWith(MARK.banner, `B{${imgurId}}`);
export const makePhotoCode = (imgurId: string) => hideWith(MARK.photo, `P{${imgurId}}`);

// ---- readers ----
// bio: raw bio text. Each reader finds its own marker first and only decodes
// what comes AFTER it, so the decoded marker letters can't mix with the
// payload regex (e.g. "n{" + "n{...}").

// Return the decoded text after the marker.
function afterMark(bio: string | null | undefined, mark: keyof typeof MARK): string | null {
    if (!bio) return null;
    const at = bio.indexOf(MARK[mark]);
    if (at < 0) return null;
    return revealHiddenCached(bio.slice(at + MARK[mark].length));
}

export function themeColorsOf(bio: string | null | undefined): [number, number] | null {
    const r = afterMark(bio, "theme");
    if (!r) return null;
    const m = r.match(/\[#([0-9a-fA-F]{1,6}),#([0-9a-fA-F]{1,6})\]/);
    if (!m) return null;
    const a = parseInt(m[1], 16);
    const b = parseInt(m[2], 16);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return [a, b];
}

export function effectOf(bio: string | null | undefined): string | null {
    const r = afterMark(bio, "effect");
    return cleanId(r?.match(/fx(\d+)/)?.[1]);
}

export function frameOf(bio: string | null | undefined): string | null {
    const r = afterMark(bio, "frame");
    return cleanId(r?.match(/pf(\d+)/)?.[1]);
}

export function decorOf(bio: string | null | undefined): string | null {
    const r = afterMark(bio, "decor");
    return cleanId(r?.match(/\/a(\d+)/)?.[1]);
}

export function plateOf(bio: string | null | undefined): [string, string] | null {
    const r = afterMark(bio, "plate");
    const m = r?.match(/n\{([^,}]+),([^}]+)\}/);
    if (!m) return null;
    const sku = cleanId(m[1]);
    const pal = cleanToken(m[2]);
    return sku && pal ? [sku, pal] : null;
}

export interface NameStyle {
    fontId: number;
    effectId: number;
    colors: number[];
}

export function styleOf(bio: string | null | undefined): NameStyle | null {
    const r = afterMark(bio, "style");
    const m = r?.match(/S\{([^}]+)\}/);
    if (!m) return null;
    const parts = m[1].split(",").map(s => Number(s.trim()));
    if (parts.length < 2 || parts.some(n => !Number.isInteger(n) || n < 0)) return null;
    return { fontId: parts[0], effectId: parts[1], colors: parts.slice(2, 10).map(c => Math.min(c, 0xFFFFFF)) };
}

export function bannerOf(bio: string | null | undefined): string | null {
    const r = afterMark(bio, "banner");
    const hash = r?.match(/B\{([^}]+)\}/)?.[1]?.trim();
    return hash && /^[\w-]{2,64}$/.test(hash) ? `https://i.imgur.com/${hash}.gif` : null;
}

export function photoOf(bio: string | null | undefined): string | null {
    const r = afterMark(bio, "photo");
    const hash = r?.match(/P\{([^}]+)\}/)?.[1]?.trim();
    return hash && /^[\w-]{2,64}$/.test(hash) ? `https://i.imgur.com/${hash}.gif` : null;
}

// Any hidden marks in this bio? (fast pre-check, no allocation)
export function hasHiddenMark(bio: string | null | undefined): boolean {
    if (!bio) return false;
    for (const ch of bio) {
        const cp = ch.codePointAt(0)!;
        if (cp > HIDDEN_LO && cp < HIDDEN_LO + HIDDEN_RANGE) return true;
    }
    return false;
}

// Pull the id out of an Imgur code or full link (".../8oGS6kV.png" -> "8oGS6kV").
export function extractImgurId(input: string | undefined): string | null {
    if (!input) return null;
    const v = input.trim();
    const m = v.match(/(?:imgur\.com\/(?:a\/|gallery\/)?)([A-Za-z0-9]{2,64})/);
    const id = m ? m[1] : v;
    return /^[\w-]{2,64}$/.test(id) ? id : null;
}

// High FPS values for the list + the custom one from settings.
// Pure function (testable); called with the setting at patch time.
export function extraFpsValues(custom: unknown) {
    const out = [90, 120, 144, 180, 240];
    const c = Math.round(Number(custom));
    if (Number.isFinite(c) && c >= 5 && c <= 240 && !out.includes(c)) out.push(c);
    return out.sort((a, b) => a - b);
}

// Plugin badges (only fellow plugin users see them).
export interface MiniBadge {
    id: string;
    description: string;
    iconSrc: string;
    link?: string;
}

const DEV_IDS = ["359063827091816448", "917630027477159986"];
const SILLY_IDS = ["917630027477159986"];
const SERA_IDS = ["1323433010858557523"];
const THANKS_IDS = ["122072911455453184", "760274365853335563", "482224256730791967", "1106012563835195412"];

export function badgesFor(userId: string, marked: boolean): MiniBadge[] {
    const out: MiniBadge[] = [];
    if (DEV_IDS.includes(userId)) {
        out.push({
            id: "yabdp_developer",
            description: "YABDP4Nitro Developer!",
            iconSrc: "https://raw.githubusercontent.com/riolubruh/riolubruh.github.io/main/img/big_yoshi.gif",
            link: "https://github.com/riolubruh/YABDP4Nitro#contributors"
        });
    }
    if (SILLY_IDS.includes(userId)) {
        out.push({
            id: "yabdp_silly",
            description: "Honk.",
            iconSrc: "https://raw.githubusercontent.com/riolubruh/riolubruh.github.io/refs/heads/main/img/yabdp_silly.png"
        });
    }
    if (SERA_IDS.includes(userId)) {
        out.push({
            id: "yabdp_sera",
            description: "sera so silly ;3",
            iconSrc: "https://raw.githubusercontent.com/riolubruh/riolubruh.github.io/refs/heads/main/img/yabdp_sera.gif"
        });
    }
    if (THANKS_IDS.includes(userId)) {
        out.push({
            id: "yabdp_contributor",
            description: "YABDP4Nitro Contributor!",
            iconSrc: "https://raw.githubusercontent.com/riolubruh/riolubruh.github.io/main/img/big_yoshi_red.gif",
            link: "https://github.com/riolubruh/YABDP4Nitro#contributors"
        });
    }
    if (marked && !out.length) {
        out.push({
            id: "yabdp_user",
            description: "A fellow YABDP4Nitro user!",
            iconSrc: "https://raw.githubusercontent.com/riolubruh/riolubruh.github.io/main/badge.png",
            link: "https://github.com/riolubruh/YABDP4Nitro"
        });
    }
    return out;
}
