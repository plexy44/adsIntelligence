/* =====================================================================
   Sementra Engine. Parsing, aggregation and judgement for raw
   Meta Ads Manager CSV exports.

   Design rules learned the hard way:
   - Never trust column positions. Meta's export layout changes with
     every breakdown, level and localisation choice. Everything is
     resolved by header semantics.
   - Never sum a ratio. Never sum Reach across breakdown rows.
   - Never add "Results" across different Result indicators; that
     produces a headline number with no meaning.
   - Always report what was detected so a human can catch a misread.
   ===================================================================== */

/* ------------------------------ CSV ------------------------------ */

// Character-level parser: handles quoted commas, escaped quotes, CRLF,
// and newlines inside quoted cells (Meta ad names contain both).
export const parseCSV = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '"') {
      if (inQuotes && n === '"') { cell += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      row.push(cell); cell = '';
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell);
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some(x => x.trim() !== '')) rows.push(row);
  }
  return rows;
};

/* --------------------------- primitives --------------------------- */

// Meta emits "1,234.56" (en), "1.234,56" (de), "£1,234", "12.5%", "—",
// "(123)" for negatives, and bare "" for zero-or-absent.
// A single dot is genuinely ambiguous: "1.753" is 1753 impressions in a
// German export and 1.753 as a CPM in an English one. No cell-level rule
// can resolve that, so the locale is detected once per file (below) and
// applied consistently.
export const toNumber = (raw, locale = 'en') => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (s === '' || s === '-' || s === '--' || s === '—' || s === 'N/A' || s === 'n/a') return null;
  const negParen = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, '');
  s = s.replace(/[^\d.,\-]/g, '');            // drop currency symbols, %, spaces, letters
  if (s === '' || s === '-' || s === '.' || s === ',') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Both present: whichever comes last is the decimal separator.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (locale === 'eu') {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastComma > -1) {
    // English file with a lone comma: "1,234" thousands vs "12,5" decimal.
    const tail = s.length - lastComma - 1;
    s = tail === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return negParen ? -n : n;
};

// Vote across every numeric-looking cell in the file. A comma followed by
// exactly two digits at the end of a number is decimal-comma evidence; a
// dot in the same position is decimal-point evidence.
export const detectNumberLocale = (table, limit = 400) => {
  let eu = 0, en = 0;
  const rows = table.slice(0, limit);
  for (const row of rows) {
    for (const cell of row) {
      const s = String(cell ?? '').trim();
      if (!s || !/\d/.test(s)) continue;
      if (/,\d{1,2}(?!\d)/.test(s) && !/\.\d/.test(s)) eu++;
      if (/\.\d{1,2}(?!\d)/.test(s) && !/,\d/.test(s)) en++;
      if (/\d\.\d{3}(?!\d)/.test(s) && /,\d{1,2}(?!\d)/.test(s)) eu += 2;
      if (/\d,\d{3}(?!\d)/.test(s) && /\.\d{1,2}(?!\d)/.test(s)) en += 2;
    }
  }
  return eu > en ? 'eu' : 'en';
};

export const looksNumeric = (raw) => {
  if (raw === null || raw === undefined) return false;
  const s = String(raw).trim();
  if (s === '') return false;
  if (/^[-–—]{1,2}$/.test(s)) return true;               // Meta's blank marker
  return /^[£$€¥₹\s]*\(?-?[\d.,]+\)?\s*%?$/.test(s) && /\d/.test(s);
};

const clean = (h) => String(h || '').replace(/^\uFEFF/, '').trim();
const lower = (h) => clean(h).toLowerCase();

/* --------------------------- statistics --------------------------- */

// Poisson relative standard error on a count. CPA and cost-per-result
// inherit their uncertainty almost entirely from the conversion count,
// which is why 3-conversion verdicts are worthless.
export const countRSE = (n) => (n > 0 ? 1 / Math.sqrt(n) : null);

export const cpaInterval = (spend, conv, z = 1.96) => {
  if (!(conv > 0) || !(spend > 0)) return null;
  const cpa = spend / conv;
  const rse = 1 / Math.sqrt(conv);
  return { cpa, low: cpa * Math.max(0, 1 - z * rse), high: cpa * (1 + z * rse), rse };
};

// Compare two conversion RATES per unit spend (Poisson exposure model).
//
// Also returns the minimum detectable difference, which is the figure that
// actually answers the user's question. Extrapolating "how much more data
// would make THIS gap significant" explodes as the gap approaches zero: two
// ads at £23.80 and £23.74 differ by 0.3%, which implies needing millions of
// extra conversions. That is arithmetically true and practically nonsense.
// The bounded, useful statement is the reverse: at these volumes, gaps below
// X% cannot be seen at all.
export const compareRates = (conv1, spend1, conv2, spend2, z0 = 1.96) => {
  if (!(spend1 > 0) || !(spend2 > 0)) return null;
  if (conv1 + conv2 === 0) return null;
  const r1 = conv1 / spend1, r2 = conv2 / spend2;
  const v1 = conv1 / (spend1 * spend1), v2 = conv2 / (spend2 * spend2);
  const se = Math.sqrt(v1 + v2);
  if (!(se > 0)) return null;
  const z = (r1 - r2) / se;
  const pooled = (conv1 + conv2) / (spend1 + spend2);
  // Smallest relative gap this comparison could resolve at current volume.
  const mdeRel = pooled > 0 ? (z0 * se) / pooled : null;
  const obsRel = pooled > 0 ? Math.abs(r1 - r2) / pooled : null;
  // Volume multiple that would make the observed gap significant. Infinite
  // when the gap is effectively zero, which callers must handle rather than
  // print.
  const volumeMultiple = Math.abs(z) > 1e-9 ? Math.pow(z0 / Math.abs(z), 2) : Infinity;
  const totalConv = conv1 + conv2;
  const extraConv = isFinite(volumeMultiple) ? totalConv * (volumeMultiple - 1) : Infinity;
  // Only worth quoting while it stays within reach of this account.
  const extraIsRealistic = isFinite(extraConv) && extraConv <= totalConv * 20;
  return {
    z, p: 2 * (1 - normalCdf(Math.abs(z))), r1, r2, se, pooled,
    mdeRel, obsRel, volumeMultiple, extraConv, extraIsRealistic, totalConv,
  };
};

export const normalCdf = (x) => {
  // Abramowitz & Stegun 7.1.26 on erf.
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  const erf = x >= 0 ? y : -y;
  return 0.5 * (1 + erf);
};

export const median = (arr) => {
  const a = arr.filter(x => typeof x === 'number' && isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export const quantile = (arr, q) => {
  const a = arr.filter(x => typeof x === 'number' && isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
};

// Share of a total held by the largest n contributors, i.e. concentration risk.
export const topNShare = (values, n) => {
  const a = values.filter(v => v > 0).sort((x, y) => y - x);
  const total = a.reduce((s, v) => s + v, 0);
  if (!total) return null;
  return a.slice(0, n).reduce((s, v) => s + v, 0) / total;
};

/* ------------------------- column ontology ------------------------- */

// role: canonical meaning. agg: how to combine across rows.
// 'sum' additive | 'ratio' recompute from parts | 'unique' cannot be
// summed (Reach) | 'ordinal' Meta's own text rankings | 'setting' config.
const METRIC_RULES = [
  { role: 'spend',        agg: 'sum',   unit: 'currency', match: [/^amount spent/, /^spend$/, /^cost$/, /^amount spent \(/] },
  { role: 'impressions',  agg: 'sum',   unit: 'int',      match: [/^impressions$/] },
  { role: 'reach',        agg: 'unique',unit: 'int',      match: [/^reach$/] },
  { role: 'frequency',    agg: 'ratio', unit: 'float',    match: [/^frequency$/], num: 'impressions', den: 'reach' },
  { role: 'linkClicks',   agg: 'sum',   unit: 'int',      match: [/^link clicks$/, /^unique link clicks$/, /^outbound clicks$/] },
  { role: 'allClicks',    agg: 'sum',   unit: 'int',      match: [/^clicks \(all\)$/, /^clicks$/] },
  { role: 'ctr',          agg: 'ratio', unit: 'pct',      match: [/^ctr \(link/, /^ctr$/, /^unique ctr/, /^ctr \(all\)/, /click-through rate/], num: 'linkClicks', den: 'impressions', mult: 100 },
  { role: 'cpc',          agg: 'ratio', unit: 'currency', match: [/^cpc/, /cost per link click/, /cost per click/], num: 'spend', den: 'linkClicks' },
  { role: 'cpm',          agg: 'ratio', unit: 'currency', match: [/^cpm/, /cost per 1,?000 impressions/], num: 'spend', den: 'impressions', mult: 1000 },
  { role: 'purchases',    agg: 'sum',   unit: 'int',      match: [/^website purchases$/, /^purchases$/, /^meta purchases$/, /^offsite purchases$/, /^app purchases$/] },
  { role: 'revenue',      agg: 'sum',   unit: 'currency', match: [/purchases? conversion value/, /^conversion value/, /^purchase value/, /website purchase value/] },
  { role: 'roas',         agg: 'ratio', unit: 'ratio',    match: [/roas/, /return on ad spend/], num: 'revenue', den: 'spend' },
  { role: 'cpp',          agg: 'ratio', unit: 'currency', match: [/cost per website purchase/, /cost per purchase/], num: 'spend', den: 'purchases' },
  { role: 'landingViews', agg: 'sum',   unit: 'int',      match: [/^landing page views$/, /^unique landing page views$/] },
  { role: 'addToCart',    agg: 'sum',   unit: 'int',      match: [/adds? to cart/] },
  { role: 'checkouts',    agg: 'sum',   unit: 'int',      match: [/checkouts? initiated/] },
  { role: 'leads',        agg: 'sum',   unit: 'int',      match: [/^leads$/, /^website leads$/, /^on-facebook leads$/] },
  { role: 'engagements',  agg: 'sum',   unit: 'int',      match: [/^post engagements?$/, /^page engagements?$/] },
  { role: 'thruPlays',    agg: 'sum',   unit: 'int',      match: [/^thruplays$/, /video plays at/, /^\d+-second video plays$/] },
  { role: 'results',      agg: 'sum',   unit: 'int',      match: [/^results$/, /^result$/] },
  { role: 'costPerResult',agg: 'ratio', unit: 'currency', match: [/^cost per results?$/], num: 'spend', den: 'results' },
];

const ORDINAL_COLS = [
  { role: 'qualityRank',    match: /quality ranking/ },
  { role: 'engagementRank', match: /engagement rate ranking/ },
  { role: 'conversionRank', match: /conversion rate ranking/ },
];

const SETTING_COLS = [
  { role: 'attribution', match: /attribution setting/ },
  { role: 'objective',   match: /^objective$/ },
  { role: 'bidStrategy', match: /bid strategy/ },
  { role: 'buyingType',  match: /buying type/ },
  { role: 'delivery',    match: /(^|\s)delivery($|\s)|^ad set delivery|^campaign delivery|^ad delivery|^status$/ },
  { role: 'budget',      match: /budget$/ },
  { role: 'budgetType',  match: /budget type/ },
  { role: 'resultIndicator', match: /result indicator|optimi[sz]ation goal|conversion event/ },
  { role: 'currency',    match: /^currency$/ },
];

// Breakdown dimensions Meta can add. Each multiplies the row count per
// entity, so detecting them is what keeps aggregation honest.
const BREAKDOWN_COLS = [
  /^age$/, /^gender$/, /^country$/, /^region$/, /^dma region$/, /^business locations?$/,
  /^impression device$/, /^device platform$/, /^platform$/, /^publisher platform$/,
  /^placement$/, /^platform position$/, /^product id$/, /^time of day/, /^day of week$/,
  /^media type$/, /^frequency value$/, /^audience segment/, /^language$/,
];

const ENTITY_COLS = [
  { level: 'campaign', match: [/^campaign name$/, /^campaign$/] },
  { level: 'adset',    match: [/^ad set name$/, /^ad set$/, /^adset name$/] },
  { level: 'ad',       match: [/^ad name$/, /^ad$/] },
];

const DATE_COLS = {
  day:   [/^day$/, /^date$/],
  week:  [/^week$/],
  month: [/^month$/],
  start: [/^reporting starts$/, /^starts$/, /^date start$/],
  end:   [/^reporting ends$/, /^ends$/, /^date stop$/],
};

const matchAny = (h, pats) => pats.some(p => p.test(h));
const nfmt = (n) => Number(n).toLocaleString('en-GB');

/* ------------------------ indicator vocabulary ------------------------ */

// Meta's Result indicator strings are API tokens or UI labels depending
// on export path. Both collapse to the same human concept.
export const canonicalIndicator = (raw) => {
  if (!raw) return null;
  const c = String(raw).toLowerCase()
    .replace(/actions:/g, '')
    .replace(/offsite_conversion\.fb_pixel_/g, '')
    .replace(/onsite_conversion\./g, '')
    .replace(/omni_/g, '')
    .replace(/_/g, ' ')
    .trim();
  if (!c || c === '-' || c === '—') return null;
  if (/purchase/.test(c)) return 'Purchase';
  if (/lead|complete registration/.test(c)) return 'Lead';
  if (/add to cart|add_to_cart/.test(c)) return 'Add to cart';
  if (/initiate checkout|checkout/.test(c)) return 'Checkout';
  if (/landing page view/.test(c)) return 'Landing page view';
  if (/link click/.test(c)) return 'Link click';
  if (/messaging|message/.test(c)) return 'Messaging';
  if (/thruplay|video view|video play/.test(c)) return 'Video view';
  if (/post engagement|engagement/.test(c)) return 'Engagement';
  if (/page like|follow/.test(c)) return 'Page like';
  if (/app install|install/.test(c)) return 'App install';
  if (/reach|impression/.test(c)) return 'Reach';
  if (/click/.test(c)) return 'Click';
  return c.charAt(0).toUpperCase() + c.slice(1);
};

/* Delivery status. An export is a history book as much as a control panel:
   in a mature account most rows are entities that stopped delivering long
   ago. Advice that ignores this tells you to pause what is already paused,
   and to pour budget into a seasonal creative that has been off for months. */
const OFF_STATES = /^(inactive|paused|archived|deleted|not[_ ]delivering|completed|ended|rejected|disapproved|error|campaign[_ ]off|adset[_ ]off)/;
const LIVE_STATES = /^(active|delivering|learning|in[_ ]review|scheduled|pending|processing)/;

export const normaliseStatus = (raw) => {
  if (raw === null || raw === undefined) return 'unknown';
  const s = String(raw).toLowerCase().trim();
  if (!s || s === '0' || s === '-') return 'unknown';
  if (OFF_STATES.test(s)) return 'off';
  if (LIVE_STATES.test(s)) return 'live';
  return 'unknown';
};

const RANK_SCORE = (raw) => {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes('above average')) return 1;
  if (s.includes('below average')) return -1;
  if (s.includes('average')) return 0;
  return null;
};

/* ---------------------------- date parsing ---------------------------- */

// D/M/Y and M/D/Y are indistinguishable per cell. Decided per file:
// a component above 12 settles it outright; failing that, the position with
// more distinct values across the file is the day (a 30-day export has ~30
// distinct days and one or two distinct months).
export const detectDateOrder = (samples, fallback = 'dmy') => {
  const aVals = new Set(), bVals = new Set();
  let sawAmbiguousForm = false;
  for (const s of samples) {
    const m = String(s ?? '').trim().match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
    if (!m) continue;
    sawAmbiguousForm = true;
    const a = +m[1], b = +m[2];
    if (a > 12) return { order: 'dmy', certain: true };
    if (b > 12) return { order: 'mdy', certain: true };
    aVals.add(a); bVals.add(b);
  }
  if (!sawAmbiguousForm) return { order: fallback, certain: true };
  if (aVals.size > bVals.size + 1) return { order: 'dmy', certain: true };
  if (bVals.size > aVals.size + 1) return { order: 'mdy', certain: true };
  return { order: fallback, certain: false };
};

export const normaliseDate = (raw, order = 'dmy') => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || /^ongoing$/i.test(s)) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = s.match(/^(\d{8})$/);
  if (m) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    let day, mon;
    if (a > 12) { day = a; mon = b; }
    else if (b > 12) { day = b; mon = a; }
    else if (order === 'mdy') { mon = a; day = b; }
    else { day = a; mon = b; }
    return `${m[3]}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return null;
};

export const bucketDate = (iso, grain) => {
  if (!iso) return null;
  if (grain === 'day') return iso;
  const [y, m, d] = iso.split('-').map(Number);
  if (grain === 'month') return `${y}-${String(m).padStart(2, '0')}-01`;
  if (grain === 'week') {
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() - dow + 1);
    return dt.toISOString().slice(0, 10);
  }
  return iso;
};

/* ============================== PARSER ============================== */

export const parseMetaCSV = (text, fileName = 'Export') => {
  const table = parseCSV(text);
  if (table.length < 2) throw new Error('That file has no data rows. Export from Ads Manager with "Export table data".');

  // Meta sometimes precedes the header with account/date preamble lines.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(table.length, 12); i++) {
    const l = table[i].map(lower);
    if (l.some(h => /campaign name|ad set name|ad name|amount spent|impressions/.test(h))) { headerIdx = i; break; }
  }
  const numberLocale = detectNumberLocale(table.slice(headerIdx + 1));
  const num = (v) => toNumber(v, numberLocale);
  const headers = table[headerIdx].map(clean);
  const lows = headers.map(lower);
  const body = table.slice(headerIdx + 1).filter(r => r.length > 1);
  if (!body.length) throw new Error('Header found but no data rows beneath it.');

  const warnings = [];
  const notes = [];

  /* --- currency --- */
  let currency = null;
  headers.forEach(h => {
    const m = h.match(/\(([A-Z]{3})\)\s*$/);
    if (m && !currency && /amount spent|cpc|cpm|cost per|value|budget/i.test(h)) currency = m[1];
  });
  const curIdx = lows.findIndex(h => /^currency$/.test(h));
  if (!currency && curIdx > -1) {
    const v = clean(body[0][curIdx]);
    if (/^[A-Z]{3}$/.test(v)) currency = v;
  }
  if (!currency) {
    const spendIdx = lows.findIndex(h => /^amount spent|^spend/.test(h));
    if (spendIdx > -1) {
      const sample = String(body[0][spendIdx] || '');
      if (sample.includes('$')) currency = 'USD';
      else if (sample.includes('€')) currency = 'EUR';
      else if (sample.includes('£')) currency = 'GBP';
    }
  }
  if (!currency) { currency = 'GBP'; notes.push('No currency column found, so amounts are assumed to be GBP. The figures themselves are exact.'); }

  /* --- entity hierarchy --- */
  const entityIdx = {};
  ENTITY_COLS.forEach(({ level, match }) => {
    const i = lows.findIndex(h => matchAny(h, match));
    if (i > -1) entityIdx[level] = i;
  });
  const levelsPresent = ['campaign', 'adset', 'ad'].filter(l => entityIdx[l] !== undefined);
  if (!levelsPresent.length) {
    // Fall back to the first non-numeric column as the entity name.
    const i = lows.findIndex((h, ix) => !looksNumeric(body[0][ix]) && clean(headers[ix]) !== '');
    if (i === -1) throw new Error('Could not find a Campaign / Ad set / Ad name column.');
    entityIdx.campaign = i;
    levelsPresent.push('campaign');
    notes.push(`No standard name column found, so "${headers[i]}" is being used as the entity name.`);
  }
  const finestLevel = levelsPresent[levelsPresent.length - 1];

  /* --- time grain --- */
  let dateIdx = -1, timeGrain = 'lifetime';
  for (const g of ['day', 'week', 'month']) {
    const i = lows.findIndex(h => matchAny(h, DATE_COLS[g]));
    if (i > -1) { dateIdx = i; timeGrain = g; break; }
  }
  const startIdx = lows.findIndex(h => matchAny(h, DATE_COLS.start));
  const endIdx = lows.findIndex(h => matchAny(h, DATE_COLS.end));
  if (dateIdx === -1 && startIdx > -1) dateIdx = startIdx;

  // Decide D/M/Y vs M/D/Y once, from every date in the file. A US export
  // read day-first silently relabels every month.
  const dateSamples = dateIdx > -1 ? body.map(r => r[dateIdx]) : [];
  const localePrior = numberLocale === 'eu' ? 'dmy' : (currency === 'USD' ? 'mdy' : 'dmy');
  const dateOrderInfo = detectDateOrder(dateSamples, localePrior);
  const dOrder = dateOrderInfo.order;

  /* --- breakdowns --- */
  const breakdownIdx = {};
  lows.forEach((h, i) => { if (matchAny(h, BREAKDOWN_COLS)) breakdownIdx[headers[i]] = i; });

  /* --- settings + ordinals --- */
  const settingIdx = {};
  SETTING_COLS.forEach(({ role, match }) => {
    const i = lows.findIndex(h => match.test(h));
    if (i > -1 && !Object.values(settingIdx).includes(i)) settingIdx[role] = i;
  });
  const ordinalIdx = {};
  ORDINAL_COLS.forEach(({ role, match }) => {
    const i = lows.findIndex(h => match.test(h));
    if (i > -1) ordinalIdx[role] = i;
  });

  /* --- metrics --- */
  const usedIdx = new Set([
    ...Object.values(entityIdx), ...Object.values(breakdownIdx),
    ...Object.values(settingIdx), ...Object.values(ordinalIdx),
    dateIdx, startIdx, endIdx,
  ].filter(i => i !== undefined && i > -1));

  const isNumericColumn = (i) => {
    let seen = 0, numeric = 0;
    for (let r = 0; r < Math.min(body.length, 60); r++) {
      const v = body[r][i];
      if (v === undefined || String(v).trim() === '') continue;
      seen++;
      if (looksNumeric(v)) numeric++;
    }
    return seen > 0 && numeric / seen >= 0.9;
  };

  const roleIdx = {};        // canonical role -> column index
  const metricCols = [];     // every numeric column, for the raw explorer
  const idColumns = [];      // ID columns are numeric but are identifiers

  headers.forEach((h, i) => {
    if (usedIdx.has(i)) return;
    if (/\bid\b/i.test(h)) { idColumns.push(h); return; }
    if (!isNumericColumn(i)) return;
    const hl = lows[i];
    let matched = null;
    for (const rule of METRIC_RULES) {
      if (matchAny(hl, rule.match)) { matched = rule; break; }
    }
    const unit = matched ? matched.unit
      : /%|rate|ctr$/.test(hl) ? 'pct'
      : /^cost per|^cpc|^cpm|value|spent|budget|amount/.test(hl) ? 'currency'
      : /roas|ratio/.test(hl) ? 'ratio' : 'int';
    const agg = matched ? matched.agg : (unit === 'pct' || unit === 'ratio' || /^cost per/.test(hl) ? 'derived' : 'sum');
    const col = {
      header: h, index: i, role: matched?.role || null, agg, unit,
      num: matched?.num || null, den: matched?.den || null, mult: matched?.mult || 1,
    };
    metricCols.push(col);
    if (matched && roleIdx[matched.role] === undefined) roleIdx[matched.role] = col;
  });

  if (roleIdx.spend === undefined) {
    throw new Error('No "Amount spent" column detected. In Ads Manager choose Columns → Performance (or add Amount spent) before exporting.');
  }

  /* --- rows --- */
  const rows = [];
  let minDate = null, maxDate = null;
  let reportStart = null, reportEnd = null;
  let ambiguousDates = false;
  const indicatorTotals = {};
  let statedTotals = null;
  let clicksDerived = null;
  const attributionSet = new Set();
  const skipped = { total: 0, blank: 0 };

  const nameOf = (cols, level) => (entityIdx[level] !== undefined ? clean(cols[entityIdx[level]]) : '');

  for (const cols of body) {
    const campaign = nameOf(cols, 'campaign');
    const adset = nameOf(cols, 'adset');
    const ad = nameOf(cols, 'ad');
    const finest = finestLevel === 'ad' ? ad : finestLevel === 'adset' ? adset : campaign;

    // Meta appends a grand-total row with blank names, and some exports
    // repeat the account name there.
    // Meta appends its own grand-total row with every name blank. It is not
    // data, but it IS an independent statement of the account totals, which
    // makes it the best possible check on our own arithmetic.
    if (!finest) {
      skipped.blank++;
      const s = roleIdx.spend ? num(cols[roleIdx.spend.index]) : null;
      if (s !== null && (!statedTotals || s > statedTotals.spend)) {
        statedTotals = {
          spend: s,
          impressions: roleIdx.impressions ? num(cols[roleIdx.impressions.index]) : null,
          clicks: roleIdx.linkClicks ? num(cols[roleIdx.linkClicks.index])
            : roleIdx.allClicks ? num(cols[roleIdx.allClicks.index]) : null,
          reach: roleIdx.reach ? num(cols[roleIdx.reach.index]) : null,
        };
      }
      continue;
    }
    if (/^(total|totals|grand total|summary)$/i.test(finest)) { skipped.total++; continue; }

    const rawDate = dateIdx > -1 ? cols[dateIdx] : null;
    if (!dateOrderInfo.certain && rawDate && /^\d{1,2}[/.]\d{1,2}[/.]\d{4}/.test(String(rawDate).trim())) {
      ambiguousDates = true;
    }
    const date = normaliseDate(rawDate, dOrder);
    if (startIdx > -1) {
      const rs = normaliseDate(cols[startIdx], dOrder);
      if (rs && (!reportStart || rs < reportStart)) reportStart = rs;
    }
    if (endIdx > -1) {
      const re = normaliseDate(cols[endIdx], dOrder);
      if (re && (!reportEnd || re > reportEnd)) reportEnd = re;
    }
    if (date) {
      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;
    }

    const get = (role) => (roleIdx[role] ? num(cols[roleIdx[role].index]) : null);

    const spend = get('spend') || 0;
    const impressions = get('impressions') || 0;
    const reach = get('reach');
    const linkClicks = get('linkClicks');
    const allClicks = get('allClicks');
    /* Some column sets ship the click RATES but not the click COUNT. Meta
       computes CTR = clicks / impressions and CPC = spend / clicks, so the
       count is exactly recoverable, and the two routes agree to the unit
       wherever both columns are present. Without this, click-through rate
       reads as a flat zero and the funnel diagnosis silently disappears. */
    let clicks = linkClicks !== null ? linkClicks : allClicks;
    if (clicks === null) {
      const ctrPct = roleIdx.ctr ? num(cols[roleIdx.ctr.index]) : null;
      if (ctrPct !== null && impressions > 0) {
        clicks = Math.round((ctrPct / 100) * impressions);
        clicksDerived = 'CTR';
      } else {
        const cpcVal = roleIdx.cpc ? num(cols[roleIdx.cpc.index]) : null;
        if (cpcVal !== null && cpcVal > 0 && spend > 0) {
          clicks = Math.round(spend / cpcVal);
          clicksDerived = 'CPC';
        }
      }
    }
    if (clicks === null) clicks = 0;
    const results = get('results');
    const indicator = settingIdx.resultIndicator !== undefined
      ? canonicalIndicator(cols[settingIdx.resultIndicator]) : null;

    let purchases = get('purchases');
    if (purchases === null && indicator === 'Purchase' && results !== null) purchases = results;

    // Revenue may arrive as a value column or only as a ROAS multiple.
    let revenue = get('revenue');
    if (revenue === null && roleIdx.roas) {
      const r = num(cols[roleIdx.roas.index]);
      if (r !== null) revenue = r * spend;
    }

    const attribution = settingIdx.attribution !== undefined ? clean(cols[settingIdx.attribution]) : '';
    if (attribution) attributionSet.add(attribution);

    if (indicator) {
      indicatorTotals[indicator] = indicatorTotals[indicator] || { spend: 0, results: 0 };
      indicatorTotals[indicator].spend += spend;
      indicatorTotals[indicator].results += results || 0;
    }

    const breakdown = {};
    Object.entries(breakdownIdx).forEach(([name, i]) => { breakdown[name] = clean(cols[i]) || '(none)'; });

    const raw = {};
    metricCols.forEach(c => { const v = num(cols[c.index]); if (v !== null) raw[c.header] = v; });

    rows.push({
      campaign, adset, ad, date,
      breakdown,
      spend, impressions,
      reach: reach === null ? null : reach,
      clicks, linkClicks, allClicks,
      results: results === null ? null : results,
      indicator,
      purchases: purchases === null ? null : purchases,
      revenue: revenue === null ? null : revenue,
      attribution,
      delivery: settingIdx.delivery !== undefined ? clean(cols[settingIdx.delivery]) : '',
      objective: settingIdx.objective !== undefined ? clean(cols[settingIdx.objective]) : '',
      bidStrategy: settingIdx.bidStrategy !== undefined ? clean(cols[settingIdx.bidStrategy]) : '',
      budget: settingIdx.budget !== undefined ? num(cols[settingIdx.budget]) : null,
      ranks: {
        quality: ordinalIdx.qualityRank !== undefined ? RANK_SCORE(cols[ordinalIdx.qualityRank]) : null,
        engagement: ordinalIdx.engagementRank !== undefined ? RANK_SCORE(cols[ordinalIdx.engagementRank]) : null,
        conversion: ordinalIdx.conversionRank !== undefined ? RANK_SCORE(cols[ordinalIdx.conversionRank]) : null,
      },
      raw,
    });
  }

  if (!rows.length) throw new Error('Every row was skipped. The export may contain only a summary line.');

  const periodDays = reportStart && reportEnd
    ? Math.round((new Date(reportEnd) - new Date(reportStart)) / 86400000) + 1 : null;

  /* --- blank Result indicator ---------------------------------------------
     Meta leaves Result indicator empty on any row where the entity produced
     no results in that period. Treating blank as "a different goal" and
     excluding its spend understates cost per result badly, easily by a third
     on an account where most days produce nothing. So each entity's blank
     rows inherit that entity's own stated goal, and entities that never state
     one inherit the account's primary goal, which keeps their spend visible
     as waste rather than hiding it. */
  const goalByEntity = new Map();
  for (const r of rows) {
    if (!r.indicator) continue;
    const k = entityKey(r, finestLevel);
    const seen = goalByEntity.get(k) || {};
    seen[r.indicator] = (seen[r.indicator] || 0) + (r.spend || 0);
    goalByEntity.set(k, seen);
  }
  const ownGoal = new Map();
  goalByEntity.forEach((seen, k) => {
    ownGoal.set(k, Object.entries(seen).sort((a, b) => b[1] - a[1])[0][0]);
  });
  let filledBlank = 0, orphanSpend = 0;
  for (const r of rows) {
    if (r.indicator) continue;
    const g = ownGoal.get(entityKey(r, finestLevel));
    if (g) { r.indicator = g; r.indicatorInferred = true; filledBlank++; }
    else { r.indicatorOrphan = true; orphanSpend += r.spend || 0; }
  }

  /* --- lifetime detection: one row per entity+breakdown, no time series --- */
  const distinctDates = [...new Set(rows.map(r => r.date).filter(Boolean))].sort();
  if (timeGrain === 'lifetime' && distinctDates.length > 1) {
    // When a time breakdown is applied, Meta puts each period's date into
    // Reporting starts/ends rather than adding a Day column. Spacing between
    // consecutive dates tells us which period it is.
    const gaps = [];
    for (let i = 1; i < Math.min(distinctDates.length, 60); i++) {
      gaps.push((new Date(distinctDates[i]) - new Date(distinctDates[i - 1])) / 86400000);
    }
    const g = median(gaps) || 1;
    timeGrain = g <= 1.5 ? 'day' : g <= 10 ? 'week' : 'month';
    notes.push(`No separate time column, but Reporting starts covers ${distinctDates.length} distinct dates, so this has been read as ${timeGrain} level data.`);
  } else if (timeGrain === 'lifetime' || distinctDates.length <= 1) {
    timeGrain = 'lifetime';
    const lvlWord = finestLevel === 'ad' ? 'ad' : finestLevel === 'adset' ? 'ad set' : 'campaign';
    notes.push(
      reportStart && reportEnd && reportStart !== reportEnd
        ? `Every row covers the same window, ${reportStart} to ${reportEnd} (${periodDays} days), so this file holds one combined total per ${lvlWord} rather than a series. Reporting starts and Reporting ends describe that single window, which is why there is no trend to draw. Re-exporting with Breakdown → By Time → Day repeats each ${lvlWord} once per day and unlocks trends, click-through decay and period comparison.`
        : `This export has one row per ${lvlWord} with no time breakdown, so trends over time are unavailable. Re-export with Breakdown → By Time → Day to unlock trend and fatigue analysis.`
    );
  }

  /* --- primary conversion --- */
  const totalPurchases = rows.reduce((s, r) => s + (r.purchases || 0), 0);
  const indicatorNames = Object.keys(indicatorTotals);
  let convRole = 'purchases', convLabel = 'Purchases', primaryIndicator = null;
  if (totalPurchases > 0) {
    // Purchases exist, either as their own column or via Results rows whose
    // indicator is a purchase. Either way the goal is pinned so that rows
    // optimising for something else stay out of the cost calculation.
    if (indicatorNames.includes('Purchase')) primaryIndicator = 'Purchase';
  } else {
    // No explicit purchase column: fall back to Results, but pin it to the
    // single dominant goal. Adding Engagements to Purchases would produce a
    // headline number that means nothing.
    const dominant = Object.entries(indicatorTotals).sort((a, b) => b[1].spend - a[1].spend)[0];
    convRole = 'results';
    if (dominant && dominant[1].results > 0) {
      primaryIndicator = dominant[0];
      convLabel = dominant[0] === 'Purchase' ? 'Purchases'
        : /s$/.test(dominant[0]) ? dominant[0] : dominant[0] + 's';
    } else {
      convLabel = 'Results';
    }
  }

  const indicators = indicatorNames;
  if (indicators.length > 1) {
    warnings.push(`This export mixes ${indicators.length} optimisation goals (${indicators.join(', ')}). "Results" means something different in each, so blended cost-per-result is not comparable across them. Use the goal filter to isolate one.`);
  }
  if (attributionSet.size > 1) {
    warnings.push(`Rows use ${attributionSet.size} different attribution settings (${[...attributionSet].join(' · ')}). Conversion counts are not directly comparable between them.`);
  }
  if (Object.keys(breakdownIdx).length) {
    notes.push(`Breakdown detected: ${Object.keys(breakdownIdx).join(', ')}. Each entity spans multiple rows; additive metrics are summed and Reach is treated as non-additive.`);
  }
  if (roleIdx.reach && Object.keys(breakdownIdx).length) {
    warnings.push('Reach cannot be added up across breakdown rows (the same person appears in several). Reach and Frequency are shown only where a single row covers the entity.');
  }
  if (ambiguousDates) {
    warnings.push(`Dates could be either day-first or month-first and there was not enough variety in the file to be sure. They have been read as ${dOrder === 'mdy' ? 'month-first (US)' : 'day-first (UK/EU)'}, so check the date range below looks right.`);
  }
  if (statedTotals) {
    const ourSpend = rows.reduce((s, r) => s + (r.spend || 0), 0);
    const drift = statedTotals.spend > 0 ? Math.abs(ourSpend - statedTotals.spend) / statedTotals.spend : 0;
    if (drift > 0.005) {
      warnings.push(`This file states account totals of ${statedTotals.spend.toFixed(2)} but its rows add up to ${ourSpend.toFixed(2)}, a ${(drift * 100).toFixed(1)}% gap. Either rows are missing from the export or a column has been misread, so check the mapping below before trusting anything here.`);
    } else {
      notes.push(`Rows reconcile with the account total Meta states in this file (${statedTotals.spend.toFixed(2)}), so nothing has been dropped or double counted.`);
    }
  }
  if (filledBlank) {
    notes.push(`${nfmt(filledBlank)} rows had a blank Result indicator, which is how Meta marks a period with no results. They have been attributed to their own entity's goal so their spend still counts towards cost per result.`);
  }
  if (orphanSpend > 0) {
    notes.push(`${orphanSpend.toFixed(2)} of spend sits on entities that never recorded a single result, so their goal is unknown. It is counted against the primary goal, which is what makes it show up as waste rather than disappearing.`);
  }
  if (roleIdx.reach && timeGrain !== 'lifetime') {
    notes.push('Reach is reported per day in this export and cannot be added up, because someone reached on several days is one person counted several times. Deduplicated reach for the whole period is therefore unavailable here, and average daily reach and frequency are shown instead. An export without a day breakdown gives the true period figures.');
  }
  if (clicksDerived) {
    notes.push(`This export has no click count column, so clicks have been recovered from ${clicksDerived === 'CTR' ? 'click-through rate multiplied by impressions' : 'spend divided by cost per click'}. That is exact arithmetic rather than an estimate, and it is what makes click-through rate, post-click conversion rate and the funnel diagnosis available at all. Add "Link clicks" to the export if you would rather read the figure straight from Meta.`);
  }
  if (!roleIdx.linkClicks && (roleIdx.allClicks || clicksDerived)) {
    warnings.push('This export measures all clicks rather than link clicks. Every click is counted, including reactions, comments, shares and profile taps, so the click-through rate here reads higher and the click-to-result rate lower than the link-click versions in Ads Manager. Comparisons between entities stay valid because the basis is the same for all of them; only the absolute levels shift. Add "Link clicks" to the export for a like-for-like figure.');
  }
  if (levelsPresent.length === 1 && finestLevel === 'campaign') {
    notes.push('Campaign-level export: ad set and ad comparison need an export at that level (Ads Manager → Ads tab → Export).');
  }

  return {
    fileName,
    currency,
    currencySymbol: { GBP: '£', USD: '$', EUR: '€', JPY: '¥', INR: '₹' }[currency] || '',
    levelsPresent, finestLevel, timeGrain, dateOrder: dOrder,
    dateRange: { start: minDate, end: maxDate },
    reportingRange: { start: reportStart, end: reportEnd },
    periodDays,
    breakdowns: Object.keys(breakdownIdx),
    indicators, indicatorTotals,
    attributions: [...attributionSet],
    convRole, convLabel, convSingular: convLabel.replace(/ies$/, 'y').replace(/s$/, ''),
    primaryIndicator, numberLocale, statedTotals,
    hasReach: !!roleIdx.reach,
    clicksDerived,
    hasRevenue: !!(roleIdx.revenue || roleIdx.roas),
    hasRanks: Object.keys(ordinalIdx).length > 0,
    metricCols, idColumns,
    detected: {
      entity: Object.fromEntries(Object.entries(entityIdx).map(([k, v]) => [k, headers[v]])),
      date: dateIdx > -1 ? headers[dateIdx] : null,
      roles: Object.fromEntries(Object.entries(roleIdx).map(([k, v]) => [k, v.header])),
      settings: Object.fromEntries(Object.entries(settingIdx).map(([k, v]) => [k, headers[v]])),
      ranks: Object.fromEntries(Object.entries(ordinalIdx).map(([k, v]) => [k, headers[v]])),
      ignored: headers.filter((h, i) => !usedIdx.has(i) && !metricCols.some(c => c.index === i) && !idColumns.includes(h) && clean(h) !== ''),
    },
    rowCount: rows.length,
    skipped,
    warnings, notes,
    rows,
  };
};

/* =========================== AGGREGATION =========================== */

const blankSums = () => ({
  spend: 0, impressions: 0, clicks: 0, linkClicks: 0, purchases: 0, revenue: 0,
  results: 0, convSpend: 0, conv: 0, rowCount: 0,
  reachSum: 0, reachRows: 0, reachMax: 0, reachImps: 0, budget: null, offGoalSpend: 0,
  statusLatest: null, statusAt: null, statusMix: new Set(), activeDays: new Set(),
  rankQ: [], rankE: [], rankC: [],
  indicators: new Set(), attributions: new Set(), delivery: new Set(),
  minDate: null, maxDate: null,
});

const addRow = (a, r, ds) => {
  const convRole = typeof ds === 'string' ? ds : ds.convRole;
  const primary = typeof ds === 'string' ? null : ds.primaryIndicator;
  a.spend += r.spend || 0;
  a.impressions += r.impressions || 0;
  a.clicks += r.clicks || 0;
  a.linkClicks += r.linkClicks || 0;
  a.purchases += r.purchases || 0;
  a.revenue += r.revenue || 0;
  a.results += r.results || 0;
  // Only rows optimising for the primary goal contribute to the conversion
  // count, and only their spend belongs in the cost-per-result denominator.
  const onGoal = convRole === 'purchases'
    ? (r.purchases !== null || r.indicator === 'Purchase' || !r.indicator)
    : (!primary || !r.indicator || r.indicator === primary || r.indicatorOrphan);
  if (onGoal) {
    a.conv += convRole === 'purchases' ? (r.purchases || 0) : (r.results || 0);
    a.convSpend += r.spend || 0;
  } else {
    a.offGoalSpend += r.spend || 0;
  }
  if (r.reach !== null && r.reach !== undefined && r.reach > 0) {
    a.reachSum += r.reach; a.reachRows++;
    if (r.reach > a.reachMax) a.reachMax = r.reach;
    a.reachImps += r.impressions || 0;   // impressions from rows that reported reach
  }
  if (r.budget !== null && r.budget !== undefined && a.budget === null) a.budget = r.budget;
  if (r.ranks?.quality !== null && r.ranks?.quality !== undefined) a.rankQ.push(r.ranks.quality);
  if (r.ranks?.engagement !== null && r.ranks?.engagement !== undefined) a.rankE.push(r.ranks.engagement);
  if (r.ranks?.conversion !== null && r.ranks?.conversion !== undefined) a.rankC.push(r.ranks.conversion);
  if (r.indicator) a.indicators.add(r.indicator);
  if (r.attribution) a.attributions.add(r.attribution);
  if (r.delivery) {
    a.delivery.add(r.delivery);
    // With day-level rows an ad's status changes over time, so the newest
    // row is the one that describes it now.
    const at = r.date || '';
    if (a.statusAt === null || at >= a.statusAt) { a.statusAt = at; a.statusLatest = r.delivery; }
    a.statusMix.add(normaliseStatus(r.delivery));
  }
  if (r.date) {
    if (!a.minDate || r.date < a.minDate) a.minDate = r.date;
    if (!a.maxDate || r.date > a.maxDate) a.maxDate = r.date;
    // Days it actually delivered, which is not the same as the span between
    // its first and last day: most ads run in bursts with long gaps.
    if ((r.spend || 0) > 0) a.activeDays.add(r.date);
  }
  a.rowCount++;
};

export const deriveMetrics = (a, opts = {}) => {
  /* Reach is the one Meta metric that cannot be added up: a person reached on
     twenty different days is one person counted twenty times. Summing daily
     reach can overstate the deduplicated figure by more than half, which
     drags frequency down by the same proportion and makes a fatiguing entity
     look completely fresh.

     So the deduplicated period figure is only reported when a single row
     covers the whole entity. When it does not, the daily figures are still
     real and worth showing, they simply answer a different question: how many
     people on a typical day, seeing it how often that day. */
  const singleReachRow = a.reachRows === 1;
  const reach = singleReachRow ? a.reachSum : null;
  const clicks = a.linkClicks || a.clicks;
  const conv = a.conv;
  // On-goal spend, never a fallback to total spend: a campaign optimising
  // for Engagement contributes nothing to a purchase-CPA denominator, and
  // treating its zero as "missing" silently inflated blended CPA.
  const cpaSpend = opts.strictCpaSpend === false ? a.spend : a.convSpend;
  return {
    spend: a.spend,
    offGoalSpend: a.offGoalSpend || 0,
    impressions: a.impressions,
    clicks,
    conv,
    purchases: a.purchases,
    results: a.results,
    revenue: a.revenue,
    reach,
    frequency: reach > 0 ? a.impressions / reach : null,
    reachBasis: a.reachRows === 0 ? null : singleReachRow ? 'period' : 'daily',
    reachDays: a.reachRows || null,
    reachDailyAvg: a.reachRows > 1 ? a.reachSum / a.reachRows : null,
    reachPeak: a.reachRows > 1 ? a.reachMax : null,
    // Impressions per person per day. Deduplicated within a day by Meta, so
    // this is exact, and it is a lower bound on true period frequency.
    frequencyDaily: a.reachRows > 1 && a.reachSum > 0 ? a.reachImps / a.reachSum : null,
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null,
    ctr: a.impressions > 0 ? (clicks / a.impressions) * 100 : null,
    cpc: clicks > 0 ? a.spend / clicks : null,
    cvr: clicks > 0 ? (conv / clicks) * 100 : null,
    cpa: conv > 0 ? cpaSpend / conv : null,
    cpaSpend,
    roas: a.spend > 0 && a.revenue > 0 ? a.revenue / a.spend : null,
    aov: conv > 0 && a.revenue > 0 ? a.revenue / conv : null,
    rankQuality: a.rankQ.length ? median(a.rankQ) : null,
    rankEngagement: a.rankE.length ? median(a.rankE) : null,
    rankConversion: a.rankC.length ? median(a.rankC) : null,
    budget: a.budget,
    rowCount: a.rowCount,
    deliveryStatus: a.statusLatest,
    // Several rows can share a name (the same ad in two ad sets, or a day
    // series spanning a pause). If any part is still delivering, treat the
    // whole as live: wrongly hiding something that is still spending is the
    // more expensive mistake.
    status: a.statusMix.has('live') ? 'live'
      : a.statusMix.has('off') ? 'off'
        : normaliseStatus(a.statusLatest),
    indicators: [...a.indicators],
    attributions: [...a.attributions],
    delivery: [...a.delivery],
    activeDays: a.activeDays.size || null,
    spanDays: a.minDate && a.maxDate
      ? Math.round((new Date(a.maxDate) - new Date(a.minDate)) / 86400000) + 1 : null,
    minDate: a.minDate, maxDate: a.maxDate,
  };
};

// Group rows into entities at a level, honouring filters.
// Real Ads Manager exports contain ONE name column: an Ads export has no
// campaign or ad set column at all. Prefixing with an absent parent would
// produce keys like " > Ad name".
export const entityKey = (r, level) => {
  if (level === 'campaign') return r.campaign || '(unnamed)';
  if (level === 'adset') return r.campaign ? `${r.campaign} ▸ ${r.adset || '(unnamed)'}` : (r.adset || '(unnamed)');
  return r.adset ? `${r.adset} ▸ ${r.ad || '(unnamed)'}` : (r.ad || '(unnamed)');
};

export const aggregate = (ds, { level = ds.finestLevel, filters = {}, groupBy = null } = {}) => {
  const keyFor = (r) => (groupBy ? groupBy(r) : entityKey(r, level));
  const map = new Map();
  for (const r of ds.rows) {
    if (filters.dateFrom && r.date && r.date < filters.dateFrom) continue;
    if (filters.dateTo && r.date && r.date > filters.dateTo) continue;
    if (filters.indicator && r.indicator !== filters.indicator) continue;
    if (filters.campaign && r.campaign !== filters.campaign) continue;
    // Exact match, not substring: "inactive" contains "active", so a
    // substring test silently returned paused entities as live ones.
    if (filters.delivery && (r.delivery || '').toLowerCase() !== filters.delivery.toLowerCase()) continue;
    if (filters.breakdown) {
      const [dim, val] = filters.breakdown;
      if ((r.breakdown?.[dim] || '(none)') !== val) continue;
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = `${r.campaign} ${r.adset} ${r.ad}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const k = keyFor(r);
    if (!map.has(k)) map.set(k, { key: k, campaign: r.campaign, adset: r.adset, ad: r.ad, sums: blankSums() });
    addRow(map.get(k).sums, r, ds);
  }
  return [...map.values()].map(e => ({
    key: e.key,
    // When grouping by anything other than the entity itself, the label is
    // the group value. Falling back to a member's own name showed every
    // group under whichever row happened to create the bucket.
    name: groupBy ? e.key
      : level === 'ad' ? (e.ad || e.key) : level === 'adset' ? (e.adset || e.key) : e.campaign,
    campaign: e.campaign, adset: e.adset, ad: e.ad,
    m: deriveMetrics(e.sums),
    sums: e.sums,
  })).sort((a, b) => b.m.spend - a.m.spend);
};

/* =========================== BENCHMARKS =========================== */

// Spend-weighted account-level reference points. Weighted, because a
// £2 test ad's 9% CTR should not define "normal".
export const buildBenchmarks = (entities) => {
  const tot = entities.reduce((s, e) => s + e.m.spend, 0);
  const wsum = (f) => {
    let num = 0, den = 0;
    entities.forEach(e => { const v = f(e); if (v !== null && isFinite(v)) { num += v * e.m.spend; den += e.m.spend; } });
    return den > 0 ? num / den : null;
  };
  const totals = entities.reduce((a, e) => {
    a.spend += e.m.spend; a.impressions += e.m.impressions; a.clicks += e.m.clicks;
    a.conv += e.m.conv; a.revenue += e.m.revenue; a.cpaSpend += e.m.cpaSpend;
    return a;
  }, { spend: 0, impressions: 0, clicks: 0, conv: 0, revenue: 0, cpaSpend: 0 });

  return {
    totals,
    // True blended rates, computed from totals rather than averaged.
    cpm: totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : null,
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null,
    cvr: totals.clicks > 0 ? (totals.conv / totals.clicks) * 100 : null,
    cpa: totals.conv > 0 ? totals.cpaSpend / totals.conv : null,
    roas: totals.spend > 0 && totals.revenue > 0 ? totals.revenue / totals.spend : null,
    medianCpm: median(entities.map(e => e.m.cpm)),
    medianCtr: median(entities.map(e => e.m.ctr)),
    medianCvr: median(entities.map(e => e.m.cvr)),
    medianCpa: median(entities.filter(e => e.m.conv >= 3).map(e => e.m.cpa)),
    p25Cpa: quantile(entities.filter(e => e.m.conv >= 3).map(e => e.m.cpa), 0.25),
    weightedCtr: wsum(e => e.m.ctr),
    spendTotal: tot,
  };
};

/* ============================= VERDICTS ============================= */

export const DEFAULTS = {
  targetCpa: 30,
  minConv: 5,          // below this a CPA read is noise
  wasteMultiple: 3,    // spend > n × target with zero conv is decisive
  fatigueFreq: 2.5,
  scaleBand: 0.85,     // cpa <= target × this → scale
  watchBand: 1.25,
  cutBand: 1.5,
};

// Why is this entity expensive? Compare its funnel stages with the
// account benchmark: CPA = CPM ÷ (1000 × CTR × CVR), so exactly one of
// three things is usually to blame.
export const diagnose = (m, bench) => {
  const parts = [];
  const rel = (v, b, inverse = false) => {
    if (v === null || b === null || !(b > 0)) return null;
    return inverse ? b / v : v / b;   // >1 always means "worse"
  };
  const cpmRel = rel(m.cpm, bench.cpm);                  // higher = worse
  const ctrRel = rel(m.ctr, bench.ctr, true);            // lower ctr = worse
  const cvrRel = rel(m.cvr, bench.cvr, true);            // lower cvr = worse
  if (cpmRel !== null) parts.push({ stage: 'cpm', label: 'Auction cost', rel: cpmRel, value: m.cpm, bench: bench.cpm });
  if (ctrRel !== null) parts.push({ stage: 'ctr', label: 'Creative hook', rel: ctrRel, value: m.ctr, bench: bench.ctr });
  if (cvrRel !== null) parts.push({ stage: 'cvr', label: 'Landing & offer', rel: cvrRel, value: m.cvr, bench: bench.cvr });
  parts.sort((a, b) => b.rel - a.rel);
  const worst = parts[0] && parts[0].rel > 1.15 ? parts[0] : null;
  return { parts, worst };
};

export const fatigueSignal = (entity, ds, opts = DEFAULTS) => {
  const m = entity.m;
  const flags = [];
  if (m.frequency !== null && m.frequency >= opts.fatigueFreq) {
    flags.push({ kind: 'frequency', text: `Frequency ${m.frequency.toFixed(1)}, so the same people are seeing this repeatedly.` });
  }
  /* On a daily export the period frequency is unknown, and average daily
     frequency sits around 1.1 on a healthy account, so a static threshold
     never fires. A rising trend is the signal that survives: it means the
     audience is saturating even though each single day looks fine. */
  if (m.frequency === null && m.frequencyDaily !== null && opts.rowIndex) {
    const rs = (opts.rowIndex.get(entity.key) || [])
      .filter(r => r.date && r.reach > 0 && (r.spend || 0) > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (rs.length >= 21) {
      const c = Math.floor(rs.length / 3);
      const fq = (arr) => {
        const rr = arr.reduce((s, r) => s + r.reach, 0);
        return rr > 0 ? arr.reduce((s, r) => s + (r.impressions || 0), 0) / rr : null;
      };
      const a0 = fq(rs.slice(0, c)), a1 = fq(rs.slice(-c));
      if (a0 && a1 && a1 >= a0 * 1.15 && a1 >= 1.15) {
        flags.push({
          kind: 'frequencyTrend',
          text: `Average daily frequency has climbed from ${a0.toFixed(2)} to ${a1.toFixed(2)} across its run, which means the audience is saturating.`,
        });
      }
    }
  }
  if (m.rankQuality === -1) flags.push({ kind: 'quality', text: 'Meta rates this creative\u2019s quality below average against competing ads.' });
  if (m.rankEngagement === -1) flags.push({ kind: 'engagement', text: 'Meta rates its engagement rate below average.' });
  if (m.rankConversion === -1) flags.push({ kind: 'conversion', text: 'Meta rates its conversion rate below average.' });

  // CTR decay needs day-level data: first third vs last third of the run.
  if (ds.timeGrain !== 'lifetime') {
    // A 26k-row export scanned once per entity is 3M comparisons; the caller
    // passes a prebuilt index so this stays linear.
    const lvl = opts.level || ds.finestLevel;
    const rowsFor = opts.rowIndex
      ? (opts.rowIndex.get(entity.key) || [])
      : ds.rows.filter(r => r.date && entityKey(r, lvl) === entity.key);
    if (rowsFor.length >= 6) {
      const sorted = rowsFor.slice().sort((a, b) => a.date.localeCompare(b.date));
      const cut = Math.floor(sorted.length / 3);
      const head = sorted.slice(0, cut), tail = sorted.slice(-cut);
      const ctrOf = (arr) => {
        const imp = arr.reduce((s, r) => s + (r.impressions || 0), 0);
        const clk = arr.reduce((s, r) => s + (r.clicks || 0), 0);
        return imp > 500 ? (clk / imp) * 100 : null;
      };
      const a = ctrOf(head), b = ctrOf(tail);
      if (a && b && b < a * 0.75) {
        flags.push({ kind: 'ctrDecay', text: `Click-through rate has fallen ${Math.round((1 - b / a) * 100)}% from the start of its run to now.`, from: a, to: b });
      }
    }
  }
  return flags;
};

export const VERDICTS = {
  scale:  { label: 'Scale',      tone: 'good',    blurb: 'Beating target with enough data to trust. Give it more budget.' },
  keep:   { label: 'Keep',       tone: 'good',    blurb: 'At or under target. Leave it alone.' },
  watch:  { label: 'Watch',      tone: 'neutral', blurb: 'Slightly over target. Worth monitoring, not acting on yet.' },
  fix:    { label: 'Fix',        tone: 'warn',    blurb: 'Over target with an identifiable cause worth fixing before cutting.' },
  cut:    { label: 'Cut',        tone: 'bad',     blurb: 'Well over target with enough data to be confident. Stop the spend.' },
  starve: { label: 'Underfunded',tone: 'good',    blurb: 'Efficient but barely funded, which makes it the cheapest growth available.' },
  thin:   { label: 'No read',    tone: 'muted',   blurb: 'Not enough conversions yet for the cost figure to mean anything.' },
  restart:{ label: 'Restart',    tone: 'good',    blurb: 'Beat your target while it ran, and is switched off now. Turning it back on is the cheapest test you have.' },
  stopped:{ label: 'Already off',tone: 'muted',   blurb: 'Not delivering, so there is nothing left to stop. Kept as a record of what did not work.' },
};

export const scoreEntities = (entities, bench, ds, opts = {}) => {
  const o = { ...DEFAULTS, ...opts };
  if (!o.rowIndex && ds.timeGrain !== 'lifetime') {
    const lvl = o.level || ds.finestLevel;
    const idx = new Map();
    for (const r of ds.rows) {
      if (!r.date) continue;
      const k = entityKey(r, lvl);
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(r);
    }
    o.rowIndex = idx;
  }
  const target = o.targetCpa;
  const totalSpend = bench.totals.spend || 1;
  // "Underfunded" has to be relative to your other winners, not to account
  // share. With 117 ads the average share is under 1%, so a flat 5% rule
  // labelled the seventh-largest spender as underfunded.
  const winnerSpends = entities
    .filter(x => x.m.cpa !== null && x.m.cpa <= target && x.m.conv >= o.minConv)
    .map(x => x.m.spend);
  const topWinnerSpend = winnerSpends.length ? Math.max(...winnerSpends) : 0;

  return entities.map(e => {
    const m = e.m;
    const ci = cpaInterval(m.cpaSpend, m.conv);
    const dx = diagnose(m, bench);
    const fatigue = fatigueSignal(e, ds, o);
    const spendShare = m.spend / totalSpend;

    let verdict = 'thin';
    let reason = '';

    const confident = m.conv >= o.minConv;
    const decisiveZero = m.conv === 0 && m.spend >= target * o.wasteMultiple;

    if (decisiveZero) {
      verdict = 'cut';
      reason = `${fmtMoney(m.spend, ds)} spent with zero ${ds.convLabel.toLowerCase()}. At a ${fmtMoney(target, ds)} target you would expect about ${(m.spend / target).toFixed(1)}.`;
    } else if (!confident) {
      verdict = 'thin';
      const need = o.minConv - m.conv;
      reason = m.conv === 0
        ? `No ${ds.convLabel.toLowerCase()} yet and only ${fmtMoney(m.spend, ds)} spent, which is too early to judge.`
        : `Only ${m.conv} ${ds.convLabel.toLowerCase()} so far; roughly ${need} more before the cost figure settles.`;
    } else if (m.cpa <= target * o.scaleBand) {
      const underfunded = entities.length > 2 && topWinnerSpend > 0 && m.spend < topWinnerSpend * 0.3;
      verdict = underfunded ? 'starve' : 'scale';
      reason = underfunded
        ? `${fmtMoney(m.cpa, ds)} against a ${fmtMoney(target, ds)} target, on only ${fmtMoney(m.spend, ds)} of spend while your biggest performer at this efficiency gets ${fmtMoney(topWinnerSpend, ds)}.`
        : `${fmtMoney(m.cpa, ds)} against a ${fmtMoney(target, ds)} target across ${m.conv} ${ds.convLabel.toLowerCase()}.`;
    } else if (m.cpa <= target) {
      verdict = 'keep';
      reason = `${fmtMoney(m.cpa, ds)}, just inside the ${fmtMoney(target, ds)} target.`;
    } else if (m.cpa <= target * o.watchBand) {
      verdict = 'watch';
      reason = `${fmtMoney(m.cpa, ds)} is ${((m.cpa / target - 1) * 100).toFixed(0)}% over target${ci && ci.low <= target ? ', and the range still reaches target' : ''}.`;
    } else if (m.cpa > target * o.cutBand && ci && ci.low > target) {
      verdict = 'cut';
      reason = `${fmtMoney(m.cpa, ds)} is ${((m.cpa / target - 1) * 100).toFixed(0)}% over target and the uncertainty range stays above it.`;
    } else {
      verdict = dx.worst ? 'fix' : 'cut';
      reason = dx.worst
        ? `${fmtMoney(m.cpa, ds)} over target, driven by ${dx.worst.label.toLowerCase()}.`
        : `${fmtMoney(m.cpa, ds)} over target with no single stage to blame.`;
    }

    // Money that would not have been spent at target efficiency.
    const waste = m.conv > 0 && m.cpa > target ? m.cpaSpend - m.conv * target
      : m.conv === 0 ? m.spend : 0;

    /* Status rewrites the action, not the arithmetic. A switched-off ad that
       beat target is a restart candidate, which is a real opportunity nobody
       surfaces; a switched-off ad that lost money is simply history, and
       telling anyone to "cut" it is noise. */
    const label2 = ds.convLabel.toLowerCase();
    if (m.status === 'off') {
      if (verdict === 'scale' || verdict === 'starve' || verdict === 'keep') {
        verdict = 'restart';
        reason = `Delivered at ${fmtMoney(m.cpa, ds)} against a ${fmtMoney(target, ds)} target across ${m.conv} ${label2} while it ran, and it is switched off now.`
          + (m.conv < 20 ? ' That is a thin base, so treat turning it back on as a test rather than a certainty.' : '');
      } else if (verdict === 'cut' || verdict === 'fix' || verdict === 'watch') {
        const cost = m.cpa !== null ? `${fmtMoney(m.cpa, ds)} against a ${fmtMoney(target, ds)} target` : `${fmtMoney(m.spend, ds)} with no ${label2}`;
        verdict = 'stopped';
        reason = `${cost} while it ran. It is already switched off, so there is nothing left to stop.`;
      } else if (verdict === 'thin') {
        reason += ' It is switched off now, so it will not gather any more.';
      }
    }

    const live = m.status !== 'off';
    const savingIfFixed = live && ['cut', 'fix', 'watch'].includes(verdict) ? Math.max(0, waste) : 0;

    return {
      ...e,
      verdict, reason, ci, diagnosis: dx, fatigue, spendShare,
      confident, waste: Math.max(0, waste), savingIfFixed,
      // Only money still being spent can be saved. The rest is history.
      recoverable: live ? Math.max(0, waste) : 0,
      isLive: live, status: m.status,
      vsTarget: m.cpa !== null ? m.cpa / target - 1 : null,
    };
  });
};

/* ============================== FINDINGS ============================== */

const fmtMoney = (v, ds) => {
  if (v === null || v === undefined || !isFinite(v)) return '-';
  const sym = ds?.currencySymbol ?? '£';
  return sym + Math.round(v).toLocaleString('en-GB');
};
export const money = fmtMoney;

// Ranked, quantified actions. Each finding carries the money at stake so
// the list sorts itself by what matters rather than by what is loudest.
export const generateFindings = (scored, bench, ds, opts = {}) => {
  const o = { ...DEFAULTS, ...opts };
  const target = o.targetCpa;
  const out = [];
  const label = ds.convLabel.toLowerCase();
  const one = ds.convSingular || label.replace(/s$/, '');
  const levelWord = ds.finestLevel === 'ad' ? 'ad' : ds.finestLevel === 'adset' ? 'ad set' : 'campaign';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const isare = (n) => (n === 1 ? 'is' : 'are');
  // Every recommendation to spend or stop money applies only to what is
  // still delivering. Anything switched off is history and belongs in its
  // own finding, not in an instruction.
  const anyStatus = scored.some(e => e.status && e.status !== 'unknown');
  const live = anyStatus ? scored.filter(e => e.isLive) : scored;
  const off = anyStatus ? scored.filter(e => !e.isLive) : [];

  /* 1. Decisive zero-conversion spend */
  const zeros = live.filter(e => e.m.conv === 0 && e.m.spend >= target * o.wasteMultiple)
    .sort((a, b) => b.m.spend - a.m.spend);
  if (zeros.length) {
    const tot = zeros.reduce((s, e) => s + e.m.spend, 0);
    out.push({
      kind: 'cut', severity: 'high', impact: tot,
      title: `${fmtMoney(tot, ds)} still going to ${plural(zeros.length, levelWord)} with zero ${label}`,
      body: `${zeros.slice(0, 3).map(e => `"${e.name}" (${fmtMoney(e.m.spend, ds)})`).join(', ')}${zeros.length > 3 ? ` and ${zeros.length - 3} more` : ''}. Each has spent more than ${o.wasteMultiple} times the ${fmtMoney(target, ds)} target without a single ${one}, and each is still delivering, so stopping them saves money today.`,
      entities: zeros.slice(0, 8).map(e => e.key),
    });
  }

  /* 2. Overspending above target, i.e. the reallocation case */
  const bad = live.filter(e => e.verdict === 'cut' && e.m.conv > 0).sort((a, b) => b.waste - a.waste);
  const best = live.filter(e => ['scale', 'starve', 'keep'].includes(e.verdict) && e.m.conv >= o.minConv)
    .sort((a, b) => a.m.cpa - b.m.cpa)[0];
  if (bad.length && best) {
    const totWaste = bad.reduce((s, e) => s + e.waste, 0);
    const moveable = bad.reduce((s, e) => s + e.m.cpaSpend, 0);
    const gained = moveable / best.m.cpa - bad.reduce((s, e) => s + e.m.conv, 0);
    out.push({
      kind: 'reallocate', severity: 'high', impact: totWaste,
      title: `Moving ${fmtMoney(moveable, ds)} to "${best.name}" would buy roughly ${Math.round(Math.max(0, gained))} more ${label}`,
      body: `${plural(bad.length, levelWord)} ${isare(bad.length)} running above target at a combined ${fmtMoney(totWaste, ds)} more than target efficiency would have cost. "${best.name}" is live and delivering at ${fmtMoney(best.m.cpa, ds)}. This assumes its efficiency holds at higher spend, which it usually does not do perfectly, so treat the number as a ceiling and step budgets up rather than moving it all at once.`,
      entities: [best.key, ...bad.slice(0, 5).map(e => e.key)],
    });
  }

  /* 3. Efficient but starved */
  const starved = live.filter(e => e.verdict === 'starve').sort((a, b) => a.m.cpa - b.m.cpa);
  if (starved.length) {
    const e = starved[0];
    out.push({
      kind: 'scale', severity: 'medium', impact: e.m.conv * target,
      title: `"${e.name}" delivers ${label} at ${fmtMoney(e.m.cpa, ds)} on only ${fmtMoney(e.m.spend, ds)} of spend`,
      body: `It has produced ${e.m.conv} ${label} from ${fmtMoney(e.m.spend, ds)} and is still delivering. Efficient and underfunded is the cheapest growth available, so raise it in steps of 20 to 30% and watch whether the cost holds.`,
      entities: starved.slice(0, 5).map(e2 => e2.key),
    });
  }

  /* 3b. Switched-off winners. Restarting something that already worked is
     cheaper than finding a new creative, and no report surfaces it. */
  const restartable = off.filter(e => e.verdict === 'restart').sort((a, b) => a.m.cpa - b.m.cpa);
  if (restartable.length) {
    const top = restartable[0];
    const totConv = restartable.reduce((s, e) => s + e.m.conv, 0);
    out.push({
      kind: 'restart', severity: 'medium', impact: totConv * target,
      title: `${plural(restartable.length, levelWord)} beat your target but ${isare(restartable.length)} switched off`,
      body: `"${top.name}" delivered ${top.m.conv} ${label} at ${fmtMoney(top.m.cpa, ds)} before it stopped${restartable.length > 1 ? `, and ${restartable.length - 1} more did the same` : ''}. Restarting something that already worked costs less than finding a new creative. Check why each was paused first: a seasonal or promotional ad will not repeat its numbers outside that window, and a short run means a thin base.`,
      entities: restartable.slice(0, 6).map(e => e.key),
    });
  }

  /* 4. Concentration risk */
  const convVals = scored.map(e => e.m.conv);
  const share1 = topNShare(convVals, 1), share3 = topNShare(convVals, 3);
  const producers = scored.filter(e => e.m.conv > 0).length;
  if (share3 !== null && producers >= 3 && share3 > 0.7) {
    out.push({
      kind: 'risk', severity: 'medium', impact: bench.totals.spend * share3 * 0.2,
      title: `${(share3 * 100).toFixed(0)}% of ${label} come from just 3 ${levelWord}s`,
      body: `Only ${producers} ${levelWord}s are converting at all, and the single biggest carries ${(share1 * 100).toFixed(0)}%. That is a single point of failure: when it fatigues, the account drops with it. Getting a second and third engine working matters more than optimising the leader.`,
      entities: scored.filter(e => e.m.conv > 0).sort((a, b) => b.m.conv - a.m.conv).slice(0, 3).map(e => e.key),
    });
  }

  /* 5. Diagnosable creative vs landing problems */
  const ctrProblems = live.filter(e => e.m.conv >= 1 && e.diagnosis.worst?.stage === 'ctr' && e.m.spend > target)
    .sort((a, b) => b.m.spend - a.m.spend);
  if (ctrProblems.length) {
    const e = ctrProblems[0];
    out.push({
      kind: 'creative', severity: 'medium', impact: e.waste || e.m.spend * 0.2,
      title: `"${e.name}" is losing money at the hook, not the landing page`,
      body: `Its click-through rate is ${e.m.ctr?.toFixed(2)}% against an account blend of ${bench.ctr?.toFixed(2)}%, while cost per thousand impressions and post-click conversion are closer to normal. That points at the creative's first three seconds and headline rather than the page or the offer.`,
      entities: ctrProblems.slice(0, 4).map(x => x.key),
    });
  }
  const cvrProblems = live.filter(e => e.m.conv >= 1 && e.diagnosis.worst?.stage === 'cvr' && e.m.spend > target)
    .sort((a, b) => b.m.spend - a.m.spend);
  if (cvrProblems.length) {
    const e = cvrProblems[0];
    out.push({
      kind: 'landing', severity: 'medium', impact: e.waste || e.m.spend * 0.2,
      title: `"${e.name}" attracts clicks then loses them after the click`,
      body: `Click-through rate is healthy but only ${e.m.cvr?.toFixed(2)}% of clicks convert against ${bench.cvr?.toFixed(2)}% across the account. The creative is doing its job; the destination, offer or form is where this is failing. Check the landing page it points at before touching the ad.`,
      entities: cvrProblems.slice(0, 4).map(x => x.key),
    });
  }
  const cpmProblems = live.filter(e => e.diagnosis.worst?.stage === 'cpm' && e.m.spend > target * 2)
    .sort((a, b) => b.m.spend - a.m.spend);
  if (cpmProblems.length) {
    const e = cpmProblems[0];
    out.push({
      kind: 'auction', severity: 'low', impact: e.waste || 0,
      title: `"${e.name}" is paying ${((e.m.cpm / bench.cpm - 1) * 100).toFixed(0)}% more per thousand impressions than the account average`,
      body: `At ${fmtMoney(e.m.cpm, ds)} CPM versus ${fmtMoney(bench.cpm, ds)}, this is an auction problem: a narrow audience, heavy overlap with your other ad sets, or a restrictive placement setting. Widening the audience or letting placements run automatically usually costs less than reworking the creative.`,
      entities: cpmProblems.slice(0, 4).map(x => x.key),
    });
  }

  /* 6. Fatigue */
  const tired = live.filter(e => e.fatigue.length && e.m.spend > target).sort((a, b) => b.m.spend - a.m.spend);
  if (tired.length) {
    const e = tired[0];
    out.push({
      kind: 'fatigue', severity: 'medium', impact: e.m.spend * 0.15,
      title: `"${e.name}" is showing fatigue signals`,
      body: `${e.fatigue.map(f => f.text).join(' ')} Refreshing the creative or widening the audience usually recovers more than a bid change does.`,
      entities: tired.slice(0, 4).map(x => x.key),
    });
  }

  /* 7. Thin-data warning against premature verdicts */
  const thin = live.filter(e => e.verdict === 'thin' && e.m.spend > 0);
  const thinSpend = thin.reduce((s, e) => s + e.m.spend, 0);
  if (thin.length && thinSpend > bench.totals.spend * 0.15) {
    out.push({
      kind: 'patience', severity: 'low', impact: thinSpend,
      title: `${fmtMoney(thinSpend, ds)} (${((thinSpend / bench.totals.spend) * 100).toFixed(0)}% of spend) sits on ${levelWord}s with too few ${label} to judge`,
      body: `Fewer than ${o.minConv} conversions each means the cost figures there are mostly noise, a single extra conversion swings them by tens of percent. Either concentrate budget so some of them reach a readable volume, or accept that these are tests and hold the verdict.`,
      entities: thin.sort((a, b) => b.m.spend - a.m.spend).slice(0, 5).map(e => e.key),
    });
  }

  /* 7b. How much of this report is history rather than a decision */
  if (off.length) {
    const offSpend = off.reduce((s, e) => s + e.m.spend, 0);
    const share = bench.totals.spend > 0 ? offSpend / bench.totals.spend : 0;
    if (share > 0.25) {
      out.push({
        kind: 'history', severity: 'low', impact: 0,
        title: `${fmtMoney(offSpend, ds)}, ${(share * 100).toFixed(0)}% of the spend here, sits on ${plural(off.length, levelWord)} that ${isare(off.length)} already switched off`,
        body: `That money is spent and cannot be recovered, so those rows are a record rather than a decision. They are still worth reading for what worked and what did not. Use the status filter to see only what is live if you want the view that can still be changed.`,
        entities: [],
      });
    }
  }

  /* 8. Structural / measurement notes worth acting on */
  if (ds.attributions.length > 1) {
    out.push({
      kind: 'measurement', severity: 'low', impact: 0,
      title: 'Attribution windows differ between rows',
      body: `This export contains ${ds.attributions.join(' and ')}. An ad on a 7-day window will always look better than the same ad on 1-day, so like-for-like comparison needs a single setting. Set one window in Ads Manager and re-export.`,
      entities: [],
    });
  }
  if (ds.timeGrain === 'lifetime') {
    const win = ds.reportingRange?.start && ds.reportingRange?.end
      ? ` Its date columns cover ${ds.reportingRange.start} to ${ds.reportingRange.end}, but as a single window rather than a series.` : '';
    out.push({
      kind: 'measurement', severity: 'low', impact: 0,
      title: 'Everything here is one combined total per row, so trends and fatigue cannot be measured',
      body: `Re-export with Breakdown → By Time → Day.${win} A day breakdown repeats each row once per day, which is what makes the trend chart, click-through decay detection and period-over-period comparison possible.`,
      entities: [],
    });
  }

  return out.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return (b.impact || 0) - (a.impact || 0);
  });
};

/* ========================= NAMING INTELLIGENCE ========================= */

/* Structured names are the only route to cross-level analysis in real
   exports, because an Ads export contains no campaign or ad set column at
   all. But naming in practice is not rigidly positional: one name may have
   three parts and the next seven, with the format token sitting at the end of
   one and absent from another. So position is a weak signal and vocabulary is
   a strong one. */

export const splitName = (s) =>
  String(s || '').split(/[_|>·\-–—/]+|\s{2,}/).map(t => t.trim()).filter(Boolean);

// Marketing and Meta universals, safe to recognise on any account.
const VOCAB = [
  { label: 'Format', map: { video: 'Video', reel: 'Reel', post: 'Post', static: 'Static', carousel: 'Carousel', image: 'Image', story: 'Story', gif: 'GIF', ugc: 'UGC', collection: 'Collection' } },
  { label: 'Funnel stage', map: { tof: 'Top of funnel', mof: 'Middle of funnel', bof: 'Bottom of funnel', top: 'Top of funnel', retarget: 'Retargeting', retargeting: 'Retargeting', prospect: 'Prospecting', prospecting: 'Prospecting', remarketing: 'Retargeting' } },
  { label: 'Budget type', map: { abo: 'ABO', cbo: 'CBO' } },
  { label: 'Objective', map: { sales: 'Sales', leads: 'Leads', lead: 'Leads', traffic: 'Traffic', awareness: 'Awareness', engagement: 'Engagement', conversions: 'Conversions', reach: 'Reach' } },
  { label: 'Placement', map: { ig: 'Instagram', insta: 'Instagram', instagram: 'Instagram', fb: 'Facebook', facebook: 'Facebook', stories: 'Stories', feed: 'Feed', adv: 'Advantage+', advantage: 'Advantage+', lal: 'Lookalike', broad: 'Broad' } },
];

const QUARTER = /^(20\d{2})?q[1-4]$|^q[1-4](20\d{2})?$/i;
const YEAR = /^20\d{2}$/;
const PURE_NUM = /^\d+$/;

export const analyseNaming = (entities, opts = {}) => {
  const minCoverage = opts.minCoverage ?? 0.35;
  const names = entities.map(e => e.name || '');
  const tokenLists = names.map(splitName);
  const n = entities.length || 1;
  const dimensions = [];

  /* --- 1. vocabulary categories, found wherever they sit in the name --- */
  for (const cat of VOCAB) {
    const assign = (tokens) => {
      for (const t of tokens) {
        const hit = cat.map[t.toLowerCase()];
        if (hit) return hit;
      }
      return null;
    };
    const hits = tokenLists.map(assign);
    const covered = hits.filter(Boolean).length;
    const distinct = new Set(hits.filter(Boolean)).size;
    if (covered / n >= minCoverage && distinct >= 2) {
      dimensions.push({
        id: `v:${cat.label}`, kind: 'vocab', label: cat.label,
        values: distinct, coverage: covered / n, exclusive: true,
        assign: (name) => assign(splitName(name)) || '(unlabelled)',
      });
    }
  }

  /* --- 2. quarter / year, wherever they sit --- */
  for (const [label, re] of [['Quarter', QUARTER], ['Year', YEAR]]) {
    const assign = (tokens) => tokens.find(t => re.test(t)) || null;
    const hits = tokenLists.map(assign);
    const covered = hits.filter(Boolean).length;
    const distinct = new Set(hits.filter(Boolean)).size;
    if (covered / n >= minCoverage && distinct >= 2) {
      dimensions.push({
        id: `q:${label}`, kind: 'vocab', label,
        values: distinct, coverage: covered / n, exclusive: true,
        assign: (name) => assign(splitName(name)) || '(unlabelled)',
      });
    }
  }

  /* --- 3. rigid positional slots, for disciplined taxonomies --- */
  const maxLen = Math.max(0, ...tokenLists.map(t => t.length));
  const slots = [];
  for (let i = 0; i < maxLen; i++) {
    const vals = tokenLists.map(t => t[i]).filter(Boolean);
    if (vals.length / n < 0.7) continue;
    const uniq = [...new Set(vals.map(v => v.toLowerCase()))];
    if (uniq.length < 2 || uniq.length > 12) continue;   // constant, or free text
    if (uniq.length === vals.length) continue;           // an identifier, not a group
    if (uniq.every(u => PURE_NUM.test(u))) continue;     // a counter, not a category
    slots.push({ index: i, values: uniq.length, coverage: vals.length / n });
  }
  slots.slice(0, 3).forEach(s => {
    dimensions.push({
      id: `s:${s.index}`, kind: 'slot', label: `Name part ${s.index + 1}`,
      values: s.values, coverage: s.coverage, exclusive: true, index: s.index,
      assign: (name) => splitName(name)[s.index] || '(none)',
    });
  });

  /* --- 4. recurring tags: overlapping, not a partition --------------------
     The single most useful view on a large account, because it answers "how
     do all my video ads compare with all my static ones" without requiring
     the naming to be positional. An entity can carry several tags, so these
     groups deliberately overlap and their spend does not sum to the total. */
  const freq = new Map();
  tokenLists.forEach(tokens => {
    new Set(tokens.map(t => t.trim())).forEach(t => {
      if (!t || PURE_NUM.test(t) || t.length < 2) return;
      freq.set(t, (freq.get(t) || 0) + 1);
    });
  });
  const minHits = Math.max(3, Math.round(n * 0.03));
  const tags = [...freq.entries()]
    .filter(([, c]) => c >= minHits && c < n)      // drop tokens on every name
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([t, c]) => ({ token: t, count: c }));
  if (tags.length >= 2) {
    dimensions.push({
      id: 'tags', kind: 'tag', label: 'Recurring tags',
      values: tags.length, coverage: 1, exclusive: false, tags,
    });
  }

  return { dimensions, slots, tags, split: splitName };
};

// Merge already-aggregated entities. Needed for overlapping tag groups,
// where re-scanning every row per tag would be wasteful.
export const combineEntities = (list, label) => {
  const sums = blankSums();
  for (const e of list) {
    const s = e.sums;
    ['spend', 'impressions', 'clicks', 'linkClicks', 'purchases', 'revenue', 'results',
      'convSpend', 'conv', 'rowCount', 'reachSum', 'reachRows', 'offGoalSpend'].forEach(k => { sums[k] += s[k] || 0; });
    sums.rankQ.push(...s.rankQ); sums.rankE.push(...s.rankE); sums.rankC.push(...s.rankC);
    s.indicators.forEach(v => sums.indicators.add(v));
    s.attributions.forEach(v => sums.attributions.add(v));
    s.delivery.forEach(v => sums.delivery.add(v));
    s.statusMix.forEach(v => sums.statusMix.add(v));
    s.activeDays.forEach(v => sums.activeDays.add(v));
    if (s.reachMax > sums.reachMax) sums.reachMax = s.reachMax;
    sums.reachImps += s.reachImps || 0;
    if (s.statusAt !== null && (sums.statusAt === null || s.statusAt >= sums.statusAt)) {
      sums.statusAt = s.statusAt; sums.statusLatest = s.statusLatest;
    }
    if (s.minDate && (!sums.minDate || s.minDate < sums.minDate)) sums.minDate = s.minDate;
    if (s.maxDate && (!sums.maxDate || s.maxDate > sums.maxDate)) sums.maxDate = s.maxDate;
  }
  return { key: label, name: label, m: deriveMetrics(sums), sums, members: list.length };
};

// Build groups for any dimension returned by analyseNaming.
export const groupByDimension = (entities, dim) => {
  if (!dim) return [];
  if (dim.kind === 'tag') {
    return dim.tags.map(t => {
      const lower = t.token.toLowerCase();
      const members = entities.filter(e => splitName(e.name).some(x => x.toLowerCase() === lower));
      return members.length ? combineEntities(members, t.token) : null;
    }).filter(Boolean).sort((a, b) => b.m.spend - a.m.spend);
  }
  const buckets = new Map();
  entities.forEach(e => {
    const v = dim.assign(e.name);
    if (!buckets.has(v)) buckets.set(v, []);
    buckets.get(v).push(e);
  });
  return [...buckets.entries()].map(([v, members]) => combineEntities(members, v))
    .sort((a, b) => b.m.spend - a.m.spend);
};

/* ======================== PERIOD COMPARISON ======================== */

// Split a day-level dataset at a date and diff every entity across the
// two halves. Answers "who improved and who decayed" without a second file.
export const comparePeriods = (ds, level, splitDate, filters = {}) => {
  const a = aggregate(ds, { level, filters: { ...filters, dateTo: prevDay(splitDate) } });
  const b = aggregate(ds, { level, filters: { ...filters, dateFrom: splitDate } });
  const mapA = new Map(a.map(e => [e.key, e]));
  const mapB = new Map(b.map(e => [e.key, e]));
  const keys = [...new Set([...mapA.keys(), ...mapB.keys()])];
  return keys.map(k => {
    const ea = mapA.get(k), eb = mapB.get(k);
    const delta = (f) => {
      const va = ea ? f(ea.m) : null, vb = eb ? f(eb.m) : null;
      if (va === null || vb === null || !(va > 0)) return null;
      return vb / va - 1;
    };
    return {
      key: k,
      name: (eb || ea).name,
      before: ea ? ea.m : null,
      after: eb ? eb.m : null,
      status: !ea ? 'new' : !eb ? 'stopped' : 'both',
      dSpend: delta(m => m.spend),
      dCpa: delta(m => m.cpa),
      dCtr: delta(m => m.ctr),
      dCvr: delta(m => m.cvr),
      dCpm: delta(m => m.cpm),
      dConv: delta(m => m.conv),
    };
  }).sort((x, y) => ((y.after?.spend || 0) - (x.after?.spend || 0)));
};

const prevDay = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/* ========================= BUDGET SIMULATION ========================= */

// Reallocation with an explicit efficiency-decay assumption: CPA rises by
// `decayPerDouble` for every doubling of spend. Naive linear projection
// is the single most common way media plans lie.
export const simulateReallocation = (scored, changes, opts = {}) => {
  const decay = opts.decayPerDouble ?? 0.15;
  let curSpend = 0, curConv = 0, newSpend = 0, newConv = 0;
  const lines = scored.map(e => {
    const spend0 = e.m.cpaSpend || e.m.spend;
    const cpa0 = e.m.cpa;
    const mult = changes[e.key] ?? 1;
    const spend1 = spend0 * mult;
    let cpa1 = cpa0;
    if (cpa0 !== null && mult > 1) {
      const doublings = Math.log2(mult);
      cpa1 = cpa0 * (1 + decay * doublings);
    }
    const conv0 = e.m.conv;
    const conv1 = cpa1 && cpa1 > 0 ? spend1 / cpa1 : 0;
    curSpend += spend0; curConv += conv0;
    newSpend += spend1; newConv += conv1;
    return { key: e.key, name: e.name, mult, spend0, spend1, cpa0, cpa1, conv0, conv1 };
  });
  return {
    lines: lines.filter(l => l.mult !== 1).sort((a, b) => Math.abs(b.spend1 - b.spend0) - Math.abs(a.spend1 - a.spend0)),
    curSpend, curConv, newSpend, newConv,
    curCpa: curConv > 0 ? curSpend / curConv : null,
    newCpa: newConv > 0 ? newSpend / newConv : null,
    decay,
  };
};

/* ============================ TIME SERIES ============================ */

export const timeSeries = (ds, { grain = 'day', filters = {}, seriesBy = null } = {}) => {
  if (ds.timeGrain === 'lifetime') return { points: [], series: [] };
  const map = new Map();
  const seriesKeys = new Set();
  for (const r of ds.rows) {
    if (!r.date) continue;
    if (filters.dateFrom && r.date < filters.dateFrom) continue;
    if (filters.dateTo && r.date > filters.dateTo) continue;
    if (filters.indicator && r.indicator !== filters.indicator) continue;
    if (filters.keys && !filters.keys.includes(seriesBy ? seriesBy(r) : '_all')) continue;
    const bucket = bucketDate(r.date, grain);
    const sk = seriesBy ? seriesBy(r) : '_all';
    seriesKeys.add(sk);
    if (!map.has(bucket)) map.set(bucket, { date: bucket, per: new Map() });
    const slot = map.get(bucket);
    if (!slot.per.has(sk)) slot.per.set(sk, blankSums());
    addRow(slot.per.get(sk), r, ds);
  }
  const points = [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).map(p => {
    const out = { date: p.date };
    let all = blankSums();
    p.per.forEach((sums, sk) => {
      const m = deriveMetrics(sums);
      out[`${sk}|spend`] = m.spend;
      out[`${sk}|conv`] = m.conv;
      out[`${sk}|cpa`] = m.cpa;
      out[`${sk}|ctr`] = m.ctr;
      out[`${sk}|cvr`] = m.cvr;
      out[`${sk}|cpm`] = m.cpm;
      out[`${sk}|clicks`] = m.clicks;
      out[`${sk}|impressions`] = m.impressions;
      ['spend', 'impressions', 'clicks', 'linkClicks', 'purchases', 'revenue', 'results', 'conv', 'convSpend'].forEach(k => { all[k] += sums[k]; });
      all.rowCount += sums.rowCount;
    });
    const am = deriveMetrics(all);
    out.spend = am.spend; out.conv = am.conv; out.cpa = am.cpa;
    out.ctr = am.ctr; out.cvr = am.cvr; out.cpm = am.cpm;
    out.impressions = am.impressions; out.clicks = am.clicks;
    return out;
  });
  return { points, series: [...seriesKeys] };
};

/* ============================== EXPORT ============================== */

export const toCSV = (rows, headers) => {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(h => esc(h.label)).join(','),
    ...rows.map(r => headers.map(h => esc(h.get(r))).join(','))].join('\n');
};

/* ========================= PER-ENTITY SERIES ========================= */

// Daily series keyed by the same entity key aggregate() produces, so the
// table and its sparklines can never disagree about what a row is.
export const entitySeries = (ds, level, filters = {}) => {
  const out = new Map();
  if (ds.timeGrain === 'lifetime') return out;
  for (const r of ds.rows) {
    if (!r.date) continue;
    if (filters.dateFrom && r.date < filters.dateFrom) continue;
    if (filters.dateTo && r.date > filters.dateTo) continue;
    if (filters.indicator && r.indicator !== filters.indicator) continue;
    const k = entityKey(r, level);
    if (!out.has(k)) out.set(k, new Map());
    const byDate = out.get(k);
    if (!byDate.has(r.date)) byDate.set(r.date, blankSums());
    addRow(byDate.get(r.date), r, ds);
  }
  const final = new Map();
  out.forEach((byDate, k) => {
    const dates = [...byDate.keys()].sort();
    final.set(k, dates.map(d => ({ date: d, ...deriveMetrics(byDate.get(d)) })));
  });
  return final;
};
