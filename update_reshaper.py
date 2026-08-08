try:
    with open('app.js', 'r', encoding='utf-8') as f:
        content = f.read()
except UnicodeDecodeError:
    with open('app.js', 'r', encoding='cp1252') as f:
        content = f.read()

# 1. Remove CDN import
old_import = "import ArabicPersianReshaper from 'https://cdn.jsdelivr.net/npm/arabic-persian-reshaper@1.0.1/+esm';"
content = content.replace(old_import, "// Built-in Arabic Reshaper Engine")

# 2. Build-in reshaper replacement
old_function_start = "function reshapeArabicText(text) {"
idx = content.find(old_function_start)

if idx != -1:
    # Find matching closing brace
    brace_count = 0
    start_body = content.find('{', idx)
    end_body = -1
    for i in range(start_body, len(content)):
        if content[i] == '{':
            brace_count += 1
        elif content[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                end_body = i + 1
                break
    
    if end_body != -1:
        reshaper_full = r"""// =====================================================================
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
}"""
        content = content[:idx] + reshaper_full + content[end_body:]
        print('Successfully replaced reshapeArabicText function!')

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('app.js updated successfully!')
