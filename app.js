// =====================================================================
// CERTIFICATE PORTAL — app.js
// Modular ES6 client logic: Supabase redemption, pdf-lib generation,
// canvas live preview, and canvas-confetti celebration.
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { PDFDocument, StandardFonts, rgb } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
import fontkit from 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/+esm';
import confetti from 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/+esm';
// Built-in Arabic Reshaper Engine

// ---------------------------------------------------------------------
// 0. CONFIGURATION — replace with your own Supabase project values.
// The anon key is safe to expose publicly; it can only do what your
// RLS policies + RPC grants allow (see schema.sql).
// ---------------------------------------------------------------------
const SUPABASE_URL = 'https://kleqgpagwlzmdawsrbig.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtsZXFncGFnd2x6bWRhd3NyYmlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMDA1NzEsImV4cCI6MjEwMTc3NjU3MX0.ZhhD1vRVKGWCWVinG9IwrreDOFOIonv4WCM2QCroWoM';

const TEMPLATE_PATH = './certificate-template.pdf';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------
// 1. CERTIFICATE LAYOUT CONSTANTS
// Shared between the canvas live-preview and the real pdf-lib output
// so what the user sees matches what they download.
// ---------------------------------------------------------------------
const CERT = {
  width: 842,   // pt, A4 landscape
  height: 595,  // pt, A4 landscape
  nameY: 300,             // baseline Y for the student name (from bottom)
  nameMaxWidth: 620,      // shrink font-size if the name would exceed this
  nameFontSize: 40,
  nameFontSizeMin: 20,
  colors: {
    ink: '#0f172a',
    inkLight: '#111827',
    emerald: '#10b981',
    amber: '#f59e0b',
    slateText: '#e2e8f0',
    slateMuted: '#94a3b8',
    border: '#1e293b',
  },
};

const FONT_CDN_URL =
  'https://cdn.jsdelivr.net/fontsource/fonts/cormorant-garamond@latest/latin-700-normal.ttf';
const ARABIC_FONT_CDN_URL =
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/amiri/Amiri-Regular.ttf';

// ---------------------------------------------------------------------
// 2. DOM REFERENCES
// ---------------------------------------------------------------------
const form = document.getElementById('redeemForm');
const accessKeyInput = document.getElementById('accessKey');
const fullNameInput = document.getElementById('fullName');
const fullNameArabicInput = document.getElementById('fullNameArabic');
const submitBtn = document.getElementById('submitBtn');
const submitSpinner = document.getElementById('submitSpinner');
const submitLabel = document.getElementById('submitLabel');
const alertBox = document.getElementById('alertBox');

const formState = document.getElementById('formState');
const successState = document.getElementById('successState');
const successName = document.getElementById('successName');
const downloadAgainBtn = document.getElementById('downloadAgainBtn');
const resetBtn = document.getElementById('resetBtn');

const previewCanvas = document.getElementById('previewCanvas');
const previewStatus = document.getElementById('previewStatus');
const previewCtx = previewCanvas.getContext('2d');

// ---------------------------------------------------------------------
// 3. STATE
// ---------------------------------------------------------------------
let lastGeneratedBytes = null; // Uint8Array of the most recent PDF
let lastGeneratedName = '';
let previewDebounceTimer = null;

// =====================================================================
// 4. UTILITIES
// =====================================================================

/** Convert '#rrggbb' -> pdf-lib rgb(0..1,0..1,0..1) */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}

/** Convert '#rrggbb' -> 'rgba(r,g,b,a)' for canvas 2D */
function hexToRgba(hex, alpha = 1) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function sanitizeFileNamePart(name) {
  return name.trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Student';
}

function debounce(fn, wait) {
  return (...args) => {
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(() => fn(...args), wait);
  };
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  accessKeyInput.disabled = isLoading;
  fullNameInput.disabled = isLoading;
  submitSpinner.classList.toggle('hidden', !isLoading);
  submitLabel.textContent = isLoading ? 'Generating…' : 'Generate my certificate';
}

function showAlert(message, tone = 'error') {
  const tones = {
    error: {
      classes: 'border-red-500/30 bg-red-500/10 text-red-300',
      icon: `<path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.3 2.25h17.76a1.5 1.5 0 0 0 1.3-2.25L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z"/>`,
    },
    warn: {
      classes: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      icon: `<path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.3 2.25h17.76a1.5 1.5 0 0 0 1.3-2.25L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z"/>`,
    },
  };
  const t = tones[tone] || tones.error;

  alertBox.className =
    `flex items-start gap-3 rounded-xl border px-4 py-3 text-sm animate-fade-up ${t.classes}`;
  alertBox.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>
    <span>${message}</span>
  `;
  alertBox.classList.remove('hidden');

  // Re-trigger the shake animation even on repeated identical errors.
  const card = form.closest('section');
  card.classList.remove('animate-shake');
  // Force reflow so the animation can restart.
  void card.offsetWidth;
  card.classList.add('animate-shake');
}

function hideAlert() {
  alertBox.classList.add('hidden');
  alertBox.innerHTML = '';
}

// =====================================================================
// 5. LIVE PREVIEW (Canvas 2D)
// Mirrors the real PDF's design so the user sees an accurate result
// before/while downloading.
// =====================================================================

function sizeCanvasForDPR() {
  const dpr = window.devicePixelRatio || 1;
  const rect = previewCanvas.getBoundingClientRect();
  previewCanvas.width = Math.round(rect.width * dpr);
  previewCanvas.height = Math.round(rect.height * dpr);
  previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cssW: rect.width, cssH: rect.height };
}

function drawCertificateFace(ctx, w, h, name) {
  const c = CERT.colors;
  const scale = w / CERT.width; // scale factor from PDF-point space to CSS px

  // Background
  ctx.fillStyle = c.ink;
  ctx.fillRect(0, 0, w, h);

  // Subtle radial glow accents
  const grad1 = ctx.createRadialGradient(w * 0.12, h * 0.1, 0, w * 0.12, h * 0.1, w * 0.4);
  grad1.addColorStop(0, hexToRgba(c.emerald, 0.14));
  grad1.addColorStop(1, hexToRgba(c.emerald, 0));
  ctx.fillStyle = grad1;
  ctx.fillRect(0, 0, w, h);

  const grad2 = ctx.createRadialGradient(w * 0.92, h * 0.85, 0, w * 0.92, h * 0.85, w * 0.35);
  grad2.addColorStop(0, hexToRgba(c.amber, 0.12));
  grad2.addColorStop(1, hexToRgba(c.amber, 0));
  ctx.fillStyle = grad2;
  ctx.fillRect(0, 0, w, h);

  // Outer border
  const margin = 18 * scale;
  ctx.strokeStyle = hexToRgba(c.emerald, 0.55);
  ctx.lineWidth = Math.max(1, 2 * scale);
  ctx.strokeRect(margin, margin, w - margin * 2, h - margin * 2);

  // Inner hairline border
  const margin2 = 26 * scale;
  ctx.strokeStyle = hexToRgba(c.slateMuted, 0.35);
  ctx.lineWidth = Math.max(0.75, 1 * scale);
  ctx.strokeRect(margin2, margin2, w - margin2 * 2, h - margin2 * 2);

  // Corner accents (amber)
  const cornerLen = 34 * scale;
  const cornerInset = margin;
  ctx.strokeStyle = c.amber;
  ctx.lineWidth = Math.max(1.5, 3 * scale);
  ctx.lineCap = 'square';
  const corners = [
    [cornerInset, cornerInset, 1, 0, 0, 1],
    [w - cornerInset, cornerInset, -1, 0, 0, 1],
    [cornerInset, h - cornerInset, 1, 0, 0, -1],
    [w - cornerInset, h - cornerInset, -1, 0, 0, -1],
  ];
  corners.forEach(([x, y, dx, _u, _v, dy]) => {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * cornerLen);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * cornerLen, y);
    ctx.stroke();
  });

  // Eyebrow badge
  ctx.textAlign = 'center';
  ctx.fillStyle = hexToRgba(c.amber, 0.95);
  ctx.font = `${Math.round(13 * scale)}px Inter, sans-serif`;
  ctx.save();
  ctx.font = `700 ${Math.round(12 * scale)}px Inter, sans-serif`;
  ctx.fillText('CERTIFICATE OF ACHIEVEMENT', w / 2, h * 0.235);
  ctx.restore();

  // Title
  ctx.fillStyle = c.slateText;
  ctx.font = `600 ${Math.round(30 * scale)}px "Cormorant Garamond", Georgia, serif`;
  ctx.fillText('Certificate of Completion', w / 2, h * 0.34);

  // Divider ornament
  const dividerY = h * 0.385;
  const dividerHalf = 70 * scale;
  ctx.strokeStyle = hexToRgba(c.emerald, 0.7);
  ctx.lineWidth = Math.max(1, 1.5 * scale);
  ctx.beginPath();
  ctx.moveTo(w / 2 - dividerHalf, dividerY);
  ctx.lineTo(w / 2 - 14 * scale, dividerY);
  ctx.moveTo(w / 2 + 14 * scale, dividerY);
  ctx.lineTo(w / 2 + dividerHalf, dividerY);
  ctx.stroke();
  ctx.fillStyle = c.emerald;
  ctx.beginPath();
  ctx.arc(w / 2, dividerY, 3 * scale, 0, Math.PI * 2);
  ctx.fill();

  // "This certifies that"
  ctx.fillStyle = c.slateMuted;
  ctx.font = `${Math.round(14 * scale)}px Inter, sans-serif`;
  ctx.fillText('This certifies that', w / 2, h * 0.44);

  // Name (auto-shrink to fit, mirrors PDF logic)
  const displayName = (name || 'Your Name Here').trim() || 'Your Name Here';
  let fontSize = CERT.nameFontSize;
  ctx.font = `700 ${Math.round(fontSize * scale)}px "Cormorant Garamond", Georgia, serif`;
  let textWidth = ctx.measureText(displayName).width;
  const maxWidthPx = CERT.nameMaxWidth * scale;
  while (textWidth > maxWidthPx && fontSize > CERT.nameFontSizeMin) {
    fontSize -= 1;
    ctx.font = `700 ${Math.round(fontSize * scale)}px "Cormorant Garamond", Georgia, serif`;
    textWidth = ctx.measureText(displayName).width;
  }
  const nameYCss = h - CERT.nameY * scale;
  ctx.fillStyle = name ? '#ffffff' : hexToRgba(c.slateMuted, 0.5);
  ctx.fillText(displayName, w / 2, nameYCss);

  // Underline beneath the name
  const underlineWidth = Math.max(textWidth + 40 * scale, 160 * scale);
  ctx.strokeStyle = hexToRgba(c.emerald, name ? 0.8 : 0.25);
  ctx.lineWidth = Math.max(1, 1.5 * scale);
  ctx.beginPath();
  ctx.moveTo(w / 2 - underlineWidth / 2, nameYCss + 14 * scale);
  ctx.lineTo(w / 2 + underlineWidth / 2, nameYCss + 14 * scale);
  ctx.stroke();

  // Body copy
  ctx.fillStyle = c.slateMuted;
  ctx.font = `${Math.round(13 * scale)}px Inter, sans-serif`;
  ctx.fillText(
    'has successfully completed all requirements of the program',
    w / 2,
    h * 0.62
  );
  ctx.fillText('with distinction and dedication.', w / 2, h * 0.655);

  // Footer: date + signature lines
  const footerY = h * 0.86;
  const lineW = 150 * scale;
  ctx.strokeStyle = hexToRgba(c.slateMuted, 0.5);
  ctx.lineWidth = Math.max(0.75, 1 * scale);

  ctx.beginPath();
  ctx.moveTo(w * 0.22 - lineW / 2, footerY);
  ctx.lineTo(w * 0.22 + lineW / 2, footerY);
  ctx.stroke();
  ctx.fillStyle = c.slateMuted;
  ctx.font = `${Math.round(11 * scale)}px Inter, sans-serif`;
  ctx.fillText(
    new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    w * 0.22,
    footerY + 18 * scale
  );
  ctx.fillText('Date Issued', w * 0.22, footerY + 34 * scale);

  ctx.beginPath();
  ctx.moveTo(w * 0.78 - lineW / 2, footerY);
  ctx.lineTo(w * 0.78 + lineW / 2, footerY);
  ctx.stroke();
  ctx.font = `italic 600 ${Math.round(15 * scale)}px "Cormorant Garamond", Georgia, serif`;
  ctx.fillStyle = c.slateText;
  ctx.fillText('Program Director', w * 0.78, footerY - 8 * scale);
  ctx.font = `${Math.round(11 * scale)}px Inter, sans-serif`;
  ctx.fillStyle = c.slateMuted;
  ctx.fillText('Authorized Signature', w * 0.78, footerY + 18 * scale);

  ctx.textAlign = 'left';
}

function updatePreview() {
  const { cssW, cssH } = sizeCanvasForDPR();
  const name = fullNameInput.value;
  const nameArabic = fullNameArabicInput ? fullNameArabicInput.value : '';
  drawCertificateFace(previewCtx, cssW, cssH, name);
  previewStatus.textContent = (name.trim() || nameArabic.trim()) ? 'Updated live' : 'Waiting for your name…';
}

const debouncedUpdatePreview = debounce(updatePreview, 60);

// =====================================================================
// 6. PDF GENERATION (pdf-lib)
// =====================================================================

/** Try to fetch a designer-provided base template; null if unavailable. */
async function tryLoadTemplateBytes() {
  try {
    const res = await fetch(TEMPLATE_PATH, { cache: 'no-store' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) return null;
    return buf;
  } catch {
    return null;
  }
}

/** Try to fetch a custom serif font's TTF bytes; null if unavailable. */
async function tryLoadCustomFontBytes() {
  try {
    const res = await fetch(FONT_CDN_URL, { cache: 'force-cache' });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/** Try to fetch custom Arabic font TTF bytes; null if unavailable. */
async function tryLoadArabicFontBytes() {
  try {
    const res = await fetch(ARABIC_FONT_CDN_URL, { cache: 'force-cache' });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/** Reshape Arabic text for PDF right-to-left drawing */
// =====================================================================
// ZERO-DEPENDENCY ARABIC RESHAPER & RTL ENGINE
// =====================================================================
const ARABIC_MAP = [
  [0x0621, 0xFE80, null,   null,   null  ],
  [0x0622, 0xFE81, null,   null,   0xFE82],
  [0x0623, 0xFE83, null,   null,   0xFE84],
  [0x0624, 0xFE85, null,   null,   0xFE86],
  [0x0625, 0xFE87, null,   null,   0xFE88],
  [0x0626, 0xFE89, 0xFE8B, 0xFE8C, 0xFE8A],
  [0x0627, 0xFE8D, null,   null,   0xFE8E],
  [0x0628, 0xFE8F, 0xFE91, 0xFE92, 0xFE90],
  [0x0629, 0xFE93, null,   null,   0xFE94],
  [0x062A, 0xFE95, 0xFE97, 0xFE98, 0xFE96],
  [0x062B, 0xFE99, 0xFE9B, 0xFE9C, 0xFE9A],
  [0x062C, 0xFE9D, 0xFE9F, 0xFEA0, 0xFE9E],
  [0x062D, 0xFEA1, 0xFEA3, 0xFEA4, 0xFEA2],
  [0x062E, 0xFEA5, 0xFEA7, 0xFEA8, 0xFEA6],
  [0x062F, 0xFEA9, null,   null,   0xFEAA],
  [0x0630, 0xFEAB, null,   null,   0xFEAC],
  [0x0631, 0xFEAD, null,   null,   0xFEAE],
  [0x0632, 0xFEAF, null,   null,   0xFEB0],
  [0x0633, 0xFEB1, 0xFEB3, 0xFEB4, 0xFEB2],
  [0x0634, 0xFEB5, 0xFEB7, 0xFEB8, 0xFEB6],
  [0x0635, 0xFEB9, 0xFEBB, 0xFEBC, 0xFEBA],
  [0x0636, 0xFEBD, 0xFEBF, 0xFEC0, 0xFEBE],
  [0x0637, 0xFEC1, 0xFEC3, 0xFEC4, 0xFEC2],
  [0x0638, 0xFEC5, 0xFEC7, 0xFEC8, 0xFEC6],
  [0x0639, 0xFEC9, 0xFECB, 0xFECC, 0xFECA],
  [0x063A, 0xFECD, 0xFECF, 0xFED0, 0xFECE],
  [0x0640, 0x0640, 0x0640, 0x0640, 0x0640],
  [0x0641, 0xFED1, 0xFED3, 0xFED4, 0xFED2],
  [0x0642, 0xFED5, 0xFED7, 0xFED8, 0xFED6],
  [0x0643, 0xFED9, 0xFEDB, 0xFEDC, 0xFEDA],
  [0x0644, 0xFEDD, 0xFEDF, 0xFEE0, 0xFEDE],
  [0x0645, 0xFEE1, 0xFEE3, 0xFEE4, 0xFEE2],
  [0x0646, 0xFEE5, 0xFEE7, 0xFEE8, 0xFEE6],
  [0x0647, 0xFEE9, 0xFEEB, 0xFEEC, 0xFEEA],
  [0x0648, 0xFEED, null,   null,   0xFEEE],
  [0x0649, 0xFEEF, 0xFBE8, 0xFBE9, 0xFBFD],
  [0x064A, 0xFEF1, 0xFEF3, 0xFEF4, 0xFEF2],
  [0x06CC, 0xFBFC, 0xFBFE, 0xFBFF, 0xFEF0],
  [0x067E, 0xFB56, 0xFB58, 0xFB59, 0xFB57],
  [0x0686, 0xFB7A, 0xFB7C, 0xFB7D, 0xFB7B],
  [0x0698, 0xFB8A, null,   null,   0xFB8B],
  [0x06AF, 0xFB92, 0xFB94, 0xFB95, 0xFB93],
];

const ARABIC_DICT = new Map(ARABIC_MAP.map(r => [r[0], r]));

const COMB_MAP = {
  '0x0644_0x0622': [0xFEF5, 0xFEF6],
  '0x0644_0x0623': [0xFEF7, 0xFEF8],
  '0x0644_0x0625': [0xFEF9, 0xFEFA],
  '0x0644_0x0627': [0xFEFB, 0xFEFC],
};

/** Reshape Arabic text for PDF right-to-left drawing */
function reshapeArabicText(text) {
  if (!text) return '';
  if (!/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text)) return text;

  const chars = Array.from(text);
  const out = [];
  const n = chars.length;

  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    const code = ch.charCodeAt(0);

    if (ch === '\u0644' && i + 1 < n) {
      const nextCode = chars[i + 1].charCodeAt(0);
      const combKey = `0x0644_0x${nextCode.toString(16).padStart(4, '0')}`;
      if (COMB_MAP[combKey]) {
        const prevCh = i > 0 ? chars[i - 1] : null;
        let prevConn = false;
        if (prevCh && ARABIC_DICT.has(prevCh.charCodeAt(0))) {
          const p = ARABIC_DICT.get(prevCh.charCodeAt(0));
          if (p[2] !== null || p[3] !== null) prevConn = true;
        }
        const ligCode = prevConn ? COMB_MAP[combKey][1] : COMB_MAP[combKey][0];
        out.push(String.fromCharCode(ligCode));
        i++;
        continue;
      }
    }

    if (!ARABIC_DICT.has(code)) {
      out.push(ch);
      continue;
    }

    const prevCh = i > 0 ? chars[i - 1] : null;
    const nextCh = i + 1 < n ? chars[i + 1] : null;

    let prevConnects = false;
    if (prevCh && ARABIC_DICT.has(prevCh.charCodeAt(0))) {
      const p = ARABIC_DICT.get(prevCh.charCodeAt(0));
      if (p[2] !== null || p[3] !== null) prevConnects = true;
    }

    let nextConnects = false;
    if (nextCh && ARABIC_DICT.has(nextCh.charCodeAt(0))) {
      const nxt = ARABIC_DICT.get(nextCh.charCodeAt(0));
      if (nxt[4] !== null || nxt[3] !== null) nextConnects = true;
    }

    const [, iso, init, med, fin] = ARABIC_DICT.get(code);

    let resCode;
    if (prevConnects && nextConnects && med !== null) {
      resCode = med;
    } else if (prevConnects && fin !== null) {
      resCode = fin;
    } else if (nextConnects && init !== null) {
      resCode = init;
    } else {
      resCode = iso !== null ? iso : code;
    }

    out.push(String.fromCharCode(resCode));
  }

  return out.reverse().join('');
}

/**
 * Draws all static certificate artwork directly with pdf-lib primitives.
 * Used as the fallback when no certificate-template.pdf is present.
 */
function drawFallbackTemplate(page, fonts) {
  const { width, height } = page.getSize();
  const c = CERT.colors;
  const { serifBold, sans, sansBold, serifItalic } = fonts;

  page.drawRectangle({ x: 0, y: 0, width, height, color: hexToRgb(c.ink) });

  // Outer / inner borders
  page.drawRectangle({
    x: 18, y: 18, width: width - 36, height: height - 36,
    borderColor: hexToRgb(c.emerald), borderWidth: 2, color: undefined,
    borderOpacity: 0.55,
  });
  page.drawRectangle({
    x: 26, y: 26, width: width - 52, height: height - 52,
    borderColor: hexToRgb(c.slateMuted), borderWidth: 1, borderOpacity: 0.35,
  });

  // Corner accents
  const cl = 34, ci = 18, cw = 3;
  const amber = hexToRgb(c.amber);
  const corner = (x, y, dx, dy) => {
    page.drawLine({ start: { x, y: y + dy * cl }, end: { x, y }, thickness: cw, color: amber });
    page.drawLine({ start: { x, y }, end: { x: x + dx * cl, y }, thickness: cw, color: amber });
  };
  corner(ci, height - ci, 1, -1);
  corner(width - ci, height - ci, -1, -1);
  corner(ci, ci, 1, 1);
  corner(width - ci, ci, -1, 1);

  const centerText = (text, y, font, size, color, charSpace = 0) => {
    const w = font.widthOfTextAtSize(text, size) + charSpace * Math.max(0, text.length - 1);
    page.drawText(text, { x: (width - w) / 2, y, size, font, color });
  };

  centerText('CERTIFICATE OF ACHIEVEMENT', height * 0.79, sansBold, 12, amber, 2);
  centerText('Certificate of Completion', height * 0.72, serifBold, 30, hexToRgb(c.slateText));

  // Divider
  const dividerY = height * 0.685;
  const emerald = hexToRgb(c.emerald);
  page.drawLine({ start: { x: width / 2 - 70, y: dividerY }, end: { x: width / 2 - 14, y: dividerY }, thickness: 1.5, color: emerald, opacity: 0.7 });
  page.drawLine({ start: { x: width / 2 + 14, y: dividerY }, end: { x: width / 2 + 70, y: dividerY }, thickness: 1.5, color: emerald, opacity: 0.7 });
  page.drawCircle({ x: width / 2, y: dividerY, size: 3, color: emerald });

  centerText('This certifies that', height * 0.63, sans, 14, hexToRgb(c.slateMuted));

  centerText('has successfully completed all requirements of the program', height * 0.455, sans, 13, hexToRgb(c.slateMuted));
  centerText('with distinction and dedication.', height * 0.425, sans, 13, hexToRgb(c.slateMuted));

  // Footer lines
  const footerY = height * 0.2;
  const lineW = 150;
  const slateMuted = hexToRgb(c.slateMuted);
  page.drawLine({ start: { x: width * 0.22 - lineW / 2, y: footerY }, end: { x: width * 0.22 + lineW / 2, y: footerY }, thickness: 1, color: slateMuted, opacity: 0.5 });
  const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  centerText(dateStr, footerY - 18, sans, 11, slateMuted);
  centerText('Date Issued', footerY - 34, sans, 11, slateMuted);

  page.drawLine({ start: { x: width * 0.78 - lineW / 2, y: footerY }, end: { x: width * 0.78 + lineW / 2, y: footerY }, thickness: 1, color: slateMuted, opacity: 0.5 });
  centerText('Program Director', footerY + 8, serifItalic, 15, hexToRgb(c.slateText));
  centerText('Authorized Signature', footerY - 18, sans, 11, slateMuted);
}

/**
 * Generates the final certificate PDF bytes for a given student name.
 * Entirely client-side; makes no network calls other than best-effort,
 * cache-friendly fetches for an optional template/font that both
 * gracefully fall back if unavailable.
 */
async function generateCertificatePdf(studentNameEnglish, studentNameArabic = '') {
  const nameEng = studentNameEnglish.trim();
  const nameAr = studentNameArabic.trim() || nameEng;

  const [templateBytes, customFontBytes, arabicFontBytes] = await Promise.all([
    tryLoadTemplateBytes(),
    tryLoadCustomFontBytes(),
    tryLoadArabicFontBytes(),
  ]);

  const pdfDoc = templateBytes
    ? await PDFDocument.load(templateBytes)
    : await PDFDocument.create();

  pdfDoc.registerFontkit(fontkit);

  let page;
  if (templateBytes) {
    page = pdfDoc.getPage(0);
  } else {
    page = pdfDoc.addPage([CERT.width, CERT.height]);
  }
  const { width, height } = page.getSize();

  // Embed fonts: prefer the custom serif / Arabic fonts, fall back gracefully.
  let nameFont, arabicFont;
  let serifBold, serifItalic, sans, sansBold;
  try {
    if (customFontBytes) {
      nameFont = await pdfDoc.embedFont(customFontBytes, { subset: true });
      serifBold = nameFont;
    } else {
      throw new Error('no custom font available');
    }
  } catch {
    nameFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    serifBold = nameFont;
  }

  try {
    if (arabicFontBytes) {
      arabicFont = await pdfDoc.embedFont(arabicFontBytes, { subset: true });
    } else {
      arabicFont = nameFont;
    }
  } catch {
    arabicFont = nameFont;
  }

  serifItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  sans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  sansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // If we generated the page ourselves, draw the full fallback artwork.
  if (!templateBytes) {
    drawFallbackTemplate(page, { serifBold, sans, sansBold, serifItalic });

    // Fallback centered placement for blank template
    let fontSize = CERT.nameFontSize;
    let textWidth = nameFont.widthOfTextAtSize(nameEng, fontSize);
    while (textWidth > CERT.nameMaxWidth && fontSize > CERT.nameFontSizeMin) {
      fontSize -= 1;
      textWidth = nameFont.widthOfTextAtSize(nameEng, fontSize);
    }
    const nameX = (width - textWidth) / 2;
    const nameY = CERT.nameY;

    page.drawText(nameEng, {
      x: nameX,
      y: nameY,
      size: fontSize,
      font: nameFont,
      color: hexToRgb(CERT.colors.ink),
    });

    const underlineWidth = Math.max(textWidth + 40, 160);
    page.drawLine({
      start: { x: width / 2 - underlineWidth / 2, y: nameY - 14 },
      end: { x: width / 2 + underlineWidth / 2, y: nameY - 14 },
      thickness: 1.5,
      color: hexToRgb(CERT.colors.emerald),
      opacity: 0.85,
    });
  } else {
    // ---- Precision overlay for certificate-template.pdf (Bilingual layout) ----
    const customColor = rgb(240/255, 58/255, 61/255);

    // 1. Cover the red placeholder text on English side ("Enter student name")
    page.drawRectangle({
      x: 323,
      y: 487,
      width: 157,
      height: 30,
      color: rgb(1, 1, 1),
    });

    // 2. Cover the red placeholder text on Arabic side ("Enter user name")
    page.drawRectangle({
      x: 640,
      y: 487,
      width: 210,
      height: 30,
      color: rgb(1, 1, 1),
    });

    const baselineY = 498; 

    // 3. Render student name on English side (Left-aligned right after 'INDEED, THE STUDENT:')
    const engFontSize = 14;
    const engX = 328; 

    page.drawText(nameEng, {
      x: engX,
      y: baselineY,
      size: engFontSize,
      font: nameFont,
      color: customColor,
    });

    // 4. Render student name on Arabic side (Right-aligned ending right before ':??? ???????/????????')
    const formattedArabic = reshapeArabicText(nameAr);
    const arFontSize = 15;
    const arTextWidth = arabicFont.widthOfTextAtSize(formattedArabic, arFontSize);
    const arX = 845 - arTextWidth;

    page.drawText(formattedArabic, {
      x: Math.max(642, arX),
      y: baselineY,
      size: arFontSize,
      font: arabicFont,
      color: customColor,
    });
  }

  pdfDoc.setTitle(`Certificate of Completion — ${name}`);
  pdfDoc.setSubject('Certificate of Completion');
  pdfDoc.setProducer('Certificate Portal');
  pdfDoc.setCreationDate(new Date());

  return pdfDoc.save();
}

function triggerDownload(bytes, studentName) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Certificate_${sanitizeFileNamePart(studentName)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to pick up the blob before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// =====================================================================
// 7. CELEBRATION
// =====================================================================

function launchConfetti() {
  const emerald = '#10b981';
  const amber = '#f59e0b';
  const white = '#f8fafc';
  const duration = 1400;
  const end = Date.now() + duration;

  (function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 65,
      origin: { x: 0, y: 0.75 },
      colors: [emerald, amber, white],
      scalar: 0.9,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 65,
      origin: { x: 1, y: 0.75 },
      colors: [emerald, amber, white],
      scalar: 0.9,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();

  confetti({
    particleCount: 90,
    spread: 100,
    startVelocity: 45,
    origin: { x: 0.5, y: 0.4 },
    colors: [emerald, amber, white],
  });
}

// =====================================================================
// 8. FORM FLOW
// =====================================================================

function validateInputs(key, name) {
  if (!key) return 'Please enter your access key.';
  if (!/^[A-Z0-9-]{6,32}$/i.test(key)) return 'That access key format looks incorrect.';
  if (!name) return 'Please enter your full name.';
  if (name.length < 2) return 'Please enter your full name.';
  if (name.length > 120) return 'That name is too long. Please shorten it.';
  return null;
}

async function handleSubmit(event) {
  event.preventDefault();
  hideAlert();

  const key = accessKeyInput.value.trim().toUpperCase();
  const name = fullNameInput.value.trim();
  const nameArabic = fullNameArabicInput ? fullNameArabicInput.value.trim() : '';

  const validationError = validateInputs(key, name);
  if (validationError) {
    showAlert(validationError, 'warn');
    return;
  }

  setLoading(true);

  try {
    // ---- Step 1: generate the PDF in memory FIRST -------------------
    let pdfBytes;
    try {
      pdfBytes = await generateCertificatePdf(name, nameArabic);
    } catch (genErr) {
      console.error('PDF generation failed:', genErr);
      showAlert('We could not generate your certificate file. Please try again.', 'error');
      setLoading(false);
      return;
    }

    // ---- Step 2: atomically redeem the key via Supabase RPC ---------
    const dbFullName = nameArabic ? `${name} (${nameArabic})` : name;
    const { data, error } = await supabase.rpc('redeem_key', {
      p_key_code: key,
      p_full_name: dbFullName,
    });

    if (error) {
      console.error('Supabase RPC error:', error);
      showAlert('Something went wrong reaching the server. Please try again.', 'error');
      setLoading(false);
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result || !result.success) {
      showAlert(result?.message || 'That access key could not be redeemed.', 'error');
      setLoading(false);
      return;
    }

    // ---- Step 3: success — download + celebrate ----------------------
    lastGeneratedBytes = pdfBytes;
    lastGeneratedName = name;

    triggerDownload(pdfBytes, name);
    launchConfetti();
    showCelebration(name);
  } finally {
    setLoading(false);
  }
}

function showCelebration(name) {
  formState.classList.add('hidden');
  successState.classList.remove('hidden');
  successState.classList.add('animate-fade-up');
  successName.textContent = name;
}

function resetForm() {
  form.reset();
  hideAlert();
  lastGeneratedBytes = null;
  lastGeneratedName = '';
  successState.classList.add('hidden');
  formState.classList.remove('hidden');
  updatePreview();
  accessKeyInput.focus();
}

// =====================================================================
// 9. EVENT WIRING
// =====================================================================

form.addEventListener('submit', handleSubmit);

fullNameInput.addEventListener('input', debouncedUpdatePreview);
if (fullNameArabicInput) {
  fullNameArabicInput.addEventListener('input', debouncedUpdatePreview);
}

accessKeyInput.addEventListener('input', () => {
  const start = accessKeyInput.selectionStart;
  accessKeyInput.value = accessKeyInput.value.toUpperCase();
  accessKeyInput.setSelectionRange(start, start);
});

downloadAgainBtn.addEventListener('click', () => {
  if (lastGeneratedBytes) {
    triggerDownload(lastGeneratedBytes, lastGeneratedName);
  }
});

resetBtn.addEventListener('click', resetForm);

window.addEventListener('resize', debounce(updatePreview, 120));

// Wait for the custom font to be ready (best-effort) before the first
// paint so the preview doesn't visibly swap typefaces.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(updatePreview).catch(updatePreview);
}
updatePreview();
