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

// Yabdp4Nitro settings. Grouped and collapsible: tapping a section header
// hides/shows the settings below it. The state is persisted.
// Display language follows Discord: Turkish client -> Turkish, else English.

import { definePluginSettings } from "@api/Settings";
import { GithubIcon } from "@components/Icons";
import { copyWithToast } from "@utils/discord";
import { OptionType } from "@utils/types";
import { Button, Forms, TextInput, UserStore, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { T } from "./lang";
import {
    DECOR_PRESETS,
    EFFECT_PRESETS,
    extractSkuId,
    PLATE_PALETTES,
    PLATE_PRESETS,
    shopStaticUrl,
    THEME_PRESETS,
} from "./presets";
import {
    extractImgurId,
    makeBannerCode,
    makeDecorCode,
    makeEffectCode,
    makeFrameCode,
    makePhotoCode,
    makePlateCode,
    makeStyleCode,
    makeThemeCode,
} from "./profile";

const EMOJI_SIZES = [16, 32, 48, 56, 64, 96, 128, 160, 256, 512];

// Section open/closed state lives in a normal (hidden) setting so it
// survives reloads. Default: everything collapsed.
const SHUT_KEY = { emoji: "uiEmojiShut", profile: "uiProfileShut", stream: "uiStreamShut", misc: "uiMiscShut", sticker: "uiStickerShut", clips: "uiClipsShut" } as const;

function isShut(id: keyof typeof SHUT_KEY) {
    try {
        return (settings.store[SHUT_KEY[id]] as boolean) ?? true;
    } catch {
        return true;
    }
}

function SectionHead({ id, title, desc }: { id: keyof typeof SHUT_KEY; title: string; desc: string; }) {
    const snap = settings.use() as unknown as Record<string, boolean>;
    const shut = snap[SHUT_KEY[id]] ?? true;
    const toggle = () => {
        settings.store[SHUT_KEY[id]] = !shut;
    };
    return (
        <div onClick={toggle} style={{ cursor: "pointer", marginTop: 12 }}>
            <Forms.FormTitle tag="h3">{shut ? "▸" : "▾"} {title}</Forms.FormTitle>
            <Forms.FormText>{desc}</Forms.FormText>
        </div>
    );
}

export const settings = definePluginSettings({
    secEmoji: {
        type: OptionType.COMPONENT,
        component: () => <SectionHead id="emoji" title="Emoji" desc={T("Başka sunucuların emojilerini gönderme. Başlığa basarak aç/kapat.", "Send emojis from other servers. Tap the header to collapse/expand.")} />
    },
    emojiBypass: {
        get description() { return T("Başka sunucunun emojilerini gönder", "Send other servers' emojis"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("emoji")
    },
    bypassType: {
        get description() { return T("Yükleme = herkeste tam boy ve hareketli (önerilir, dosya kotası yer). Bağlantı = hızlı ama karşıda küçük görünür. Çıplak adres = klasik görünüm.", "Upload = full size and animated everywhere (recommended, uses file quota). Link = fast but small for others. Bare URL = classic look."); },
        type: OptionType.SELECT,
        default: "upload",
        get options() {
            return [
                { label: T("Dosya olarak yükle", "Upload as file"), value: "upload" },
                { label: T("Bağlantı olarak gönder", "Send as link"), value: "link" },
                { label: T("Çıplak adres (klasik)", "Bare URL (classic)"), value: "bare" }
            ];
        },
        hidden: () => isShut("emoji")
    },
    bypassValid: {
        get description() { return T("Çalışan emojiyi atla (kapalıysa kullanılabilir emojiler de dönüştürülür)", "Skip working emojis (when off, usable emojis get converted too)"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: () => isShut("emoji")
    },
    soundmoji: {
        get description() { return T("Sesli emojileri ses dosyası olarak gönder (orijinalde kapalı gelir)", "Send soundmojis as audio files (off in the original)"); },
        type: OptionType.BOOLEAN,
        default: false,
        restartNeeded: true,
        hidden: () => isShut("emoji")
    },
    editEmoji: {
        get description() { return T("Düzenlerken bağlantıları emoji koduna geri çevir", "Turn links back into emoji codes when editing"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("emoji")
    },
    emojiSize: {
        get description() { return T("Gönderilen emoji boyutu", "Sent emoji size"); },
        type: OptionType.SELECT,
        default: 64,
        options: EMOJI_SIZES.map(s => ({ label: `${s}px`, value: s })),
        hidden: () => isShut("emoji")
    },
    pngMode: {
        get description() { return T("Hareketsiz emojide PNG kullan (kapalıysa WEBP)", "Use PNG for static emojis (WEBP when off)"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: () => isShut("emoji")
    },
    showAsEmoji: {
        get description() { return T("Gönderdiğin bağlantıyı sende gerçek emoji gibi göster", "Show your links as real emojis on your side"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: () => isShut("emoji")
    },

    secProfile: {
        type: OptionType.COMPONENT,
        component: () => <SectionHead id="profile" title={T("Profil", "Profile")} desc={T("Bio'daki gizli kodlarla sahte tema, efekt, çerçeve, rozet.", "Fake themes, effects, frames and badges from hidden bio codes.")} />
    },
    fakeThemes: {
        get description() { return T("Bio'daki gizli renklerle sahte profil teması göster", "Show fake profile themes from hidden bio colors"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: () => isShut("profile")
    },
    showBadges: {
        get description() { return T("Eklenti rozetlerini göster (sadece eklenti olanlar görür)", "Show plugin badges (only visible to plugin users)"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: () => isShut("profile")
    },
    profileEffects: {
        get description() { return T("Bio'daki gizli kodla sahte profil efekti göster", "Show fake profile effects from hidden bio codes"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: () => isShut("profile")
    },
    profileFrames: {
        get description() { return T("Bio'daki gizli kodla sahte profil çerçevesi göster", "Show fake profile frames from hidden bio codes"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: () => isShut("profile")
    },
    hideAllEffects: {
        get description() { return T("Tüm profil efektlerini gizle (kalabalıksa)", "Hide all profile effects (if things get busy)"); },
        type: OptionType.BOOLEAN,
        default: false,
        hidden: () => isShut("profile")
    },
    displayStyles: {
        get description() { return T("Bio'daki gizli kodla sahte isim süsü göster", "Show fake name styles from hidden bio codes"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("profile")
    },
    avatarDecos: {
        get description() { return T("Bio'daki gizli kodla sahte avatar süsü göster", "Show fake avatar decorations from hidden bio codes"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("profile")
    },
    customPhotos: {
        get description() { return T("Bio'daki gizli kodla sahte profil fotoğrafı göster (Imgur)", "Show fake profile photos from hidden bio codes (Imgur)"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("profile")
    },
    userPfp: {
        get description() { return T("Fotoğraf bulunamazsa userpfp veritabanına bak (sahte fotoğraf açıkken çalışır)", "Fall back to the userpfp database when no photo is found (needs fake photos)"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("profile")
    },
    nameplates: {
        get description() { return T("Bio'daki gizli kodla sahte isim plakası göster", "Show fake nameplates from hidden bio codes"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("profile")
    },
    fakeBanners: {
        get description() { return T("Bio'daki gizli kodla sahte kapak fotoğrafı göster (Imgur)", "Show fake banners from hidden bio codes (Imgur)"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("profile")
    },
    profileV2: {
        get description() { return T("Herkesin profilini yeni görünüme zorla", "Force the new profile layout on everyone"); },
        type: OptionType.BOOLEAN,
        default: false,
        hidden: () => isShut("profile")
    },
    userBg: {
        get description() { return T("Kapak bulunamazsa usrbg veritabanına bak (sahte kapak açıkken çalışır)", "Fall back to the usrbg database when no banner is found (needs fake banners)"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("profile")
    },
    voiceTile: {
        get description() { return T("Arama kutucuklarında sahte kapağı arka plan yap", "Use fake banners as voice tile backgrounds"); },
        type: OptionType.BOOLEAN,
        default: false,
        restartNeeded: true,
        hidden: () => isShut("profile")
    },
    fetchOnScroll: {
        get description() { return T("Sohbette görünenlerin profillerini otomatik getir (bio kodları profil açmadan işlesin)", "Auto-fetch profiles of visible chat members (so bio codes work without opening profiles)"); },
        type: OptionType.BOOLEAN,
        default: false,
        hidden: () => isShut("profile")
    },
    ignores: {
        type: OptionType.CUSTOM,
        default: {}
    },

    secStream: {
        type: OptionType.COMPONENT,
        component: () => <SectionHead id="stream" title={T("Yayın", "Stream")} desc={T("Yayın kalite kilitleri + özel bit hızı/çözünürlük/FPS. Kilitler Discord kurallarına takılabilir, dikkatli kullan.", "Stream quality unlocks + custom bitrate/resolution/FPS. Unlocks can trip Discord rules, use carefully.")} />
    },
    streamUnlock: {
        get description() { return T("Yüksek kalite yayın ve video yükleme kilitlerini aç (reklam şeridi de gizlenir, hesap riski için dikkatli kullan)", "Unlock high-quality streaming and video uploads (also hides the upsell banner; risky for your account, be careful)"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("stream")
    },
    customBitrate: {
        get description() { return T("Özel bit hızı kullan (yayın ve ses kalitesini elle ayarla)", "Use custom bitrates (tune stream and voice quality manually)"); },
        type: OptionType.BOOLEAN,
        default: false,
        hidden: () => isShut("stream")
    },
    minBitrate: {
        get description() { return T("En düşük bit hızı (kbps). -1 = Discord seçsin", "Minimum bitrate (kbps). -1 = let Discord decide"); },
        type: OptionType.NUMBER,
        default: -1,
        hidden: () => isShut("stream") || !settings.store.customBitrate
    },
    targetBitrate: {
        get description() { return T("Hedef bit hızı (kbps). -1 = Discord seçsin", "Target bitrate (kbps). -1 = let Discord decide"); },
        type: OptionType.NUMBER,
        default: -1,
        hidden: () => isShut("stream") || !settings.store.customBitrate
    },
    maxBitrate: {
        get description() { return T("En yüksek bit hızı (kbps). -1 = Discord seçsin", "Maximum bitrate (kbps). -1 = let Discord decide"); },
        type: OptionType.NUMBER,
        default: -1,
        hidden: () => isShut("stream") || !settings.store.customBitrate
    },
    voiceBitrate: {
        get description() { return T("Sesli sohbet bit hızı (kbps). Yayın kilidi açıkken uygulanır. -1 = Discord seçsin", "Voice chat bitrate (kbps). Applies with the stream unlock. -1 = let Discord decide"); },
        type: OptionType.NUMBER,
        default: -1,
        hidden: () => isShut("stream")
    },
    customRes: {
        get description() { return T("Özel yayın yüksekliği (px, en çok 2160, yatay yayın). -1 = Discord seçsin", "Custom stream height (px, up to 2160, landscape). -1 = let Discord decide"); },
        type: OptionType.NUMBER,
        default: 1440,
        hidden: () => isShut("stream")
    },
    customFps: {
        get description() { return T("Özel yayın FPS'i (en çok 240, listeye anında eklenir). -1 = Discord seçsin", "Custom stream FPS (up to 240, added to the list live). -1 = let Discord decide"); },
        type: OptionType.NUMBER,
        default: 60,
        hidden: () => isShut("stream")
    },
    sharpenStreams: {
        get description() { return T("Yayınlara sağ-tık netlik kaydırıcısı ekle (kişi bazında)", "Add a right-click sharpness slider to streams (per user)"); },
        type: OptionType.BOOLEAN,
        default: false,
        restartNeeded: true,
        hidden: () => isShut("stream")
    },
    sharpenPrefs: {
        type: OptionType.CUSTOM,
        default: {}
    },
    videoCodec: {
        get description() { return T("Yayın codecini zorla (ileri düzey). Yanlış codec karşıda sonsuz yükleme yapar!", "Force the stream video codec (advanced). A wrong codec loads forever for viewers!"); },
        type: OptionType.SELECT,
        default: -1,
        restartNeeded: true,
        get options() {
            return [
                { label: T("Otomatik (önerilir)", "Automatic (recommended)"), value: -1 },
                { label: "AV1", value: 0 },
                { label: "H265", value: 1 },
                { label: "H264", value: 2 },
                { label: "VP8", value: 3 }
            ];
        },
        hidden: () => isShut("stream")
    },

    secSticker: {
        type: OptionType.COMPONENT,
        component: () => <SectionHead id="sticker" title={T("Çıkartma", "Stickers")} desc={T("Başka sunucuların çıkartmalarını dosya olarak gönderme.", "Send other servers' stickers as files.")} />
    }, stickerBypass: {
        get description() { return T("Başka sunucunun çıkartmasını dosya olarak gönder (orijinalde kapalı gelir)", "Send other servers' stickers as files (off in the original)"); },
        type: OptionType.BOOLEAN,
        default: false,
        restartNeeded: true,
        hidden: () => isShut("sticker")
    },
    forceStickers: {
        get description() { return T("Çıkartmaların kilidini aç (sadece gösterir, gönderme dosya yolunu kullanır)", "Force stickers unlocked (display only, sending still uses the file path)"); },
        type: OptionType.BOOLEAN,
        default: false,
        restartNeeded: true,
        hidden: () => isShut("sticker")
    },

    secClips: {
        type: OptionType.COMPONENT,
        component: () => <SectionHead id="clips" title="Clips" desc={T("Büyük dosyaları klip gibi gönderme (video/ses/zip). İlk kullanımda dönüştürücü iner.", "Send large files as clips (video/audio/zip). The converter downloads on first use.")} />
    },
    useClipBypass: {
        get description() { return T("Video dosyalarında 100MB klip kilidi", "100MB clip limit for video files"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("clips")
    },
    clipTimestamp: {
        get description() { return T("Klibin üzerindeki tarih ne olsun (sıfır = 2015, şimdi = bugün, dosya = dosyanın tarihi)", "Which date goes on the clip (zero = 2015, now = today, file = the file's date)"); },
        type: OptionType.SELECT,
        default: 2,
        get options() {
            return [
                { label: T("Sıfır (1 Ocak 2015)", "Zero (Jan 1, 2015)"), value: 0 },
                { label: T("Şimdi", "Now"), value: 1 },
                { label: T("Dosyanın tarihi", "File date"), value: 2 }
            ];
        },
        hidden: () => isShut("clips")
    },
    forceClip: {
        get description() { return T("Küçük videoları da klip yap", "Clip small videos too"); },
        type: OptionType.BOOLEAN,
        default: false,
        hidden: () => isShut("clips")
    },
    useAudioClipBypass: {
        get description() { return T("Ses dosyalarında 100MB klip kilidi", "100MB clip limit for audio files"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("clips")
    },
    forceAudioClip: {
        get description() { return T("Küçük sesleri de klip yap", "Clip small audio files too"); },
        type: OptionType.BOOLEAN,
        default: false,
        hidden: () => isShut("clips")
    },
    zipClip: {
        get description() { return T("Herhangi bir dosyayı video kılığında zip yap (poliglot)", "Pack any file as a video-looking zip (polyglot)"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("clips")
    },

    secMisc: {
        type: OptionType.COMPONENT,
        component: () => <SectionHead id="misc" title={T("Diğer", "Misc")} desc={T("Renkli tema ve uygulama simgesi kilitleri.", "Colored theme and app icon unlocks.")} />
    },
    clientThemes: {
        get description() { return T("Nitro renkli temalarını kilitsiz kullan", "Use Nitro's colored themes without Nitro"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("misc")
    },
    appIcons: {
        get description() { return T("Nitro uygulama simgelerini kilitsiz kullan", "Use Nitro's app icons without Nitro"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("misc")
    },
    appIcon: {
        get description() { return T("Uygulama simgesi kimliği (Discord'un simge listesinden geçerli bir kimlik yaz)", "App icon ID (a valid ID from Discord's icon list)"); },
        type: OptionType.STRING,
        default: "AppIcon",
        hidden: () => isShut("misc") || !settings.store.appIcons
    },
    premiumType: {
        get description() { return T("Nitro durumunu istemcide değiştir (kilitler açılır/kapanır, bilmeden elleme)", "Spoof the client-side Nitro status (unlocks/locks things, leave alone if unsure)"); },
        type: OptionType.SELECT,
        default: -1,
        restartNeeded: true,
        get options() {
            return [
                { label: T("Kapalı (gerçek durum)", "Off (real status)"), value: -1 },
                { label: T("Normal kullanıcı", "Free user"), value: 0 },
                { label: "Nitro Basic", value: 3 },
                { label: "Nitro Classic", value: 1 },
                { label: "Nitro", value: 2 }
            ];
        },
        hidden: () => isShut("misc")
    },
    videoFilter: {
        get description() { return T("Özel kamera arka planı kullan (bağlantı + tür aşağıda)", "Use a custom camera background (link + type below)"); },
        type: OptionType.BOOLEAN,
        default: false,
        hidden: () => isShut("misc")
    },
    videoFilterLink: {
        get description() { return T("Kamera arka plan bağlantısı (CDN bağlantısı önerilir)", "Camera background link (a CDN link works best)"); },
        type: OptionType.STRING,
        default: "",
        hidden: () => isShut("misc") || !settings.store.videoFilter
    },
    videoFilterType: {
        get description() { return T("Arka plan türü (video ise mp4 seç)", "Background type (mp4 for videos)"); },
        type: OptionType.SELECT,
        default: "png",
        get options() {
            return [
                { label: T("Resim", "Image"), value: "png" },
                { label: T("Video (mp4)", "Video (mp4)"), value: "mp4" }
            ];
        },
        hidden: () => isShut("misc") || !settings.store.videoFilter
    },
    extraMenus: {
        get description() { return T("Mesaj sağ-tık ek menüsü (tüm ekleri indirme)", "Extra message right-click menu (download all attachments)"); },
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true,
        hidden: () => isShut("misc")
    },

    uiEmojiShut: {
        get description() { return T("Emoji bölümünü kapalı tut", "Keep the Emoji section collapsed"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true
    },
    uiProfileShut: {
        get description() { return T("Profil bölümünü kapalı tut", "Keep the Profile section collapsed"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true
    },
    uiStreamShut: {
        get description() { return T("Yayın bölümünü kapalı tut", "Keep the Stream section collapsed"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true
    },
    uiMiscShut: {
        get description() { return T("Diğer bölümünü kapalı tut", "Keep the Misc section collapsed"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true
    },
    uiStickerShut: {
        get description() { return T("Çıkartma bölümünü kapalı tut", "Keep the Stickers section collapsed"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true
    },
    uiClipsShut: {
        get description() { return T("Clips bölümünü kapalı tut", "Keep the Clips section collapsed"); },
        type: OptionType.BOOLEAN,
        default: true,
        hidden: true
    },
});

// ---- Profile code settings screen (shown at the top of the plugin settings) ----

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode; }) {
    return (
        <div style={{ marginBottom: 16 }}>
            <Forms.FormTitle tag="h4">{label}</Forms.FormTitle>
            <Forms.FormText>{hint}</Forms.FormText>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
        </div>
    );
}

function CopyBtn({ make, valid }: { make: () => string; valid: boolean; }) {
    return (
        <Button
            size={Button.Sizes.SMALL}
            disabled={!valid}
            onClick={() => {
                try {
                    copyWithToast(make(), T("Gizli kod kopyalandı — bio'na yapıştır", "Hidden code copied — paste it into your bio"));
                } catch { /* ignore */ }
            }}
        >
            {T("Gizli kodu kopyala", "Copy hidden code")}
        </Button>
    );
}

const isDigits = (v: string) => /^\d{1,32}$/.test(v.trim());
const isHex = (v: string) => /^[0-9a-fA-F]{1,6}$/.test(v.trim().replace("#", ""));
const isToken = (v: string) => /^[\w-]{1,32}$/.test(v.trim());

// ---- Ready-made number galleries (preview + pick). UI only: they just
// fill the text boxes above them. Code generation is untouched. ----

function GalleryShell({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode; }) {
    return (
        <div style={{ flexBasis: "100%", marginTop: 2 }}>
            <div onClick={onToggle} style={{ cursor: "pointer" }}>
                <Forms.FormText>
                    {open ? "▾" : "▸"} {T("Hazır numaralar (önizlemeli) — seçmek için dokun", "Ready-made IDs (with previews) — tap to pick")}
                </Forms.FormText>
            </div>
            {open && (
                <div>
                    <Forms.FormText>
                        {T(
                            "Numaraları Discord Mağaza'daki ürün bağlantılarında da bulabilirsin — bağlantının tamamını kutuya yapıştırman yeterli, numara kendi ayıklanır.",
                            "You can also find IDs in Discord Shop product links — just paste the whole link into the box, the number is extracted for you."
                        )}
                    </Forms.FormText>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>{children}</div>
                </div>
            )}
        </div>
    );
}

function PresetTile({ img, name, sku, selected, onPick }: { img: string; name: string; sku: string; selected: boolean; onPick: () => void; }) {
    const [broken, setBroken] = useState(false);
    return (
        <div
            onClick={onPick}
            title={`${name} — ${sku}`}
            style={{
                width: 78,
                padding: 6,
                borderRadius: 10,
                cursor: "pointer",
                textAlign: "center",
                border: selected ? "2px solid #5865f2" : "2px solid transparent",
                background: selected ? "rgba(88,101,242,0.12)" : "transparent",
            }}
        >
            {broken ? (
                <div style={{ width: 56, height: 56, margin: "0 auto", borderRadius: 10, background: "rgba(128,128,128,0.2)" }} />
            ) : (
                <img
                    src={img}
                    alt={name}
                    width={56}
                    height={56}
                    loading="lazy"
                    onError={() => setBroken(true)}
                    style={{ borderRadius: 10, objectFit: "cover", display: "block", margin: "0 auto" }}
                />
            )}
            <div style={{ fontSize: 11, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        </div>
    );
}

// Live preview of whatever number is currently typed (decorations,
// frames, nameplates). If the number is unknown the image hides itself
// and a quiet note remains — nothing breaks.
function SkuPreview({ sku }: { sku: string; }) {
    const [broken, setBroken] = useState(false);
    const clean = sku.trim();
    if (!isDigits(clean)) return null;
    if (broken) {
        return (
            <Forms.FormText>
                {T("Bu numaranın önizlemesi yok — yine de kopyalayıp deneyebilirsin.", "No preview for this ID — you can still copy and try it.")}
            </Forms.FormText>
        );
    }
    return (
        <img
            key={clean}
            src={shopStaticUrl(clean)}
            alt=""
            width={48}
            height={48}
            loading="lazy"
            onError={() => setBroken(true)}
            style={{ borderRadius: 10, objectFit: "cover" }}
            title={T("Canlı önizleme", "Live preview")}
        />
    );
}

const ORIGINAL_REPO = "https://github.com/riolubruh/YABDP4Nitro";

function CreditRow() {
    let avatar: string | undefined;
    let name = "Yabdp4Nitro";
    try {
        const me = UserStore.getCurrentUser();
        if (me) {
            name = (me as any).globalName ?? me.username ?? name;
            const hash = (me as any).avatar as string | undefined;
            if (me.id && hash) {
                const ext = hash.startsWith("a_") ? "gif" : "png";
                avatar = `https://cdn.discordapp.com/avatars/${me.id}/${hash}.${ext}?size=64`;
            }
        }
    } catch { /* ignore */ }
    return (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
            {avatar ? <img src={avatar} width={40} height={40} style={{ borderRadius: "50%" }} alt="" /> : null}
            <div style={{ flex: 1 }}>
                <Forms.FormTitle tag="h3">{name}</Forms.FormTitle>
                <Forms.FormText>
                    {T(
                        "YABDP4Nitro (BetterDiscord) Vencord'a uyarlandı. Orijinal proje için GitHub düğmesine bas.",
                        "Ported from YABDP4Nitro (BetterDiscord) to Vencord. Hit the GitHub button for the original project."
                    )}
                </Forms.FormText>
            </div>
            <Button
                size={Button.Sizes.SMALL}
                onClick={() => {
                    try {
                        VencordNative.native.openExternal(ORIGINAL_REPO);
                    } catch { /* ignore */ }
                }}
            >
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <GithubIcon width={16} height={16} />
                    GitHub
                </span>
            </Button>
        </div>
    );
}

export function ProfileSettingsUI() {
    const [open, setOpen] = useState(false);
    const [c1, setC1] = useState("5865f2");
    const [c2, setC2] = useState("eb459e");
    const [effect, setEffect] = useState("");
    const [frame, setFrame] = useState("");
    const [decor, setDecor] = useState("");
    const [plateSku, setPlateSku] = useState("");
    const [platePal, setPlatePal] = useState("");
    const [style, setStyle] = useState("");
    const [banner, setBanner] = useState("");
    const [photo, setPhoto] = useState("");
    const [galTheme, setGalTheme] = useState(false);
    const [galEffect, setGalEffect] = useState(false);
    const [galDecor, setGalDecor] = useState(false);
    const [galPlate, setGalPlate] = useState(false);

    return (
        <div>
            <CreditRow />
            <div onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
                <Forms.FormTitle tag="h3">{open ? "▾" : "▸"} {T("Profil kodları", "Profile codes")}</Forms.FormTitle>
                <Forms.FormText>
                    {T(
                        "Düğmeye bas, çıkan görünmez yazıyı kopyala, Ayarlar → Profiller → Hakkımda kutusuna yapıştır. Kodlar sadece bu eklenti (veya uyumlu eklenti) olanlarda görünür.",
                        "Hit the button, copy the invisible text, paste it into Settings → Profiles → About Me. Codes only show for people with this (or a compatible) plugin."
                    )}
                </Forms.FormText>
            </div>
            {open && (
                <div style={{ marginTop: 8 }}>
                    <Row label={T("Tema rengi", "Theme colors")} hint={T("İki renk kodu, örn. 5865f2 ve eb459e.", "Two color codes, e.g. 5865f2 and eb459e.")}>
                        <TextInput value={c1} onChange={setC1} placeholder="5865f2" style={{ width: 110 }} />
                        <TextInput value={c2} onChange={setC2} placeholder="eb459e" style={{ width: 110 }} />
                        <span
                            title={`#${c1.trim().replace("#", "")} + #${c2.trim().replace("#", "")}`}
                            style={{
                                width: 48,
                                height: 28,
                                borderRadius: 8,
                                background: `linear-gradient(135deg, #${c1.trim().replace("#", "") || "5865f2"}, #${c2.trim().replace("#", "") || "eb459e"})`,
                            }}
                        />
                        <CopyBtn valid={isHex(c1) && isHex(c2)} make={() => makeThemeCode(c1.trim().replace("#", ""), c2.trim().replace("#", ""))} />
                        <GalleryShell open={galTheme} onToggle={() => setGalTheme(!galTheme)}>
                            {THEME_PRESETS.map(p => {
                                const selected = c1.trim().replace("#", "").toLowerCase() === p.c1 && c2.trim().replace("#", "").toLowerCase() === p.c2;
                                return (
                                    <div
                                        key={p.c1 + p.c2}
                                        onClick={() => { setC1(p.c1); setC2(p.c2); }}
                                        title={p.name}
                                        style={{
                                            width: 78,
                                            padding: 6,
                                            borderRadius: 10,
                                            cursor: "pointer",
                                            textAlign: "center",
                                            border: selected ? "2px solid #5865f2" : "2px solid transparent",
                                            background: selected ? "rgba(88,101,242,0.12)" : "transparent",
                                        }}
                                    >
                                        <div style={{ width: 56, height: 56, margin: "0 auto", borderRadius: 10, background: `linear-gradient(135deg, #${p.c1}, #${p.c2})` }} />
                                        <div style={{ fontSize: 11, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                                    </div>
                                );
                            })}
                        </GalleryShell>
                    </Row>

                    <Row label={T("Profil efekti", "Profile effect")} hint={T("Efektin numarası. Galeriden seç ya da kendi numaranı yaz.", "The effect's ID. Pick from the gallery or type your own.")}>
                        <TextInput value={effect} onChange={v => setEffect(extractSkuId(v))} placeholder="123456" style={{ width: 160 }} />
                        <CopyBtn valid={isDigits(effect)} make={() => makeEffectCode(effect.trim())} />
                        <GalleryShell open={galEffect} onToggle={() => setGalEffect(!galEffect)}>
                            {EFFECT_PRESETS.map(p => (
                                <PresetTile key={p.sku} img={p.thumb} name={p.name} sku={p.sku} selected={effect.trim() === p.sku} onPick={() => setEffect(p.sku)} />
                            ))}
                        </GalleryShell>
                    </Row>

                    <Row label={T("Profil çerçevesi", "Profile frame")} hint={T("Çerçevenin numarası. Mağazadaki ürün bağlantısındaki uzun sayı.", "The frame's ID. The long number in the shop product link.")}>
                        <TextInput value={frame} onChange={v => setFrame(extractSkuId(v))} placeholder="123456" style={{ width: 160 }} />
                        <SkuPreview sku={frame} />
                        <CopyBtn valid={isDigits(frame)} make={() => makeFrameCode(frame.trim())} />
                    </Row>

                    <Row label={T("Avatar süsü", "Avatar decoration")} hint={T("Süslemenin numarası. Galeriden seç ya da kendi numaranı yaz, önizlemesi yanında belirir. Discord resmi çözerse görünür.", "The decoration's ID. Pick from the gallery or type your own, the preview appears next to it. Shows if Discord resolves it.")}>
                        <TextInput value={decor} onChange={v => setDecor(extractSkuId(v))} placeholder="123456" style={{ width: 160 }} />
                        <SkuPreview sku={decor} />
                        <CopyBtn valid={isDigits(decor)} make={() => makeDecorCode(decor.trim())} />
                        <GalleryShell open={galDecor} onToggle={() => setGalDecor(!galDecor)}>
                            {DECOR_PRESETS.map(p => (
                                <PresetTile key={p.sku} img={shopStaticUrl(p.sku)} name={p.name} sku={p.sku} selected={decor.trim() === p.sku} onPick={() => setDecor(p.sku)} />
                            ))}
                        </GalleryShell>
                    </Row>

                    <Row label={T("İsim plakası", "Nameplate")} hint={T("Plaka numarası ve renk paleti. Galeriden seç ya da kendi numaranı yaz, önizlemesi yanında belirir. Discord resmi çözerse görünür.", "Plate ID and color palette. Pick from the gallery or type your own, the preview appears next to it. Shows if Discord resolves it.")}>
                        <TextInput value={plateSku} onChange={v => setPlateSku(extractSkuId(v))} placeholder={T("numara", "id")} style={{ width: 130 }} />
                        <TextInput value={platePal} onChange={setPlatePal} placeholder={T("palet", "palette")} style={{ width: 130 }} />
                        <SkuPreview sku={plateSku} />
                        <CopyBtn valid={isDigits(plateSku) && isToken(platePal)} make={() => makePlateCode(plateSku.trim(), platePal.trim())} />
                        <div style={{ flexBasis: "100%" }}>
                            <Forms.FormText>{T("Kabul edilen renkler:", "Accepted colors:")} {PLATE_PALETTES.join(", ")}</Forms.FormText>
                        </div>
                        <GalleryShell open={galPlate} onToggle={() => setGalPlate(!galPlate)}>
                            {PLATE_PRESETS.map(p => (
                                <PresetTile
                                    key={p.sku}
                                    img={shopStaticUrl(p.sku)}
                                    name={`${p.name} (${p.palette})`}
                                    sku={p.sku}
                                    selected={plateSku.trim() === p.sku && platePal.trim() === p.palette}
                                    onPick={() => { setPlateSku(p.sku); setPlatePal(p.palette); }}
                                />
                            ))}
                        </GalleryShell>
                    </Row>

                    <Row label={T("İsim stili", "Name style")} hint={T("Biçim: yazıtipi,efekt,renkler. Örn. 1,0.", "Format: font,effect,colors. E.g. 1,0.")}>
                        <TextInput value={style} onChange={setStyle} placeholder="1,0" style={{ width: 160 }} />
                        <CopyBtn
                            valid={style.split(",").map(s => s.trim()).filter(Boolean).length >= 2 && style.split(",").map(s => s.trim()).filter(Boolean).every(s => /^\d+$/.test(s))}
                            make={() => {
                                const [f, e, ...rest] = style.split(",").map(s => s.trim());
                                return makeStyleCode(f || "0", e || "0", rest.filter(Boolean).join(","));
                            }}
                        />
                    </Row>

                    <Row label={T("Sahte kapak", "Fake banner")} hint={T("Imgur kodu veya bağlantısı (örn. 8oGS6kV). Kapak yaması bağlı, profilde görünür.", "Imgur code or link (e.g. 8oGS6kV). Needs the banner patch, shows on profiles.")}>
                        <TextInput value={banner} onChange={setBanner} placeholder={T("8oGS6kV veya tam bağlantı", "8oGS6kV or full link")} style={{ width: 200 }} />
                        <CopyBtn valid={!!extractImgurId(banner)} make={() => makeBannerCode(extractImgurId(banner)!)} />
                    </Row>

                    <Row label={T("Sahte fotoğraf", "Fake photo")} hint={T("Imgur kodu veya bağlantısı. Fotoğraf yaması bağlı, profil resminde görünür.", "Imgur code or link. Needs the photo patch, shows as the avatar.")}>
                        <TextInput value={photo} onChange={setPhoto} placeholder={T("8oGS6kV veya tam bağlantı", "8oGS6kV or full link")} style={{ width: 200 }} />
                        <CopyBtn valid={!!extractImgurId(photo)} make={() => makePhotoCode(extractImgurId(photo)!)} />
                    </Row>
                </div>
            )}
        </div>
    );
}
