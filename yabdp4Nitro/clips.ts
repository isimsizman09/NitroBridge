/*
 * NitroBridge — Vencord port of YABDP4Nitro.
 * Copyright (c) 2026 isimsizman09
 * Inspired by YABDP4Nitro by Riolubruh (OSL-3.0, https://github.com/riolubruh/YABDP4Nitro).
 * Licensed under the Open Software License version 3.0 (OSL-3.0).
 * See LICENSE file for more information.
 */

// Yabdp4Nitro — clip conversion logic (clean-room rewrite).
// Inspired by YABDP4Nitro's clipsBypass (OSL-3.0). No copied code, same approach:
// video is copied as-is + fake clip tag, audio becomes a black-screen video,
// archives ride inside a video shell. This file never touches Discord
// (pure logic + FFmpeg calls), so it's covered by unit tests.

import { zipSync } from "fflate";

export const NORMAL_LIMIT = 20 * 1024 * 1024;
export const CLIP_LIMIT = 100 * 1024 * 1024;
export const CLIP_APP_ID = "1301689862256066560";
// Snowflake epoch Discord uses for clip ids (Jan 1, 2015).
export const SNOWFLAKE_EPOCH = 1420070400000;

// Fake clip tag (the bytes Discord needs to count it as a clip).
const UDTA_B64 = "AAAuLnV1aWShyFKZM0ZNuIjwg/V6daXv";

const UDTA = (() => {
    const bin = atob(UDTA_B64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
})();

export function udtaBytes(): Uint8Array {
    return UDTA.slice();
}

export type ClipJob = "skip" | "video" | "audio" | "zip";

export interface ClipOpts {
    video: boolean;
    forceClip: boolean;
    audio: boolean;
    forceAudio: boolean;
    zip: boolean;
}

// These types blow up in FFmpeg; the original skips them too.
const SKIPPED_TYPES = new Set([
    "video/3gp",
    "video/asf",
    "video/ivf",
    "video/mpeg",
    "audio/mid",
    "audio/basic",
    "audio/mpegurl",
    "audio/3gp"
]);

// Types that produce a .mov container (same list as the original).
const MOV_TYPES = new Set([
    "video/flv",
    "video/ogg",
    "video/wmv",
    "video/mov",
    "audio/wav",
    "audio/aiff",
    "audio/x-ms-wma",
    "audio/mpeg"
]);

// Archive types (original list, "application/" prefix stripped).
const ARCHIVE_MIMES = new Set([
    "x-7z-compressed",
    "x-bzip",
    "x-bzip2",
    "x-rar-compressed",
    "x-tar",
    "gzip",
    "x-gzip",
    "zip",
    "x-zip-compressed"
]);

const ARCHIVE_EXTS = [".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".tgz", ".tbz2", ".xz", ".zst"];

function isArchiveName(name: string) {
    const lower = name.toLowerCase();
    return ARCHIVE_EXTS.some(e => lower.endsWith(e));
}

function isArchiveMime(type: string) {
    return ARCHIVE_MIMES.has(type.replace("application/", ""));
}

function baseName(name: string) {
    const at = name.lastIndexOf(".");
    const base = at > 0 ? name.slice(0, at) : name;
    return base || "klip";
}

export function isSkippedType(type: string) {
    return SKIPPED_TYPES.has(type ?? "");
}

export function decideClip(
    file: { name: string; size: number; type: string },
    opts: ClipOpts
): ClipJob {
    const name = file.name ?? "";
    const size = file.size ?? 0;
    const type = (file.type ?? "").toLowerCase();
    if (!name || size <= 0 || size > CLIP_LIMIT) return "skip";
    if (isSkippedType(type)) return "skip";
    // Original else-if chain: video first, then audio, zip last.
    // The zip branch only runs between 20-100MB.
    if (type.startsWith("video/")) {
        if (opts.video && (size > NORMAL_LIMIT || opts.forceClip)) return "video";
    } else if (type.startsWith("audio/")) {
        if (opts.audio && (size > NORMAL_LIMIT || opts.forceAudio)) return "audio";
    }
    if (opts.zip && size >= NORMAL_LIMIT && size <= CLIP_LIMIT) return "zip";
    return "skip";
}

export function clipFileName(name: string, kind: ClipJob): string {
    if (kind === "audio" || kind === "video") return `${baseName(name)}.mp4`;
    if (kind === "zip") {
        // Archives keep their name and gain .mp4.
        if (isArchiveName(name)) return `${name}.mp4`;
        // Original rule: extensions with a digit (mp4, m4a, ...) get .zip on the
        // full name, plain ones (txt, pdf, ...) on the stem.
        const dot = name.lastIndexOf(".");
        const ext = dot > 0 ? name.slice(dot + 1) : "";
        if (/z?\d+/i.test(ext)) return `${name}.zip.mp4`;
        return `${baseName(name)}.zip.mp4`;
    }
    return name;
}

export interface ClipTag {
    id: bigint;
    createdAt: number;
    version: number;
    applicationName: string;
    applicationId: string;
    users: string[];
    clipMethod: string;
    length: number;
    thumbnail: string;
    filepath: string;
    name: string;
}

// Timestamp: 0 = zero, 1 = now, 2 = file date (the original default).
export function buildClipTag(
    meId: string,
    fileName: string,
    size: number,
    lastModified: number,
    stamp: number = 2
): ClipTag {
    const tag: ClipTag = {
        id: 0n,
        createdAt: SNOWFLAKE_EPOCH,
        version: 3,
        applicationName: "",
        applicationId: CLIP_APP_ID,
        users: meId ? [meId] : [],
        clipMethod: "manual",
        length: size,
        thumbnail: "",
        filepath: "",
        name: baseName(fileName)
    };
    try {
        if (stamp === 1) {
            const now = Date.now();
            tag.id = (BigInt(now) - BigInt(SNOWFLAKE_EPOCH)) << 22n;
            tag.createdAt = now;
        } else if (stamp === 2) {
            let ts = Number(lastModified) || Date.now();
            ts = Math.min(Math.max(ts, SNOWFLAKE_EPOCH), Date.now());
            tag.id = (BigInt(ts) - BigInt(SNOWFLAKE_EPOCH)) << 22n;
            tag.createdAt = ts;
        }
    } catch {
        tag.id = 0n;
    }
    return tag;
}

async function writeInput(ff: any, name: string, data: Uint8Array | File | Blob) {
    const buf = data instanceof Uint8Array
        ? data
        : new Uint8Array(await (data as Blob).arrayBuffer());
    await ff.writeFile(name, buf);
}

function outNameFor(type: string) {
    return MOV_TYPES.has(type) ? "out.mov" : "out.mp4";
}

// Unique working names: conversions can overlap (attach while another runs)
// and share one FFmpeg filesystem.
let tmpSeq = 0;

function tmpName(base: string) {
    tmpSeq = (tmpSeq + 1) % 1000000;
    const safe = String(base || "file").replace(/[^\w.-]/g, "_").slice(-80) || "file";
    return `${tmpSeq}_${safe}`;
}

function inNameFor(fileName: string, outName: string) {
    if (!fileName || fileName === outName) return tmpName("in_" + (fileName || "file"));
    return tmpName(fileName);
}

function appendUdta(raw: Uint8Array): Uint8Array {
    const out = new Uint8Array(raw.length + UDTA.length);
    out.set(raw, 0);
    out.set(UDTA, raw.length);
    return out;
}

async function finalizeClip(
    ff: any,
    raw: Uint8Array,
    file: File,
    kind: ClipJob,
    meId: string,
    stamp: number,
    emptyErr: string,
    finalSize?: number
) {
    if (!raw.length) throw new Error(emptyErr);
    const out = appendUdta(raw);
    const finalName = clipFileName(file.name, kind);
    return {
        file: new File([out as Uint8Array<ArrayBuffer>], finalName, { type: "video/mp4" }),
        clip: buildClipTag(meId, finalName, finalSize ?? file.size, file.lastModified || Date.now(), stamp)
    };
}

async function runFfmpeg(ff: any, inName: string, outName: string, args: string[]): Promise<Uint8Array> {
    try {
        await ff.exec(args);
        return new Uint8Array(await ff.readFile(outName) as unknown as ArrayBuffer);
    } finally {
        await ff.deleteFile(inName).catch(() => {});
        await ff.deleteFile(outName).catch(() => {});
    }
}

export async function transcodeVideo(ff: any, file: File, meId: string, stamp = 2) {
    const outName = tmpName(outNameFor(file.type));
    const inName = inNameFor(file.name, outName);
    await writeInput(ff, inName, file);
    const raw = await runFfmpeg(ff, inName, outName, [
        "-i", inName,
        "-c:v", "copy",
        "-c:a", "copy",
        "-c:s", "mov_text",
        "-dn",
        "-brand", "isom/avc1",
        "-movflags", "+faststart",
        "-map", "0",
        "-map_metadata", "-1",
        "-map_chapters", "-1",
        "-map", "-0:t",
        "-strict", "-2",
        outName
    ]);
    return finalizeClip(ff, raw, file, "video", meId, stamp, "empty video output", raw.length + UDTA.length);
}

export async function transcodeAudio(ff: any, file: File, meId: string, stamp = 2) {
    const outName = tmpName(outNameFor(file.type));
    const inName = inNameFor(file.name, outName);
    await writeInput(ff, inName, file);
    const raw = await runFfmpeg(ff, inName, outName, [
        "-i", inName,
        "-f", "lavfi",
        "-i", "color=c=black:s=300x100",
        "-shortest",
        "-fflags", "+shortest",
        "-map", "0:v?",
        "-map", "1:v",
        "-map", "0:a",
        "-disposition:v", "default",
        "-brand", "isom/avc1",
        "-movflags", "+faststart",
        "-map_metadata", "-1",
        "-dn",
        "-map_chapters", "-1",
        "-preset", "ultrafast",
        "-c:v", "libx264",
        "-c:a", "copy",
        "-strict", "-2",
        "-tune", "stillimage",
        "-r", "5",
        "-pix_fmt", "yuv420p",
        "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2",
        "-max_interleave_delta", "1",
        outName
    ]);
    return finalizeClip(ff, raw, file, "audio", meId, stamp, "empty audio output", raw.length + UDTA.length);
}

export async function transcodeZip(ff: any, file: File, meId: string, stamp = 2) {
    if (!file.size || file.size > CLIP_LIMIT) throw new Error("file out of clip range");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const archive = isArchiveName(file.name) || isArchiveMime(file.type ?? "");
    // Zip entries are bare names (no folder escapes, no control chars).
    const entryName = (file.name.split(/[/\\]/).pop() || "file").replace(/^\.+/, "").replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_").slice(0, 100) || "file";
    const payload = archive
        ? bytes
        : zipSync({ [entryName]: bytes }, { level: 6 });
    // Build a real short silent/black base video (not a single-frame image).
    const tmpOut = tmpName("output.mp4");
    let base: Uint8Array;
    try {
        await ff.exec([
            "-f", "lavfi",
            "-i", "color=c=black:s=128x96:duration=1",
            "-f", "lavfi",
            "-i", "anullsrc=r=44100:cl=mono",
            "-shortest",
            "-fflags", "+shortest",
            "-brand", "isom/avc1",
            "-movflags", "+faststart",
            "-map_metadata", "-1",
            "-preset", "ultrafast",
            "-vframes", "5",
            "-c:v", "mjpeg",
            tmpOut
        ]);
        base = new Uint8Array(await ff.readFile(tmpOut) as unknown as ArrayBuffer);
    } finally {
        await ff.deleteFile(tmpOut).catch(() => {});
    }
    if (!base!.length || !isMp4(base!)) throw new Error("zip base failed to render");
    const withTag = appendUdta(base!);
    const out = new Uint8Array(withTag.length + payload.length);
    out.set(withTag, 0);
    out.set(payload, withTag.length);
    const outName = clipFileName(file.name, "zip");
    return {
        file: new File([out as Uint8Array<ArrayBuffer>], outName, { type: "video/mp4" }),
        clip: buildClipTag(meId, outName, out.length, file.lastModified || Date.now(), stamp)
    };
}

function isMp4(data: Uint8Array): boolean {
    return data.length > 8
        && data[4] === 0x66 && data[5] === 0x74
        && data[6] === 0x79 && data[7] === 0x70;
}
