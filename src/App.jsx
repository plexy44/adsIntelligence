import React, { useState, useEffect, useMemo, useRef, createContext, useContext, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ResponsiveContainer, ComposedChart, LineChart, BarChart, ScatterChart,
  Line, Area, Bar, Scatter, Cell, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip as RTooltip, ReferenceLine, ReferenceArea, Legend,
} from 'recharts';
import {
  Upload, Database, LayoutDashboard, Table2, Crosshair, GitCompare, Boxes,
  History, Wallet, Sun, Moon, AlertTriangle, CheckCircle2, Info, X, Trash2,
  Pencil, Download, Copy, ChevronRight, ChevronDown, ChevronUp, Search,
  Target, Scissors, TrendingUp, TrendingDown, Flame, ShieldAlert, Lightbulb,
  Gauge, Sparkles, ArrowRight, RefreshCw, SlidersHorizontal, FileWarning,
} from 'lucide-react';

import {
  parseMetaCSV, aggregate, buildBenchmarks, scoreEntities, generateFindings,
  analyseNaming, comparePeriods, timeSeries, simulateReallocation, entitySeries,
  entityKey, compareRates, median, VERDICTS, DEFAULTS, toCSV, groupByDimension,
} from './engine.js';

/* ===================================================================== */
/* Theme + primitives                                                     */
/* ===================================================================== */

const ThemeCtx = createContext('dark');
const useTheme = () => useContext(ThemeCtx);

const CSSVAR = (name, fallback = '#888') => {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v ? v.trim() : fallback;
};

// Portal tooltip: an explanation must never be clipped by a card, and it
// must never be the only place a number's meaning lives.
const Tip = ({ tip, children, className, as: As = 'span' }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  if (!tip) return children;
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 150;
    setPos({
      x: Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170),
      y: below ? r.bottom : r.top, below,
    });
  };
  return (
    <As ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)}
      onClick={() => setPos(null)} className={className || 'inline-flex'}>
      {children}
      {pos && createPortal(
        <div className={`tip ${pos.below ? 'below' : ''}`} style={{ left: pos.x, top: pos.y }}>{tip}</div>,
        document.body)}
    </As>
  );
};

const Card = ({ children, title, icon: Icon, right, className = '', pad = true, quiet }) => (
  <section className={`card ${quiet ? 'card-quiet' : ''} ${className}`}>
    {(title || right) && (
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon size={15} style={{ color: 'var(--accent)' }} className="shrink-0" />}
          <span className="eyebrow truncate">{title}</span>
        </div>
        {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
      </header>
    )}
    <div className={pad ? 'px-5 pb-5' : ''}>{children}</div>
  </section>
);

const Stat = ({ label, value, sub, tone, tip, delta }) => (
  <Tip tip={tip} className="block h-full">
    <div className="card h-full px-5 py-4 flex flex-col justify-between" style={{ cursor: tip ? 'help' : 'default' }}>
      <div className="flex items-start justify-between gap-2">
        <span className="eyebrow leading-relaxed">{label}</span>
        {delta !== undefined && delta !== null && isFinite(delta) && (
          <span className={`chip ${delta > 0 ? 't-good' : delta < 0 ? 't-bad' : 't-muted'}`}>
            {delta > 0 ? <TrendingUp size={10} /> : delta < 0 ? <TrendingDown size={10} /> : null}
            {Math.abs(delta * 100).toFixed(0)}%
          </span>
        )}
      </div>
      <div className="mt-3">
        <div className="num text-[26px] leading-none font-bold" style={{ color: tone || 'var(--ink)' }}>{value}</div>
        {sub && <div className="text-[11px] mt-1.5" style={{ color: 'var(--ink-4)' }}>{sub}</div>}
      </div>
    </div>
  </Tip>
);

const Badge = ({ verdict }) => {
  const v = VERDICTS[verdict] || VERDICTS.thin;
  const cls = { good: 't-good', warn: 't-warn', bad: 't-bad', neutral: 't-neutral', muted: 't-muted' }[v.tone];
  const Icon = { scale: TrendingUp, keep: CheckCircle2, watch: Info, fix: SlidersHorizontal, cut: Scissors, starve: Sparkles, thin: FileWarning }[verdict] || Info;
  return <span className={`chip ${cls}`}><Icon size={10} />{v.label}</span>;
};

// Hand-drawn sparkline: dozens of Recharts instances in a table is slow,
// and this needs no axes.
const Spark = ({ values, width = 68, height = 20, color }) => {
  const vals = (values || []).filter(v => typeof v === 'number' && isFinite(v));
  if (vals.length < 2) return <span style={{ color: 'var(--ink-4)' }}>-</span>;
  const max = Math.max(...vals), min = Math.min(...vals);
  const range = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * width},${height - ((v - min) / range) * (height - 2) - 1}`).join(' ');
  return (
    <svg width={width} height={height} className="inline-block align-middle" aria-hidden>
      <polyline points={pts} fill="none" stroke={color || 'var(--accent)'} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
};

/* ===================================================================== */
/* Formatting                                                             */
/* ===================================================================== */

const nf = (v, dp = 0) => v === null || v === undefined || !isFinite(v)
  ? '-' : v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });

const makeFmt = (ds) => {
  const sym = ds?.currencySymbol ?? '£';
  return {
    sym,
    money: (v, dp = 2) => v === null || v === undefined || !isFinite(v) ? '-' : sym + nf(v, dp),
    money0: (v) => v === null || v === undefined || !isFinite(v) ? '-' : sym + nf(v, 0),
    compact: (v) => {
      if (v === null || v === undefined || !isFinite(v)) return '-';
      if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M';
      if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1) + 'k';
      return nf(v, 0);
    },
    moneyCompact: (v) => {
      if (v === null || v === undefined || !isFinite(v)) return '-';
      if (Math.abs(v) >= 1e6) return sym + (v / 1e6).toFixed(2) + 'M';
      if (Math.abs(v) >= 1e4) return sym + (v / 1e3).toFixed(1) + 'k';
      return sym + nf(v, 0);
    },
    int: (v) => v === null || v === undefined || !isFinite(v) ? '-' : nf(v, 0),
    pct: (v, dp = 2) => v === null || v === undefined || !isFinite(v) ? '-' : nf(v, dp) + '%',
    ratio: (v) => v === null || v === undefined || !isFinite(v) ? '-' : nf(v, 2) + '×',
    dec: (v, dp = 2) => v === null || v === undefined || !isFinite(v) ? '-' : nf(v, dp),
  };
};

const shortDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]}`;
};
const longDate = (iso) => iso ? `${shortDate(iso)} ${iso.slice(0, 4)}` : '';

// "Worse than benchmark" arrow. Direction of "good" differs per metric.
const VsBench = ({ value, bench, higherIsBetter = true, fmt }) => {
  if (value === null || bench === null || !(bench > 0) || !isFinite(value)) return null;
  const rel = value / bench - 1;
  if (Math.abs(rel) < 0.05) return <span className="text-[10px] num" style={{ color: 'var(--ink-4)' }}>≈ avg</span>;
  const good = higherIsBetter ? rel > 0 : rel < 0;
  return (
    <span className="text-[10px] num" style={{ color: good ? 'var(--good)' : 'var(--bad)' }}>
      {rel > 0 ? '+' : ''}{(rel * 100).toFixed(0)}%
    </span>
  );
};

const SortHead = ({ label, k, sort, setSort, tip, align = 'right' }) => (
  <th className="sortable" onClick={() => setSort(s => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))}
    style={{ textAlign: align }}>
    <Tip tip={tip}>
      <span className={`inline-flex items-center gap-1 ${align === 'left' ? '' : 'flex-row-reverse'}`}>
        <span className={tip ? 'help' : ''}>{label}</span>
        <span className="flex flex-col" style={{ color: 'var(--ink-4)' }}>
          <ChevronUp size={9} style={{ color: sort.key === k && sort.dir === 'asc' ? 'var(--accent)' : undefined }} />
          <ChevronDown size={9} className="-mt-[3px]" style={{ color: sort.key === k && sort.dir === 'desc' ? 'var(--accent)' : undefined }} />
        </span>
      </span>
    </Tip>
  </th>
);

const useSort = (rows, initial, getters) => {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    const g = getters[sort.key] || (() => 0);
    return [...rows].sort((a, b) => {
      const va = g(a), vb = g(b);
      if (typeof va === 'string' || typeof vb === 'string') {
        return sort.dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      }
      const na = va === null || va === undefined || !isFinite(va) ? -Infinity : va;
      const nb = vb === null || vb === undefined || !isFinite(vb) ? -Infinity : vb;
      return sort.dir === 'asc' ? na - nb : nb - na;
    });
  }, [rows, sort, getters]);
  return { sorted, sort, setSort };
};

/* ===================================================================== */
/* Persistence. Exports are megabytes, so IndexedDB rather than localStorage */
/* ===================================================================== */

const store = {
  open: () => new Promise((res, rej) => {
    try {
      const r = indexedDB.open('metavision_db', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  }),
  all: () => store.open().then(db => new Promise((res, rej) => {
    const q = db.transaction('files').objectStore('files').getAll();
    q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error);
  })),
  put: (o) => store.open().then(db => new Promise((res) => {
    const q = db.transaction('files', 'readwrite').objectStore('files').put(o);
    q.onsuccess = () => res(); q.onerror = () => res();
  })).catch(() => {}),
  del: (id) => store.open().then(db => new Promise((res) => {
    const q = db.transaction('files', 'readwrite').objectStore('files').delete(id);
    q.onsuccess = () => res(); q.onerror = () => res();
  })).catch(() => {}),
};

const useStored = (key, fallback) => {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
  });
  const save = useCallback((next) => {
    setV(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
  }, [key]);
  return [v, save];
};

/* ===================================================================== */
/* Chart tooltip                                                          */
/* ===================================================================== */

const ChartTip = ({ active, payload, label, fmt, unitFor }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2.5" style={{ minWidth: 170 }}>
      <div className="eyebrow mb-2 pb-1.5" style={{ borderBottom: '1px solid var(--edge-soft)' }}>{label}</div>
      <div className="flex flex-col gap-1.5">
        {payload.filter(p => p.value !== null && p.value !== undefined).map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="num font-semibold">{(unitFor?.(p) || ((v) => nf(v, 2)))(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ===================================================================== */
/* INGESTION                                                              */
/* ===================================================================== */

const RECIPE = [
  ['Level', 'Export from the Ads tab rather than Campaigns. Ad-level data rolls up to ad set and campaign, but never the other way round.'],
  ['Breakdown', 'By Time → Day. This is what unlocks trends, fatigue detection and period comparison.'],
  ['Columns', 'Performance plus Amount spent, Impressions, Reach, Frequency, Link clicks, CTR, CPM, and your conversion column.'],
  ['Attribution', 'Pick ONE window for the whole export. Mixing 7-day and 1-day makes ads incomparable.'],
  ['Rankings', 'Add Quality, Engagement rate and Conversion rate ranking. They are Meta\u2019s own competitive read, and cost nothing to include.'],
];

const ParseReport = ({ ds, fmt }) => {
  const [open, setOpen] = useState(false);
  const d = ds.detected;
  const Row = ({ k, v }) => v ? (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>{k}</span>
      <span className="text-[11px] num text-right" style={{ color: 'var(--ink-2)' }}>{v}</span>
    </div>
  ) : null;
  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--edge-soft)' }}>
      <button className="btn px-2.5 py-1 text-[11px] font-semibold inline-flex items-center gap-1.5" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} What the parser found
      </button>
      {open && (
        <div className="mt-3 grid md:grid-cols-2 gap-x-8">
          <div>
            <div className="eyebrow mb-1.5">Structure</div>
            <Row k="Levels" v={ds.levelsPresent.map(l => d.entity[l]).join(' → ')} />
            <Row k="Time" v={ds.timeGrain === 'lifetime'
              ? (ds.periodDays > 1
                ? `One ${ds.periodDays}-day window, no day breakdown`
                : 'Single period, no day breakdown')
              : `${d.date} · ${ds.timeGrain}`} />
            <Row k="Window" v={ds.reportingRange?.start ? `${ds.reportingRange.start} → ${ds.reportingRange.end}` : null} />
            <Row k="Date order" v={ds.dateOrder === 'mdy' ? 'Month-first (US)' : 'Day-first (UK/EU)'} />
            <Row k="Numbers" v={ds.numberLocale === 'eu' ? 'Decimal comma (EU)' : 'Decimal point'} />
            <Row k="Currency" v={ds.currency} />
            <Row k="Breakdowns" v={ds.breakdowns.join(', ') || 'none'} />
            <Row k="Rows kept" v={`${nf(ds.rowCount)} (${ds.skipped.blank + ds.skipped.total} skipped)`} />
            <Row k="Goals" v={ds.indicators.join(', ') || 'not stated'} />
            <Row k="Attribution" v={ds.attributions.join(' · ') || 'not stated'} />
          </div>
          <div>
            <div className="eyebrow mb-1.5">Columns mapped</div>
            {Object.entries(d.roles).map(([role, header]) => <Row key={role} k={role} v={header} />)}
            {Object.entries(d.ranks).map(([role, header]) => <Row key={role} k={role} v={header} />)}
            {!!d.ignored.length && (
              <div className="mt-2 text-[10px]" style={{ color: 'var(--ink-4)' }}>
                Not used: {d.ignored.slice(0, 12).join(', ')}{d.ignored.length > 12 ? ` +${d.ignored.length - 12}` : ''}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const IngestionView = ({ files, activeId, onAdd, onRemove, onRename, onSelect }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const handleFiles = async (list) => {
    setBusy(true); setError(null);
    const errs = [];
    for (const file of Array.from(list)) {
      try {
        const text = await file.text();
        const ds = parseMetaCSV(text, file.name.replace(/\.csv$/i, ''));
        onAdd(ds, text);
      } catch (e) { errs.push(`${file.name}: ${e.message}`); }
    }
    if (errs.length) setError(errs.join(' | '));
    setBusy(false);
  };

  return (
    <div className="anim-in space-y-6 max-w-4xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-light">Load <span className="font-bold">Ads Manager exports</span></h2>
        <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
          Drop in as many CSVs as you like. Columns are matched by meaning rather than position, so campaign, ad set and
          ad exports, any locale, any breakdown, all read correctly. Everything stays in this browser and is still here next visit.
        </p>
      </div>

      <div className="dropzone p-9 text-center"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
        <label className="cursor-pointer flex flex-col items-center gap-4">
          <span className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
            {busy ? <RefreshCw size={26} className="animate-spin" /> : <Upload size={26} />}
          </span>
          <span>
            <span className="block font-bold">{files.length ? 'Add another export' : 'Choose or drop CSV files'}</span>
            <span className="text-[12px]" style={{ color: 'var(--ink-4)' }}>Campaign, ad set or ad level · multiple files supported</span>
          </span>
          <input ref={inputRef} type="file" accept=".csv,text/csv" multiple className="hidden"
            onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
        </label>
      </div>

      {error && (
        <div className="card px-4 py-3 flex items-start gap-2.5 text-[13px]" style={{ color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 35%, transparent)' }}>
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {files.map(f => {
        const ds = f.ds;
        const fmt = makeFmt(ds);
        const isActive = f.id === activeId;
        return (
          <div key={f.id} className={`card px-5 py-4 ${isActive ? '' : 'card-quiet'}`}
            style={isActive ? { borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)' } : undefined}>
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: 'color-mix(in srgb, var(--good) 14%, transparent)', color: 'var(--good)' }}>
                <CheckCircle2 size={16} />
              </span>
              <div className="flex-1 min-w-0">
                {editing === f.id ? (
                  <input autoFocus className="field w-full font-bold" value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { onRename(f.id, draft.trim() || f.name); setEditing(null); } if (e.key === 'Escape') setEditing(null); }}
                    onBlur={() => { onRename(f.id, draft.trim() || f.name); setEditing(null); }} />
                ) : (
                  <button className="font-bold text-left truncate block max-w-full" onClick={() => onSelect(f.id)}>{f.name}</button>
                )}
                <div className="text-[11px] num mt-1" style={{ color: 'var(--ink-4)' }}>
                  {ds.levelsPresent.join(' / ')} · {nf(ds.rowCount)} rows · {ds.currency}
                  {(ds.timeGrain === 'lifetime' ? ds.reportingRange : ds.dateRange)?.start
                    ? ` · ${longDate((ds.timeGrain === 'lifetime' ? ds.reportingRange : ds.dateRange).start)} → ${longDate((ds.timeGrain === 'lifetime' ? ds.reportingRange : ds.dateRange).end)}`
                    : ' · lifetime'}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {isActive && <span className="chip t-info">Active</span>}
                  {ds.timeGrain === 'lifetime' && (
                    <Tip tip="Without a Day breakdown there is no time axis, so trend charts, click-through decay and period comparison are unavailable for this file.">
                      <span className="chip t-warn help">No time data</span>
                    </Tip>
                  )}
                  {ds.indicators.length > 1 && (
                    <Tip tip={`Mixed optimisation goals: ${ds.indicators.join(', ')}. Cost per result is only comparable within a single goal, so use the goal filter in the control bar.`}>
                      <span className="chip t-warn help">{ds.indicators.length} goals</span>
                    </Tip>
                  )}
                  {ds.attributions.length > 1 && (
                    <Tip tip={`Rows use different attribution windows (${ds.attributions.join(' · ')}). A 7-day-click ad will always outperform the same ad on 1-day.`}>
                      <span className="chip t-bad help">Mixed attribution</span>
                    </Tip>
                  )}
                  {!!ds.breakdowns.length && <span className="chip t-muted">{ds.breakdowns.join(' × ')}</span>}
                  {ds.hasRanks && (
                    <Tip tip="This export includes Meta's own Quality, Engagement and Conversion rate rankings, which are used in the diagnosis.">
                      <span className="chip t-good help">Rankings</span>
                    </Tip>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Tip tip="Rename this file, which helps when tagging periods such as “June, ad level” or “Previous period”.">
                  <button className="btn p-1.5" onClick={() => { setEditing(f.id); setDraft(f.name); }} aria-label="Rename"><Pencil size={13} /></button>
                </Tip>
                <Tip tip="Remove this file from the browser.">
                  <button className="btn p-1.5" onClick={() => onRemove(f.id)} aria-label="Remove"><Trash2 size={13} /></button>
                </Tip>
              </div>
            </div>

            {(!!ds.warnings.length || !!ds.notes.length) && (
              <div className="mt-3 space-y-1.5">
                {ds.warnings.map((w, i) => (
                  <div key={`w${i}`} className="flex items-start gap-2 text-[11.5px]" style={{ color: 'var(--warn)' }}>
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" /><span>{w}</span>
                  </div>
                ))}
                {ds.notes.map((n, i) => (
                  <div key={`n${i}`} className="flex items-start gap-2 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                    <Info size={13} className="shrink-0 mt-0.5" /><span>{n}</span>
                  </div>
                ))}
              </div>
            )}
            <ParseReport ds={ds} fmt={fmt} />
          </div>
        );
      })}

      <Card title="How to export so nothing is lost" icon={Lightbulb} quiet>
        <div className="space-y-2">
          {RECIPE.map(([k, v]) => (
            <div key={k} className="flex gap-3 text-[12px]">
              <span className="font-bold shrink-0 w-[86px]" style={{ color: 'var(--accent)' }}>{k}</span>
              <span style={{ color: 'var(--ink-3)' }}>{v}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

/* ===================================================================== */
/* OVERVIEW                                                               */
/* ===================================================================== */

const FINDING_STYLE = {
  cut: { icon: Scissors, tone: 't-bad' },
  reallocate: { icon: ArrowRight, tone: 't-good' },
  scale: { icon: TrendingUp, tone: 't-good' },
  risk: { icon: ShieldAlert, tone: 't-warn' },
  creative: { icon: Flame, tone: 't-warn' },
  landing: { icon: Crosshair, tone: 't-warn' },
  auction: { icon: Gauge, tone: 't-info' },
  fatigue: { icon: Flame, tone: 't-warn' },
  patience: { icon: FileWarning, tone: 't-muted' },
  measurement: { icon: Info, tone: 't-muted' },
};

const OverviewView = ({ ds, entities, scored, bench, findings, ctrl, fmt, onFocus, series }) => {
  const [metric, setMetric] = useState('cpa');
  const [smooth, setSmooth] = useState(true);
  const ts = useMemo(() => timeSeries(ds, {
    grain: ctrl.grain, filters: { dateFrom: ctrl.dateFrom, dateTo: ctrl.dateTo, indicator: ctrl.indicator },
  }), [ds, ctrl.grain, ctrl.dateFrom, ctrl.dateTo, ctrl.indicator]);

  // 216 raw daily points on a 7-month export is unreadable noise; a trailing
  // average shows the trend without hiding the spikes entirely.
  const plot = useMemo(() => {
    if (!smooth || ts.points.length < 14) return ts.points;
    const w = 7;
    return ts.points.map((p, i) => {
      const win = ts.points.slice(Math.max(0, i - w + 1), i + 1);
      const avg = (k) => {
        const v = win.map(x => x[k]).filter(x => typeof x === 'number' && isFinite(x));
        return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
      };
      return { ...p, spend: avg('spend'), cpa: avg('cpa'), ctr: avg('ctr'), cvr: avg('cvr'), cpm: avg('cpm'), conv: avg('conv') };
    });
  }, [ts.points, smooth]);

  const verdictMix = useMemo(() => {
    const m = {};
    scored.forEach(e => { m[e.verdict] = m[e.verdict] || { n: 0, spend: 0 }; m[e.verdict].n++; m[e.verdict].spend += e.m.spend; });
    return m;
  }, [scored]);

  const wasted = scored.reduce((s, e) => s + e.waste, 0);
  const recoverable = scored.reduce((s, e) => s + (e.recoverable ?? e.waste), 0);
  const hasStatus = scored.some(e => e.status && e.status !== 'unknown');
  const producers = scored.filter(e => e.m.conv > 0).length;
  const levelWord = ctrl.level === 'ad' ? 'ads' : ctrl.level === 'adset' ? 'ad sets' : 'campaigns';

  const METRICS = {
    cpa: { label: `Cost per ${ds.convLabel.toLowerCase().replace(/s$/, '')}`, fmt: v => fmt.money(v), color: 'var(--teal)' },
    spend: { label: 'Spend', fmt: v => fmt.money(v), color: 'var(--accent-2)' },
    conv: { label: ds.convLabel, fmt: v => fmt.int(v), color: 'var(--good)' },
    ctr: { label: 'Click-through rate', fmt: v => fmt.pct(v), color: 'var(--teal)' },
    cvr: { label: 'Conversion rate', fmt: v => fmt.pct(v), color: 'var(--info)' },
    cpm: { label: 'Cost per 1,000 impressions', fmt: v => fmt.money(v), color: 'var(--warn)' },
  };

  return (
    <div className="anim-in space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Spend" value={fmt.moneyCompact(bench.totals.spend)}
          sub={`${nf(entities.length)} ${levelWord}`}
          tip="Total spend across everything matching the current filters. This is the only figure that is always exactly as Meta reports it. Everything else is derived." />
        <Stat label={ds.convLabel} value={fmt.int(bench.totals.conv)}
          sub={`${producers} of ${entities.length} ${levelWord} converting`}
          tip={`Conversions counted only from rows optimising for ${ds.primaryIndicator || ds.convLabel.toLowerCase()}. Rows chasing a different goal are excluded so this number means one thing.`} />
        <Stat label={`Blended cost per ${ds.convLabel.toLowerCase().replace(/s$/, '')}`}
          value={fmt.money(bench.cpa)}
          tone={bench.cpa === null ? undefined : bench.cpa <= ctrl.targetCpa ? 'var(--good)' : 'var(--bad)'}
          sub={`Target ${fmt.money0(ctrl.targetCpa)}${bench.cpa ? ` · ${bench.cpa <= ctrl.targetCpa ? 'inside' : ((bench.cpa / ctrl.targetCpa - 1) * 100).toFixed(0) + '% over'}` : ''}`}
          tip="On-goal spend divided by conversions, computed from totals rather than by averaging each entity's rate, so a £5 ad with one lucky conversion cannot drag the account figure around." />
        <Stat label={hasStatus ? 'Above target, still running' : 'Above-target spend'}
          value={fmt.moneyCompact(hasStatus ? recoverable : wasted)}
          tone={(hasStatus ? recoverable : wasted) > 0 ? 'var(--warn)' : 'var(--good)'}
          sub={hasStatus
            ? (wasted > recoverable ? `${fmt.moneyCompact(wasted - recoverable)} more is on ${levelWord} already switched off` : 'Nothing clearly overspending')
            : (wasted > 0 ? 'Above what target efficiency would have cost' : 'Nothing clearly overspending')}
          tip={`How much more you paid than target efficiency would have cost: spend minus (conversions multiplied by ${fmt.money0(ctrl.targetCpa)}), summed over everything above target. Entities with zero conversions contribute their whole spend.${hasStatus ? ' Only entities still delivering are counted here, because money already spent on stopped ads cannot be recovered.' : ''}`} />
      </div>

      {!!findings.length && (
        <Card title={`What to do · ${findings.length} findings, most consequential first`} icon={Lightbulb} pad={false}>
          <div className="px-5 pb-5 grid gap-3 lg:grid-cols-2">
            {findings.map((f, i) => {
              const st = FINDING_STYLE[f.kind] || FINDING_STYLE.measurement;
              const Icon = st.icon;
              return (
                <div key={i} className="card card-quiet px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <span className={`chip ${st.tone} shrink-0`} style={{ padding: 5 }}><Icon size={12} /></span>
                    <div className="min-w-0">
                      <div className="font-semibold text-[13px] leading-snug">{f.title}</div>
                      <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: 'var(--ink-3)' }}>{f.body}</p>
                      {!!f.entities.length && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {f.entities.slice(0, 5).map(k => (
                            <button key={k} className="btn px-2 py-0.5 text-[10px] num truncate max-w-[190px]"
                              onClick={() => onFocus(k)} title={`Show ${k} in the table`}>{k}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {ds.timeGrain !== 'lifetime' ? (
        <Card title="Over time" icon={LayoutDashboard}
          right={<div className="flex items-center gap-2">
            {ts.points.length >= 14 && (
              <Tip tip="A trailing seven-day average. Daily figures on a long export swing wildly because a single conversion moves the cost sharply; the average shows the direction of travel. Switch it off to see the raw days.">
                <div className="seg"><button aria-pressed={smooth} onClick={() => setSmooth(true)}>7-day avg</button>
                  <button aria-pressed={!smooth} onClick={() => setSmooth(false)}>Daily</button></div>
              </Tip>
            )}
            <select className="field text-[11px] py-1" value={metric} onChange={e => setMetric(e.target.value)}>
              {Object.entries(METRICS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>}>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={plot} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="gSpend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-2)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--accent-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} stroke="var(--axis)" tickLine={false} minTickGap={22} />
                <YAxis yAxisId="l" stroke="var(--axis)" tickLine={false} axisLine={false}
                  tickFormatter={v => fmt.moneyCompact(v)} />
                <YAxis yAxisId="r" orientation="right" stroke="var(--axis)" tickLine={false} axisLine={false}
                  tickFormatter={v => metric === 'ctr' || metric === 'cvr' ? nf(v, 1) + '%' : metric === 'conv' ? nf(v, 0) : fmt.moneyCompact(v)} />
                <RTooltip content={<ChartTip fmt={fmt} unitFor={p => p.dataKey === 'spend' ? (v => fmt.money(v)) : METRICS[metric].fmt} />}
                  labelFormatter={longDate} />
                <Area yAxisId="l" type="monotone" dataKey="spend" name="Spend" stroke="var(--accent-2)"
                  strokeWidth={1.6} fill="url(#gSpend)" isAnimationActive={false} dot={false} />
                <Line yAxisId="r" type="monotone" dataKey={metric} name={METRICS[metric].label}
                  stroke={METRICS[metric].color} strokeWidth={2.4} dot={false} isAnimationActive={false} connectNulls />
                {metric === 'cpa' && <ReferenceLine yAxisId="r" y={ctrl.targetCpa} stroke="var(--good)" strokeDasharray="5 4"
                  label={{ value: `target ${fmt.money0(ctrl.targetCpa)}`, position: 'insideTopRight', fill: 'var(--good)', fontSize: 10 }} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-2.5 text-[11px]" style={{ color: 'var(--ink-4)' }}>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0" style={{ borderTop: '7px solid color-mix(in srgb, var(--accent-2) 40%, transparent)' }} />
              Spend, left axis
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3" style={{ borderTop: `2px solid ${METRICS[metric].color}` }} />
              {METRICS[metric].label}, right axis
            </span>
            <span>Gaps mean no conversions that day, which is not the same as a zero.</span>
          </div>
        </Card>
      ) : (
        <Card title="Over time" icon={LayoutDashboard} quiet>
          <div className="flex items-start gap-3 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
            <Info size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
            <div className="space-y-2">
              {ds.reportingRange?.start && ds.reportingRange?.end && ds.periodDays > 1 ? (
                <>
                  <p>
                    There is a date <b style={{ color: 'var(--ink-2)' }}>range</b> here but no date
                    <b style={{ color: 'var(--ink-2)' }}> breakdown</b>, and a trend needs the second one. All
                    {' '}{nf(entities.length)} rows carry the same window, {longDate(ds.reportingRange.start)} to{' '}
                    {longDate(ds.reportingRange.end)}, so {ds.periodDays} days are condensed into one total per{' '}
                    {ctrl.level === 'ad' ? 'ad' : ctrl.level === 'adset' ? 'ad set' : 'campaign'}. One point per row cannot make a line.
                  </p>
                  <p>
                    Across that window spend averaged{' '}
                    <span className="num" style={{ color: 'var(--ink)' }}>{fmt.money(bench.totals.spend / ds.periodDays)}</span> a day
                    {bench.totals.conv > 0 && <> and {ds.convLabel.toLowerCase()} arrived at about{' '}
                      <span className="num" style={{ color: 'var(--ink)' }}>{nf(bench.totals.conv / ds.periodDays, 1)}</span> a day</>}
                    . Everything else in the app works normally on this file; only time-based views are unavailable.
                  </p>
                  <p>
                    To get the trend, re-export with <b style={{ color: 'var(--ink-2)' }}>Breakdown → By Time → Day</b>. That
                    repeats each row once per day, which is what your Ads-level export does.
                  </p>
                </>
              ) : (
                <p>This export has one row per entity with no time breakdown, so there is nothing to plot over time.
                  Re-export with <b style={{ color: 'var(--ink-2)' }}>Breakdown → By Time → Day</b> and this chart,
                  click-through decay detection and the Change tab all become available.</p>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card title={`Where the money sits · ${levelWord} by verdict`} icon={Target}>
        <div className="space-y-2.5">
          {Object.entries(VERDICTS).filter(([k]) => verdictMix[k]).map(([k, v]) => {
            const row = verdictMix[k];
            const share = bench.totals.spend > 0 ? row.spend / bench.totals.spend : 0;
            return (
              /* A grid, not a flex row: "Underfunded" and "Already off" are far
                 wider than "Cut", and a fixed pixel column let them spill over
                 the bar. */
              <div key={k} className="grid items-center gap-3"
                style={{ gridTemplateColumns: 'minmax(120px, max-content) 1fr minmax(110px, max-content)' }}>
                <Tip tip={v.blurb}><span style={{ cursor: 'help' }}><Badge verdict={k} /></span></Tip>
                <div className="bar min-w-0"><span style={{ width: `${Math.max(share * 100, 0.6)}%` }} /></div>
                <div className="text-right num text-[12px] whitespace-nowrap">
                  {fmt.moneyCompact(row.spend)} <span style={{ color: 'var(--ink-4)' }}>· {row.n}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

/* ===================================================================== */
/* PERFORMANCE: table + quadrant map                                      */
/* ===================================================================== */

const RankDots = ({ m }) => {
  const items = [['Quality', m.rankQuality], ['Engagement', m.rankEngagement], ['Conversion', m.rankConversion]];
  if (items.every(([, v]) => v === null)) return <span style={{ color: 'var(--ink-4)' }}>-</span>;
  const col = (v) => v === null ? 'var(--edge)' : v > 0 ? 'var(--good)' : v < 0 ? 'var(--bad)' : 'var(--ink-4)';
  const word = (v) => v === null ? 'not rated' : v > 0 ? 'above average' : v < 0 ? 'below average' : 'average';
  return (
    <Tip tip={<span>Meta&rsquo;s own ranking against ads competing for the same audience.{items.map(([n, v]) => <span key={n}><br />{n}: <b>{word(v)}</b></span>)}<br /><br />Below average on quality points at the creative; below average on conversion rate points past the click.</span>}>
      <span className="inline-flex gap-1 items-center help">
        {items.map(([n, v]) => <span key={n} className="w-2 h-2 rounded-full" style={{ background: col(v) }} />)}
      </span>
    </Tip>
  );
};

// Status has to be visible at a glance, not buried in a filter: most rows in
// a real export are ads that stopped months ago.
const StatusDot = ({ m }) => {
  const s = m.status || 'unknown';
  if (s === 'unknown') return null;
  const live = s === 'live';
  return (
    <Tip tip={live
      ? `Delivering now (${(m.deliveryStatus || 'active').replace(/_/g, ' ')}). Changes you make here affect money still being spent.`
      : `Switched off (${(m.deliveryStatus || 'inactive').replace(/_/g, ' ')}). Its spend is history, so there is nothing here to pause or save.`}>
      <span className="inline-flex shrink-0" style={{ cursor: 'help' }}>
        <span className={live ? 'live-dot' : 'off-dot'} />
      </span>
    </Tip>
  );
};

const RowDetail = ({ e, bench, ds, fmt, ctrl }) => {
  const parts = e.diagnosis.parts;
  const worstLabel = { cpm: 'the auction, which usually means a narrow audience or heavy overlap with your other ad sets', ctr: 'the creative, where the first seconds and the headline are not earning the click', cvr: 'what happens after the click, so the landing page, offer or form' };
  return (
    <tr>
      <td colSpan={99} style={{ background: 'var(--hover)' }}>
        <div className="px-2 py-4 grid lg:grid-cols-3 gap-6">
          <div>
            <div className="eyebrow mb-2">Verdict</div>
            <div className="flex items-center gap-2 mb-2"><Badge verdict={e.verdict} /></div>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>{e.reason}</p>
            {e.ci && (
              <p className="text-[11.5px] mt-2 leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                With {e.m.conv} {ds.convLabel.toLowerCase()}, the true cost is most likely between{' '}
                <span className="num">{fmt.money(e.ci.low)}</span> and <span className="num">{fmt.money(e.ci.high)}</span>.
                {e.ci.low <= ctrl.targetCpa && e.ci.high >= ctrl.targetCpa && ' That range straddles your target, so this is not yet a decision.'}
              </p>
            )}
            {e.m.offGoalSpend > 0 && (
              <p className="text-[11.5px] mt-2" style={{ color: 'var(--warn)' }}>
                {fmt.money(e.m.offGoalSpend)} of its spend chased a different goal and is excluded from the cost figure.
              </p>
            )}
          </div>

          <div>
            <div className="eyebrow mb-2">Where it wins or loses</div>
            <div className="space-y-2">
              {parts.map(p => {
                const worse = p.rel > 1;
                const pctOff = Math.abs(p.rel - 1) * 100;
                return (
                  <div key={p.stage} className="text-[11.5px]">
                    <div className="flex justify-between mb-1">
                      <span style={{ color: 'var(--ink-2)' }}>{p.label}</span>
                      <span className="num" style={{ color: worse ? 'var(--bad)' : 'var(--good)' }}>
                        {pctOff < 5 ? 'in line' : `${pctOff.toFixed(0)}% ${worse ? 'worse' : 'better'}`}
                      </span>
                    </div>
                    <div className="bar" style={{ background: 'var(--edge-soft)' }}>
                      <span style={{
                        width: `${Math.min(100, 50 * p.rel)}%`,
                        background: worse ? 'var(--bad)' : 'var(--good)',
                      }} />
                    </div>
                    <div className="num mt-1" style={{ color: 'var(--ink-4)' }}>
                      {p.stage === 'cpm' ? `${fmt.money(p.value)} vs ${fmt.money(p.bench)}` : `${fmt.pct(p.value)} vs ${fmt.pct(p.bench)}`}
                    </div>
                  </div>
                );
              })}
            </div>
            {e.diagnosis.worst && (
              <p className="text-[11.5px] mt-3 leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                The cost problem here is mostly {worstLabel[e.diagnosis.worst.stage]}.
              </p>
            )}
          </div>

          <div>
            <div className="eyebrow mb-2">Signals</div>
            {e.fatigue.length ? (
              <ul className="space-y-1.5">
                {e.fatigue.map((f, i) => (
                  <li key={i} className="flex gap-2 text-[11.5px]" style={{ color: 'var(--ink-2)' }}>
                    <Flame size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />{f.text}
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>No fatigue or ranking warnings.</p>}
            <div className="mt-3 grid grid-cols-2 gap-y-1.5 text-[11.5px]">
              {[
                ['Impressions', fmt.int(e.m.impressions)],
                ['Clicks', fmt.int(e.m.clicks)],
                e.m.reachBasis === 'daily'
                  ? ['Reach, daily average', fmt.int(e.m.reachDailyAvg),
                    <span>Deduplicated reach for the whole period cannot be recovered from daily rows: someone reached on twenty days would be counted twenty times. This is the average across the {nf(e.m.reachDays)} days it delivered, with a busiest day of <b>{fmt.int(e.m.reachPeak)}</b>. Export without a day breakdown to get true period reach.</span>]
                  : ['Reach', e.m.reach === null ? 'n/a' : fmt.int(e.m.reach)],
                e.m.reachBasis === 'daily'
                  ? ['Frequency, daily average', fmt.dec(e.m.frequencyDaily),
                    <span>Impressions per person per day, which Meta deduplicates within each day, so this figure is exact. It is a floor on frequency across the whole period, not the period figure itself, because it cannot know who saw the ad on more than one day.</span>]
                  : ['Frequency', e.m.frequency === null ? 'n/a' : fmt.dec(e.m.frequency)],
                ['Cost per click', fmt.money(e.m.cpc)],
                ['Revenue', e.m.revenue ? fmt.money0(e.m.revenue) : '-'],
                ['ROAS', e.m.roas ? fmt.ratio(e.m.roas) : '-'],
                ['Days running', e.m.activeDays
                  ? `${nf(e.m.activeDays)}${e.m.spanDays && e.m.spanDays !== e.m.activeDays ? ` of ${nf(e.m.spanDays)}` : ''}`
                  : 'n/a'],
              ].map(([k, v, tip]) => (
                <React.Fragment key={k}>
                  <span style={{ color: 'var(--ink-4)' }}>
                    {tip ? <Tip tip={tip}><span className="help">{k}</span></Tip> : k}
                  </span>
                  <span className="num text-right">{v}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
};

const QuadrantMap = ({ scored, bench, ctrl, fmt, ds, onFocus }) => {
  const plotted = scored.filter(e => e.m.cpa !== null && e.m.spend > 0);
  const noConv = scored.filter(e => e.m.cpa === null && e.m.spend > 0).sort((a, b) => b.m.spend - a.m.spend);
  const spendSplit = median(plotted.map(e => e.m.spend)) || 0;
  // One £150 outlier squashes everything else onto the floor, so the axis
  // stops at the 95th percentile and anything above is pinned to the ceiling
  // and counted underneath. The tooltip always shows the true figure.
  const sortedCpa = plotted.map(e => e.m.cpa).sort((a, b) => a - b);
  const p95 = sortedCpa.length ? sortedCpa[Math.floor((sortedCpa.length - 1) * 0.95)] : 0;
  const maxCpa = Math.max(ctrl.targetCpa * 1.8, p95);
  const above = plotted.filter(e => e.m.cpa > maxCpa);
  const tone = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', neutral: 'var(--info)', muted: 'var(--ink-4)' };

  return (
    <div className="space-y-4">
      <Card title="Efficiency map · spend against cost per result" icon={Crosshair}
        right={<Tip tip={<span>Each dot is one entity. Horizontal = how much it spends (log scale, because budgets differ by orders of magnitude). Vertical = what a result costs. Dot size = number of conversions.<br /><br />The green line is your target and the vertical line is median spend, which splits the picture into four decisions.</span>}>
          <span className="chip t-muted help"><Info size={10} />How to read</span></Tip>}>
        <div style={{ height: 380 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 16, bottom: 28, left: 4 }}>
              <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" />
              {/* quadrant washes */}
              <ReferenceArea x1={0.01} x2={spendSplit} y1={0} y2={ctrl.targetCpa} fill="var(--good)" fillOpacity={0.05} />
              <ReferenceArea x1={spendSplit} x2={Math.max(...plotted.map(e => e.m.spend)) * 1.4} y1={0} y2={ctrl.targetCpa} fill="var(--info)" fillOpacity={0.05} />
              <ReferenceArea x1={spendSplit} x2={Math.max(...plotted.map(e => e.m.spend)) * 1.4} y1={ctrl.targetCpa} y2={maxCpa * 1.1} fill="var(--bad)" fillOpacity={0.06} />
              <XAxis type="number" dataKey="x" scale="log" domain={['auto', 'auto']} allowDataOverflow
                stroke="var(--axis)" tickLine={false} tickFormatter={v => fmt.moneyCompact(v)}
                label={{ value: 'SPEND (LOG)', position: 'insideBottom', offset: -16, fill: 'var(--axis)', fontSize: 9, letterSpacing: '0.15em' }} />
              <YAxis type="number" dataKey="y" stroke="var(--axis)" tickLine={false} axisLine={false}
                tickFormatter={v => fmt.moneyCompact(v)} domain={[0, maxCpa * 1.1]} />
              <ZAxis type="number" dataKey="z" range={[40, 420]} />
              <ReferenceLine y={ctrl.targetCpa} stroke="var(--good)" strokeDasharray="5 4"
                label={{ value: `target ${fmt.money0(ctrl.targetCpa)}`, position: 'insideTopLeft', fill: 'var(--good)', fontSize: 10 }} />
              <ReferenceLine x={spendSplit} stroke="var(--axis)" strokeDasharray="2 4" />
              <RTooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="card px-3 py-2.5" style={{ maxWidth: 260 }}>
                    <div className="font-semibold text-[12px] mb-1.5 break-words">{d.name}</div>
                    <div className="flex items-center gap-2 mb-2"><Badge verdict={d.verdict} /></div>
                    <div className="text-[11.5px] num space-y-0.5" style={{ color: 'var(--ink-2)' }}>
                      <div>Spend {fmt.money(d.x)}</div>
                      <div>Cost per result {fmt.money(d.cpa)}{d.clamped ? ' (above the top of the axis)' : ''}</div>
                      <div>{d.z} {ds.convLabel.toLowerCase()}</div>
                    </div>
                  </div>
                );
              }} />
              <Scatter data={plotted.map(e => ({
                x: e.m.spend, y: Math.min(e.m.cpa, maxCpa), cpa: e.m.cpa, clamped: e.m.cpa > maxCpa,
                z: Math.max(e.m.conv, 1), name: e.name, key: e.key, verdict: e.verdict,
              }))} onClick={(p) => p?.key && onFocus(p.key)} isAnimationActive={false}>
                {plotted.map((e, i) => <Cell key={i} fill={tone[VERDICTS[e.verdict].tone]} fillOpacity={0.75}
                  stroke={tone[VERDICTS[e.verdict].tone]} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap mt-2 text-[11px]" style={{ color: 'var(--ink-4)' }}>
          <span>Each dot is coloured by its verdict and sized by conversions. Its <b style={{ color: 'var(--ink-3)' }}>position</b> is the quadrant.</span>
          {!!above.length && <span>{above.length} sit above the top of the axis, pinned to the ceiling.</span>}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-2.5 text-[11px]">
          {[[0, 1, 'Cheap and small', 'Raise budgets here first. This is the least risky growth you have.'],
            [1, 1, 'Cheap and big', 'Your engines. Protect them and do not fiddle with what is working.'],
            [0, 0, 'Expensive and small', 'Tests. Either fund them enough to get a real read or stop them.'],
            [1, 0, 'Expensive and big', 'Where the money is leaking. Fix or cut, in that order.']].map(([cx, cy, name, why]) => (
            <div key={name} className="card card-quiet px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <svg width="14" height="14" className="shrink-0" aria-hidden>
                  <rect x="0.5" y="0.5" width="13" height="13" fill="none" stroke="var(--edge)" />
                  <line x1="7" y1="0.5" x2="7" y2="13.5" stroke="var(--edge)" />
                  <line x1="0.5" y1="7" x2="13.5" y2="7" stroke="var(--edge)" />
                  <rect x={cx ? 7 : 0.5} y={cy ? 7 : 0.5} width="6.5" height="6.5" fill="var(--accent)" opacity="0.85" />
                </svg>
                <span className="font-bold text-[11px]">{name}</span>
              </div>
              <div style={{ color: 'var(--ink-4)' }}>{why}</div>
            </div>
          ))}
        </div>
      </Card>

      {!!noConv.length && (
        <Card title={`Not on the map · no ${ds.convLabel.toLowerCase()} yet`} icon={FileWarning} quiet>
          <p className="text-[12px] mb-3" style={{ color: 'var(--ink-3)' }}>
            These cannot be placed on a cost-per-result axis because they have not produced a result. That is not the same
            as being bad: the question is only whether each has had a fair chance at {fmt.money0(ctrl.targetCpa)} a result.
          </p>
          <div className="flex flex-wrap gap-2">
            {noConv.slice(0, 24).map(e => (
              <button key={e.key} onClick={() => onFocus(e.key)}
                className="btn px-2.5 py-1.5 text-[11px] flex items-center gap-2">
                <span className="num truncate max-w-[180px]">{e.name}</span>
                <span className="num" style={{ color: e.m.spend >= ctrl.targetCpa * 3 ? 'var(--bad)' : 'var(--ink-4)' }}>
                  {fmt.money0(e.m.spend)}
                </span>
              </button>
            ))}
            {noConv.length > 24 && (
              <span className="text-[11px] self-center" style={{ color: 'var(--ink-4)' }}>
                and {noConv.length - 24} more, all under {fmt.money0(noConv[24].m.spend)}
              </span>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};

const PerformanceView = ({ ds, scored, bench, ctrl, fmt, series, onFocus, onCompare }) => {
  const [view, setView] = useState('table');
  const [cols, setCols] = useState('verdict');
  const [expanded, setExpanded] = useState(null);
  const [copied, setCopied] = useState(false);

  const getters = useMemo(() => ({
    name: e => e.name, verdict: e => Object.keys(VERDICTS).indexOf(e.verdict),
    spend: e => e.m.spend, conv: e => e.m.conv, cpa: e => e.m.cpa,
    ctr: e => e.m.ctr, cvr: e => e.m.cvr, cpm: e => e.m.cpm, cpc: e => e.m.cpc,
    freq: e => e.m.frequency, waste: e => e.waste, roas: e => e.m.roas,
    impressions: e => e.m.impressions, clicks: e => e.m.clicks,
  }), []);
  const { sorted, sort, setSort } = useSort(scored, { key: 'spend', dir: 'desc' }, getters);

  const copyCSV = () => {
    const heads = [
      { label: ctrl.level, get: e => e.key }, { label: 'Verdict', get: e => VERDICTS[e.verdict].label },
      { label: 'Why', get: e => e.reason }, { label: 'Spend', get: e => e.m.spend?.toFixed(2) },
      { label: ds.convLabel, get: e => e.m.conv }, { label: 'CPA', get: e => e.m.cpa?.toFixed(2) ?? '' },
      { label: 'CTR %', get: e => e.m.ctr?.toFixed(3) ?? '' }, { label: 'CVR %', get: e => e.m.cvr?.toFixed(3) ?? '' },
      { label: 'CPM', get: e => e.m.cpm?.toFixed(2) ?? '' }, { label: 'Above-target spend', get: e => e.waste?.toFixed(2) },
    ];
    const csv = toCSV(sorted, heads);
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1600); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(csv).then(done).catch(done); else done();
  };

  if (view === 'map') {
    return (
      <div className="anim-in space-y-4">
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <div className="seg">
            <button aria-pressed={false} onClick={() => setView('table')}>Table</button>
            <button aria-pressed={true} onClick={() => setView('map')}>Map</button>
          </div>
        </div>
        <QuadrantMap scored={scored} bench={bench} ctrl={ctrl} fmt={fmt} ds={ds} onFocus={onFocus} />
      </div>
    );
  }

  return (
    <div className="anim-in space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div className="seg">
          <button aria-pressed={true} onClick={() => setView('table')}>Table</button>
          <Tip tip="Plot everything on spend against cost per result to see which quadrant each entity sits in.">
            <button aria-pressed={false} onClick={() => setView('map')}>Map</button>
          </Tip>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="seg">
            {[['verdict', 'Verdict'], ['funnel', 'Funnel'], ['full', 'Everything']].map(([k, l]) => (
              <Tip key={k} tip={k === 'verdict' ? 'Cost, volume and the call to make.'
                : k === 'funnel' ? 'The three things that decide cost: what impressions cost, whether people click, and whether clicks convert.'
                  : 'Every column, including reach, frequency, revenue and Meta\u2019s rankings.'}>
                <button aria-pressed={cols === k} onClick={() => setCols(k)}>{l}</button>
              </Tip>
            ))}
          </div>
          <Tip tip="Copy the table as CSV, including the verdict and its reasoning, for pasting into a report.">
            <button className={`btn px-2.5 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1.5 ${copied ? 'btn-on' : ''}`} onClick={copyCSV}>
              <Copy size={12} />{copied ? 'Copied' : 'Copy CSV'}
            </button>
          </Tip>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-auto scroll" style={{ maxHeight: '70vh' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th className="stick sortable" style={{ textAlign: 'left', minWidth: 240 }}
                  onClick={() => setSort(s => ({ key: 'name', dir: s.key === 'name' && s.dir === 'asc' ? 'desc' : 'asc' }))}>
                  {ctrl.level === 'ad' ? 'Ad' : ctrl.level === 'adset' ? 'Ad set' : 'Campaign'}
                </th>
                <SortHead label="Call" k="verdict" sort={sort} setSort={setSort} align="left"
                  tip="The judgement, based on your target, how much data there is, and whether a cause can be identified. Hover any badge for its rule." />
                <SortHead label="Spend" k="spend" sort={sort} setSort={setSort} tip="Total spend in the filtered period, with its share of the account." />
                <SortHead label={ds.convLabel} k="conv" sort={sort} setSort={setSort}
                  tip={`Conversions from rows optimising for ${ds.primaryIndicator || 'this goal'}. Anything below ${ctrl.minConv} is not a reliable basis for a decision.`} />
                <SortHead label="Cost / result" k="cpa" sort={sort} setSort={setSort}
                  tip={`On-goal spend ÷ conversions, coloured against your ${fmt.money0(ctrl.targetCpa)} target. The small range beneath is the uncertainty implied by the conversion count.`} />
                {cols !== 'verdict' && <>
                  <SortHead label="CPM" k="cpm" sort={sort} setSort={setSort} tip="Cost per thousand impressions, which is what the auction is charging you. A high figure means a narrow audience, overlap with your own ad sets, or restrictive placements." />
                  <SortHead label="CTR" k="ctr" sort={sort} setSort={setSort} tip="Click-through rate, which is whether the creative earns the click. This is the number the creative controls." />
                  <SortHead label="CVR" k="cvr" sort={sort} setSort={setSort} tip="Of the people who clicked, the share who converted. This is the landing page, the offer and the form, not the ad." />
                </>}
                {cols === 'full' && <>
                  <SortHead label="CPC" k="cpc" sort={sort} setSort={setSort} tip="Cost per link click." />
                  <SortHead label="Freq" k="freq" sort={sort} setSort={setSort} tip={<span>Average times each person saw the ad. Above about 2.5 in a short window, expect click-through to fall.<br /><br />Where an entity spans several days, reach cannot be added up without counting the same person once per day, so the figure shown is the average <b>within</b> a day and is marked <b>/day</b>. Around 1.1 is normal. A rising trend across the run is flagged as fatigue.</span>} />
                  {ds.hasRevenue && <SortHead label="ROAS" k="roas" sort={sort} setSort={setSort} tip="Revenue ÷ spend, where the export carries conversion value." />}
                  <th style={{ textAlign: 'center' }}><Tip tip="Meta's own Quality, Engagement and Conversion rankings against competing ads."><span className="help">Ranks</span></Tip></th>
                </>}
                <SortHead label="Over target" k="waste" sort={sort} setSort={setSort}
                  tip={`Spend beyond what target efficiency would have cost: spend − (conversions × ${fmt.money0(ctrl.targetCpa)}). For zero-conversion entities it is the whole spend.`} />
                {ds.timeGrain !== 'lifetime' && <th style={{ textAlign: 'center' }}>
                  <Tip tip="Daily spend shape over the period, which shows at a glance whether it ran continuously or in bursts."><span className="help">Daily</span></Tip></th>}
                <th className="stick-r" style={{ width: 72 }} />
              </tr>
            </thead>
            <tbody>
              {sorted.map(e => {
                const over = e.m.cpa !== null && e.m.cpa > ctrl.targetCpa;
                const sp = series?.get(e.key);
                return (
                  <React.Fragment key={e.key}>
                    <tr>
                      <td className="stick">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <StatusDot m={e.m} />
                            <span className="font-semibold truncate" title={e.name}>{e.name}</span>
                          </div>
                          <div className="text-[10px] num truncate pl-[14px]" style={{ color: 'var(--ink-4)' }}>
                            {[e.m.status === 'off' ? (e.m.deliveryStatus || 'off').replace(/_/g, ' ') : null,
                              ctrl.level === 'ad' ? e.adset : ctrl.level === 'adset' ? e.campaign : null]
                              .filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        <Tip tip={<span>{e.reason}<br /><br /><b>{VERDICTS[e.verdict].label}</b>: {VERDICTS[e.verdict].blurb}</span>}>
                          <span className="help" style={{ borderBottom: 'none' }}><Badge verdict={e.verdict} /></span>
                        </Tip>
                      </td>
                      <td>
                        <div className="num">{fmt.money0(e.m.spend)}</div>
                        <div className="bar mt-1" style={{ width: 54, marginLeft: 'auto' }}>
                          <span style={{ width: `${Math.min(100, e.spendShare * 100)}%` }} />
                        </div>
                      </td>
                      <td className="num" style={{ color: e.m.conv < ctrl.minConv ? 'var(--ink-4)' : 'var(--ink)' }}>
                        {fmt.int(e.m.conv)}
                      </td>
                      <td>
                        <div className="num font-semibold" style={{ color: e.m.cpa === null ? 'var(--ink-4)' : over ? 'var(--bad)' : 'var(--good)' }}>
                          {fmt.money(e.m.cpa)}
                        </div>
                        {e.ci && <div className="num text-[10px]" style={{ color: 'var(--ink-4)' }}>
                          {fmt.money0(e.ci.low)} to {fmt.money0(e.ci.high)}
                        </div>}
                      </td>
                      {cols !== 'verdict' && <>
                        <td><div className="num">{fmt.money(e.m.cpm)}</div><VsBench value={e.m.cpm} bench={bench.cpm} higherIsBetter={false} /></td>
                        <td><div className="num">{fmt.pct(e.m.ctr)}</div><VsBench value={e.m.ctr} bench={bench.ctr} /></td>
                        <td><div className="num">{fmt.pct(e.m.cvr)}</div><VsBench value={e.m.cvr} bench={bench.cvr} /></td>
                      </>}
                      {cols === 'full' && <>
                        <td className="num">{fmt.money(e.m.cpc)}</td>
                        <td className="num" style={{ color: e.m.frequency >= ctrl.fatigueFreq ? 'var(--warn)' : undefined }}>
                          {e.m.frequency !== null ? fmt.dec(e.m.frequency)
                            : e.m.frequencyDaily !== null ? (
                              <span>{fmt.dec(e.m.frequencyDaily)}
                                <span className="text-[9px] ml-1" style={{ color: 'var(--ink-4)' }}>/day</span>
                              </span>
                            ) : 'n/a'}
                        </td>
                        {ds.hasRevenue && <td className="num">{e.m.roas ? fmt.ratio(e.m.roas) : '-'}</td>}
                        <td style={{ textAlign: 'center' }}><RankDots m={e.m} /></td>
                      </>}
                      <td className="num" style={{ color: e.waste > 0 ? 'var(--warn)' : 'var(--ink-4)' }}>
                        {e.waste > 0 ? fmt.money0(e.waste) : '-'}
                      </td>
                      {ds.timeGrain !== 'lifetime' && (
                        <td style={{ textAlign: 'center' }}>
                          <Spark values={sp?.map(p => p.spend)} color={over ? 'var(--bad)' : 'var(--accent)'} />
                        </td>
                      )}
                      <td className="stick-r">
                        <div className="flex items-center gap-1 justify-end">
                          <Tip tip="Add to the head-to-head comparison.">
                            <button className="btn p-1" onClick={() => onCompare(e.key)} aria-label="Compare"><GitCompare size={12} /></button>
                          </Tip>
                          <button className="btn p-1" onClick={() => setExpanded(expanded === e.key ? null : e.key)}
                            aria-label="Details">
                            {expanded === e.key ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded === e.key && <RowDetail e={e} bench={bench} ds={ds} fmt={fmt} ctrl={ctrl} />}
                  </React.Fragment>
                );
              })}
              {!sorted.length && (
                <tr><td colSpan={99} className="py-10 text-center text-[13px]" style={{ color: 'var(--ink-4)' }}>
                  Nothing matches the current filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
        {sorted.length} rows. Click the arrow on any row for its full diagnosis, or the compare icon to line it up against another.
      </p>
    </div>
  );
};

/* ===================================================================== */
/* COMPARE                                                                */
/* ===================================================================== */

const CompareView = ({ ds, scored, bench, ctrl, fmt, picks, setPicks, series }) => {
  const options = scored.map(e => e.key);
  const chosen = picks.map(k => scored.find(e => e.key === k)).filter(Boolean);
  const COLORS = ['var(--accent)', 'var(--teal)', 'var(--bad)', 'var(--warn)'];

  const rows = [
    { k: 'spend', label: 'Spend', get: e => e.m.spend, fmt: v => fmt.money0(v), better: null,
      tip: 'Total spend. Not a quality signal on its own, since all it sets is how much the other numbers can be trusted.' },
    { k: 'conv', label: ds.convLabel, get: e => e.m.conv, fmt: v => fmt.int(v), better: 'high',
      tip: 'Conversions attributed to the primary goal.' },
    { k: 'cpa', label: 'Cost per result', get: e => e.m.cpa, fmt: v => fmt.money(v), better: 'low',
      tip: 'The headline efficiency number. Read it together with the confidence line below, not on its own.' },
    { k: 'cpm', label: 'CPM', get: e => e.m.cpm, fmt: v => fmt.money(v), better: 'low',
      tip: 'What the auction charges per thousand impressions. Differences here are about audience and placement, not creative.' },
    { k: 'ctr', label: 'CTR', get: e => e.m.ctr, fmt: v => fmt.pct(v), better: 'high',
      tip: 'Share of impressions that produced a click, which is the clearest read on the creative itself.' },
    { k: 'cvr', label: 'Click → result', get: e => e.m.cvr, fmt: v => fmt.pct(v), better: 'high',
      tip: 'Share of clicks that converted. Differences here point past the ad, to the page and the offer.' },
    { k: 'cpc', label: 'Cost per click', get: e => e.m.cpc, fmt: v => fmt.money(v), better: 'low', tip: 'CPM and CTR combined.' },
    { k: 'freq', label: 'Frequency', get: e => e.m.frequency ?? e.m.frequencyDaily,
      fmt: v => v === null || v === undefined ? 'n/a' : fmt.dec(v), better: 'low',
      tip: 'Times the average person saw the ad. Where the entity spans several days this is the average within a day, because reach cannot be added across days without counting the same person repeatedly.' },
  { k: 'reach', label: 'Reach', get: e => e.m.reach ?? e.m.reachDailyAvg,
      fmt: v => v === null || v === undefined ? 'n/a' : fmt.int(v), better: 'high',
      tip: 'People reached. Deduplicated across the whole period only when a single row covers the entity; otherwise this is the average day.' },
    { k: 'roas', label: 'ROAS', get: e => e.m.roas, fmt: v => v ? fmt.ratio(v) : '-', better: 'high', tip: 'Revenue ÷ spend where value is present.' },
  ].filter(r => r.k !== 'roas' || ds.hasRevenue);

  const tsData = useMemo(() => {
    if (ds.timeGrain === 'lifetime' || !chosen.length) return [];
    const maps = chosen.map(e => new Map((series.get(e.key) || []).map(p => [p.date, p])));
    const dates = [...new Set(chosen.flatMap(e => (series.get(e.key) || []).map(p => p.date)))].sort();
    return dates.map(d => {
      const o = { date: d };
      chosen.forEach((e, i) => {
        const p = maps[i].get(d);
        o[`${i}_spend`] = p?.spend ?? null;
        o[`${i}_cpa`] = p?.cpa ?? null;
        o[`${i}_ctr`] = p?.ctr ?? null;
      });
      return o;
    });
  }, [chosen, series, ds.timeGrain]);
  const [tsMetric, setTsMetric] = useState('cpa');

  return (
    <div className="anim-in space-y-4">
      <Card title="Choose up to four to line up" icon={GitCompare}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i] }} />
                <span className="eyebrow">Slot {i + 1}</span>
              </div>
              <select className="field w-full text-[12px]" value={picks[i] || ''}
                onChange={e => { const n = [...picks]; n[i] = e.target.value || undefined; setPicks(n.filter((x, ix) => x || ix < 4)); }}>
                <option value="">none</option>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>
      </Card>

      {chosen.length >= 1 && (
        <div className="card overflow-hidden">
          <div className="overflow-auto scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="stick" style={{ textAlign: 'left', minWidth: 170 }}>Measure</th>
                  {chosen.map((e, i) => (
                    <th key={e.key} style={{ textAlign: 'right', minWidth: 150 }}>
                      <div className="flex items-center gap-1.5 justify-end">
                        <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i] }} />
                        <span className="truncate max-w-[150px] normal-case tracking-normal text-[12px] font-semibold"
                          style={{ color: 'var(--ink)' }} title={e.name}>{e.name}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="stick" style={{ textAlign: 'left' }}>
                    <Tip tip="The call for each, using the same rules as the table."><span className="help">Call</span></Tip>
                  </td>
                  {chosen.map(e => <td key={e.key}><Tip tip={e.reason}><span className="help" style={{ borderBottom: 'none' }}><Badge verdict={e.verdict} /></span></Tip></td>)}
                </tr>
                {rows.map(r => {
                  const vals = chosen.map(r.get);
                  const valid = vals.filter(v => v !== null && isFinite(v));
                  const best = r.better === 'high' ? Math.max(...valid) : r.better === 'low' ? Math.min(...valid) : null;
                  return (
                    <tr key={r.k}>
                      <td className="stick" style={{ textAlign: 'left' }}>
                        <Tip tip={r.tip}><span className="help">{r.label}</span></Tip>
                      </td>
                      {chosen.map((e, i) => {
                        const v = r.get(e);
                        const isBest = best !== null && v === best && valid.length > 1;
                        return (
                          <td key={e.key} className="num" style={{
                            color: isBest ? 'var(--good)' : undefined,
                            fontWeight: isBest ? 700 : 400,
                          }}>{r.fmt(v)}</td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {chosen.length >= 2 && (
        <Card title="Is the difference real?" icon={Target}>
          <div className="space-y-3">
            {chosen.slice(1).map((e, idx) => {
              const a = chosen[0], b = e;
              const test = compareRates(a.m.conv, a.m.cpaSpend, b.m.conv, b.m.cpaSpend);
              if (!test) return (
                <p key={b.key} className="text-[12px]" style={{ color: 'var(--ink-4)' }}>
                  Not enough conversions between <b>{a.name}</b> and <b>{b.name}</b> to test anything.
                </p>
              );
              const sig = test.p < 0.05;
              const winner = test.r1 > test.r2 ? a : b;
              const loser = test.r1 > test.r2 ? b : a;
              const gap = (a.m.cpa !== null && b.m.cpa !== null) ? Math.abs(a.m.cpa - b.m.cpa) : null;
              const pct = (x) => x === null || !isFinite(x) ? '-' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
              // Round to something a person would actually say out loud.
              const roundish = (v) => v < 50 ? Math.ceil(v / 5) * 5 : Number(v.toPrecision(2));
              return (
                <div key={b.key} className="card card-quiet px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <span className={`chip ${sig ? 't-good' : 't-muted'} shrink-0`} style={{ padding: 5 }}>
                      {sig ? <CheckCircle2 size={12} /> : <Info size={12} />}
                    </span>
                    <div className="text-[12.5px] leading-relaxed">
                      {sig ? (
                        <>
                          <b>{winner.name}</b> really is producing results more cheaply than <b>{loser.name}</b>
                          {' '}({fmt.money(winner.m.cpa)} against {fmt.money(loser.m.cpa)}, a {fmt.money(gap)} gap per result).
                          At {(100 * (1 - test.p)).toFixed(1)}% confidence that is bigger than random variation, so it is
                          safe to act on.
                        </>
                      ) : test.extraIsRealistic ? (
                        <>
                          <b>{a.name}</b> ({fmt.money(a.m.cpa)}) and <b>{b.name}</b> ({fmt.money(b.m.cpa)}) differ by
                          {' '}{fmt.money(gap)} per result, about {pct(test.obsRel)}, which is
                          <b> not yet distinguishable from noise</b>. Roughly {nf(roundish(test.extraConv))} more conversions
                          between them, about {test.volumeMultiple.toFixed(1)}× the volume so far, would settle it. Killing the
                          dearer one today would be a coin toss dressed up as a decision.
                        </>
                      ) : (
                        <>
                          <b>{a.name}</b> ({fmt.money(a.m.cpa)}) and <b>{b.name}</b> ({fmt.money(b.m.cpa)}) are within
                          {' '}{fmt.money(gap)} of each other, about {pct(test.obsRel)}. At these volumes this comparison can
                          only resolve gaps of roughly <b>{pct(test.mdeRel)}</b> or more, so a difference this small is
                          invisible however much longer you run them. Read them as
                          <b> performing the same</b> and choose between them on other grounds: creative variety, audience
                          overlap, or which one is fatiguing.
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
              Conversions are treated as counts, so the uncertainty on a cost figure depends almost entirely on how many
              conversions it rests on. Four versus six conversions is not a finding; forty versus sixty is.
            </p>
          </div>
        </Card>
      )}

      {chosen.length >= 1 && ds.timeGrain !== 'lifetime' && (
        <Card title="Over time" icon={LayoutDashboard}
          right={<div className="seg">
            {[['cpa', 'Cost'], ['spend', 'Spend'], ['ctr', 'CTR']].map(([k, l]) => (
              <button key={k} aria-pressed={tsMetric === k} onClick={() => setTsMetric(k)}>{l}</button>
            ))}
          </div>}>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tsData} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} stroke="var(--axis)" tickLine={false} minTickGap={24} />
                <YAxis stroke="var(--axis)" tickLine={false} axisLine={false}
                  tickFormatter={v => tsMetric === 'ctr' ? nf(v, 1) + '%' : fmt.moneyCompact(v)} />
                <RTooltip labelFormatter={longDate}
                  content={<ChartTip fmt={fmt} unitFor={() => tsMetric === 'ctr' ? (v => fmt.pct(v)) : (v => fmt.money(v))} />} />
                {tsMetric === 'cpa' && <ReferenceLine y={ctrl.targetCpa} stroke="var(--good)" strokeDasharray="5 4" />}
                {chosen.map((e, i) => (
                  <Line key={e.key} type="monotone" dataKey={`${i}_${tsMetric}`} name={e.name}
                    stroke={COLORS[i]} strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {!chosen.length && (
        <Card quiet><p className="text-[13px] py-6 text-center" style={{ color: 'var(--ink-4)' }}>
          Pick something in a slot above, or use the compare icon on any row of the Performance table.
        </p></Card>
      )}
    </div>
  );
};

/* ===================================================================== */
/* SEGMENTS: naming taxonomy + Meta breakdowns                            */
/* ===================================================================== */

const GroupTable = ({ groups, ds, ctrl, fmt, bench, labelHead, showMembers }) => {
  const getters = useMemo(() => ({
    name: e => e.name, spend: e => e.m.spend, conv: e => e.m.conv, cpa: e => e.m.cpa,
    ctr: e => e.m.ctr, cvr: e => e.m.cvr, cpm: e => e.m.cpm, waste: e => e.waste,
  }), []);
  const { sorted, sort, setSort } = useSort(groups, { key: 'spend', dir: 'desc' }, getters);
  return (
    <div className="card overflow-hidden">
      <div className="overflow-auto scroll" style={{ maxHeight: '60vh' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th className="stick" style={{ textAlign: 'left', minWidth: 200 }}>{labelHead}</th>
              <SortHead label="Call" k="verdict" sort={sort} setSort={setSort} align="left" tip="The same verdict rules applied to the group as a whole." />
              <SortHead label="Spend" k="spend" sort={sort} setSort={setSort} tip="Combined spend of everything in this group." />
              <SortHead label={ds.convLabel} k="conv" sort={sort} setSort={setSort} tip="Combined conversions." />
              <SortHead label="Cost / result" k="cpa" sort={sort} setSort={setSort} tip="Group spend ÷ group conversions. Grouping is what gives small entities enough volume for a trustworthy figure." />
              <SortHead label="CPM" k="cpm" sort={sort} setSort={setSort} tip="Auction cost for this group." />
              <SortHead label="CTR" k="ctr" sort={sort} setSort={setSort} tip="Creative strength for this group." />
              <SortHead label="CVR" k="cvr" sort={sort} setSort={setSort} tip="Post-click strength for this group." />
              <SortHead label="Over target" k="waste" sort={sort} setSort={setSort} tip="Spend above what target efficiency would have cost." />
            </tr>
          </thead>
          <tbody>
            {sorted.map(g => (
              <tr key={g.key}>
                <td className="stick" style={{ textAlign: 'left' }}>
                  <div className="font-semibold truncate max-w-[240px]" title={g.name}>{g.name}</div>
                  {showMembers && g.members !== undefined && (
                    <div className="text-[10px] num" style={{ color: 'var(--ink-4)' }}>
                      {g.members} {ctrl.level === 'ad' ? 'ads' : ctrl.level === 'adset' ? 'ad sets' : 'campaigns'}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'left' }}>
                  <Tip tip={g.reason}><span className="help" style={{ borderBottom: 'none' }}><Badge verdict={g.verdict} /></span></Tip>
                </td>
                <td className="num">{fmt.money0(g.m.spend)}</td>
                <td className="num">{fmt.int(g.m.conv)}</td>
                <td className="num font-semibold" style={{ color: g.m.cpa === null ? 'var(--ink-4)' : g.m.cpa > ctrl.targetCpa ? 'var(--bad)' : 'var(--good)' }}>
                  {fmt.money(g.m.cpa)}
                </td>
                <td><div className="num">{fmt.money(g.m.cpm)}</div><VsBench value={g.m.cpm} bench={bench.cpm} higherIsBetter={false} /></td>
                <td><div className="num">{fmt.pct(g.m.ctr)}</div><VsBench value={g.m.ctr} bench={bench.ctr} /></td>
                <td><div className="num">{fmt.pct(g.m.cvr)}</div><VsBench value={g.m.cvr} bench={bench.cvr} /></td>
                <td className="num" style={{ color: g.waste > 0 ? 'var(--warn)' : 'var(--ink-4)' }}>{g.waste > 0 ? fmt.money0(g.waste) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SegmentsView = ({ ds, ctrl, fmt, filters }) => {
  const entities = useMemo(() => aggregate(ds, { level: ctrl.level, filters }), [ds, ctrl.level, filters]);
  const naming = useMemo(() => analyseNaming(entities), [entities]);
  const [mode, setMode] = useState(null);

  const modes = useMemo(() => {
    const m = naming.dimensions.map(d => ({ ...d, source: 'name' }));
    ds.breakdowns.forEach(b => m.push({
      id: `b:${b}`, kind: 'breakdown', label: b, exclusive: true, source: 'meta',
    }));
    return m;
  }, [naming, ds.breakdowns]);

  useEffect(() => { if (modes.length && !modes.some(m => m.id === mode)) setMode(modes[0].id); }, [modes, mode]);
  const active = modes.find(m => m.id === mode);

  const result = useMemo(() => {
    if (!active) return null;
    let raw;
    if (active.kind === 'breakdown') {
      raw = aggregate(ds, { level: ctrl.level, filters, groupBy: r => r.breakdown?.[active.label] || '(none)' });
    } else {
      raw = groupByDimension(entities, active);
    }
    const b = buildBenchmarks(raw);
    return { groups: scoreEntities(raw, b, ds, { ...ctrl }), bench: b };
  }, [active, ds, ctrl, filters, entities]);

  if (!modes.length) {
    return (
      <Card title="Segments" icon={Boxes} quiet>
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          Nothing to group by yet. Two things create groups here:
          <br /><br />
          <b style={{ color: 'var(--ink-2)' }}>Words in your names.</b> Recognisable parts such as Video, Post, Static,
          BOF, ABO or a quarter become dimensions wherever they appear in the name, and any word that recurs across
          several {ctrl.level}s becomes a tag you can group by. Words identical on everything, or unique to everything,
          are skipped because grouping by them tells you nothing.
          <br /><br />
          <b style={{ color: 'var(--ink-2)' }}>Meta breakdowns.</b> Export with Breakdown → By Delivery → Age, Gender,
          Placement or Platform and each appears here.
        </p>
      </Card>
    );
  }

  const byName = modes.filter(m => m.source === 'name');
  const byMeta = modes.filter(m => m.source === 'meta');

  return (
    <div className="anim-in space-y-4">
      <Card title="Group by" icon={Boxes}
        right={<Tip tip={`Grouping pools small ${ctrl.level}s until they carry enough conversions to judge. One ad with three conversions tells you nothing; every video ad together might tell you plenty.`}>
          <span className="chip t-muted help"><Info size={10} />Why group</span></Tip>}>
        {!!byName.length && (
          <>
            <div className="eyebrow mb-2">From the names</div>
            <div className="flex flex-wrap gap-2">
              {byName.map(m => (
                <Tip key={m.id} tip={m.kind === 'tag'
                  ? <span>Every word that recurs across several {ctrl.level}s. A {ctrl.level} can carry more than one, so these groups <b>overlap</b> and their spend will add up to more than the account total.</span>
                  : m.kind === 'vocab'
                    ? <span>Recognised {m.label.toLowerCase()} words found anywhere in the name, on {(m.coverage * 100).toFixed(0)}% of them. {m.values} distinct values.</span>
                    : <span>Part {m.index + 1} of the name, split on underscores and dashes. {m.values} distinct values across {(m.coverage * 100).toFixed(0)}% of names.</span>}>
                  <button className={`btn px-3 py-1.5 text-[12px] font-semibold ${mode === m.id ? 'btn-on' : ''}`}
                    onClick={() => setMode(m.id)}>
                    {m.label}<span className="ml-1.5 opacity-60 num">{m.values}</span>
                    {!m.exclusive && <span className="ml-1.5 opacity-70">overlapping</span>}
                  </button>
                </Tip>
              ))}
            </div>
          </>
        )}
        {!!byMeta.length && (
          <>
            <div className="eyebrow mb-2 mt-4">From Meta breakdowns</div>
            <div className="flex flex-wrap gap-2">
              {byMeta.map(m => (
                <button key={m.id} className={`btn px-3 py-1.5 text-[12px] font-semibold ${mode === m.id ? 'btn-on' : ''}`}
                  onClick={() => setMode(m.id)}>{m.label}</button>
              ))}
            </div>
          </>
        )}
      </Card>

      {active && !active.exclusive && (
        <div className="card card-quiet px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
          <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            These groups overlap. An ad named <span className="num">Lucy_IG_01 - Post</span> counts under both
            <span className="num"> IG</span> and <span className="num"> Post</span>, so the spend column adds up to more
            than the account total. Read each row on its own; do not add them together.
          </p>
        </div>
      )}

      {result && (
        <GroupTable groups={result.groups} ds={ds} ctrl={ctrl} fmt={fmt} bench={result.bench}
          labelHead={active.label} showMembers={active.source === 'name'} />
      )}
      <p className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
        Cost figures here come from each group's combined totals, never from averaging its members' rates.
      </p>
    </div>
  );
};

/* ===================================================================== */
/* CHANGE: first half against second half                                 */
/* ===================================================================== */

const ChangeView = ({ ds, ctrl, fmt, filters }) => {
  const mid = useMemo(() => {
    if (!ds.dateRange.start || !ds.dateRange.end) return null;
    const a = new Date(ds.dateRange.start + 'T00:00:00Z').getTime();
    const b = new Date(ds.dateRange.end + 'T00:00:00Z').getTime();
    return new Date((a + b) / 2).toISOString().slice(0, 10);
  }, [ds.dateRange]);
  const [split, setSplit] = useState(mid);
  useEffect(() => setSplit(mid), [mid]);

  const rows = useMemo(() => split ? comparePeriods(ds, ctrl.level, split, filters) : [], [ds, ctrl.level, split, filters]);

  if (ds.timeGrain === 'lifetime') {
    return (
      <Card title="Change over time" icon={History} quiet>
        <div className="flex items-start gap-3 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
          <Info size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
          <span>
            {ds.periodDays > 1
              ? `Every row in this export covers the same ${ds.periodDays}-day window, so there are no earlier and later halves to compare. `
              : 'Comparing periods needs rows split by day. '}
            Re-export with <b style={{ color: 'var(--ink-2)' }}>Breakdown → By Time → Day</b>, or load a second export
            covering the earlier period and switch between the two files.
          </span>
        </div>
      </Card>
    );
  }

  const Delta = ({ v, invert }) => {
    if (v === null || !isFinite(v)) return <span style={{ color: 'var(--ink-4)' }}>-</span>;
    const good = invert ? v < 0 : v > 0;
    const flat = Math.abs(v) < 0.03;
    return (
      <span className="num" style={{ color: flat ? 'var(--ink-4)' : good ? 'var(--good)' : 'var(--bad)' }}>
        {v > 0 ? '+' : ''}{(v * 100).toFixed(0)}%
      </span>
    );
  };

  const improved = rows.filter(r => r.status === 'both' && r.dCpa !== null && r.dCpa < -0.1 && (r.after?.conv || 0) >= ctrl.minConv);
  const decayed = rows.filter(r => r.status === 'both' && r.dCpa !== null && r.dCpa > 0.1 && (r.after?.conv || 0) >= ctrl.minConv);

  return (
    <div className="anim-in space-y-4">
      <Card title="Split the period" icon={History}
        right={<input type="date" className="field text-[12px]" value={split || ''} min={ds.dateRange.start}
          max={ds.dateRange.end} onChange={e => setSplit(e.target.value)} />}>
        <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
          Everything before {longDate(split)} is the “before”; that date onward is the “after”. Move the date to line the
          split up with something real, such as a budget change, a new creative or a promotion, and the table shows what moved with it.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <div className="card card-quiet px-4 py-3">
            <div className="eyebrow mb-1.5" style={{ color: 'var(--good)' }}>Improved</div>
            {improved.length ? improved.slice(0, 4).map(r => (
              <div key={r.key} className="flex justify-between gap-3 text-[12px] py-0.5">
                <span className="truncate" title={r.name}>{r.name}</span>
                <span className="num shrink-0" style={{ color: 'var(--good)' }}>{(r.dCpa * 100).toFixed(0)}%</span>
              </div>
            )) : <span className="text-[12px]" style={{ color: 'var(--ink-4)' }}>Nothing improved materially with enough volume to say so.</span>}
          </div>
          <div className="card card-quiet px-4 py-3">
            <div className="eyebrow mb-1.5" style={{ color: 'var(--bad)' }}>Got worse</div>
            {decayed.length ? decayed.slice(0, 4).map(r => (
              <div key={r.key} className="flex justify-between gap-3 text-[12px] py-0.5">
                <span className="truncate" title={r.name}>{r.name}</span>
                <span className="num shrink-0" style={{ color: 'var(--bad)' }}>+{(r.dCpa * 100).toFixed(0)}%</span>
              </div>
            )) : <span className="text-[12px]" style={{ color: 'var(--ink-4)' }}>Nothing decayed materially with enough volume to say so.</span>}
          </div>
        </div>
      </Card>

      <div className="card overflow-hidden">
        <div className="overflow-auto scroll" style={{ maxHeight: '60vh' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th className="stick" style={{ textAlign: 'left', minWidth: 220 }}>{ctrl.level}</th>
                <th><Tip tip="Spend in the later half compared with the earlier half."><span className="help">Spend</span></Tip></th>
                <th><Tip tip="Change in spend. Neither direction is good or bad on its own, since it is context for the rest of the row."><span className="help">Δ</span></Tip></th>
                <th><Tip tip="Conversions in the later half."><span className="help">{ds.convLabel}</span></Tip></th>
                <th><Tip tip="Change in conversion volume."><span className="help">Δ</span></Tip></th>
                <th><Tip tip="Cost per result in the later half."><span className="help">Cost</span></Tip></th>
                <th><Tip tip="Change in cost per result. Green means it got cheaper. This is the column that matters most."><span className="help">Δ</span></Tip></th>
                <th><Tip tip="Change in click-through rate. Falling CTR alongside rising cost is the classic fatigue pattern."><span className="help">Δ CTR</span></Tip></th>
                <th><Tip tip="Change in post-click conversion rate. Falling here with steady CTR points at the landing page rather than the ad."><span className="help">Δ CVR</span></Tip></th>
                <th><Tip tip="Change in auction cost per thousand impressions."><span className="help">Δ CPM</span></Tip></th>
                <th style={{ textAlign: 'left' }}>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td className="stick" style={{ textAlign: 'left' }}>
                    <div className="font-semibold truncate max-w-[240px]" title={r.name}>{r.name}</div>
                  </td>
                  <td className="num">{fmt.money0(r.after?.spend ?? 0)}</td>
                  <td><Delta v={r.dSpend} /></td>
                  <td className="num">{fmt.int(r.after?.conv ?? 0)}</td>
                  <td><Delta v={r.dConv} /></td>
                  <td className="num" style={{ color: (r.after?.cpa ?? 0) > ctrl.targetCpa ? 'var(--bad)' : 'var(--good)' }}>
                    {fmt.money(r.after?.cpa)}
                  </td>
                  <td><Delta v={r.dCpa} invert /></td>
                  <td><Delta v={r.dCtr} /></td>
                  <td><Delta v={r.dCvr} /></td>
                  <td><Delta v={r.dCpm} invert /></td>
                  <td style={{ textAlign: 'left' }}>
                    {r.status === 'new' ? <span className="chip t-info">Started</span>
                      : r.status === 'stopped' ? <span className="chip t-muted">Stopped</span>
                        : <span className="chip t-neutral">Ran both</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/* ===================================================================== */
/* BUDGET SIMULATOR                                                       */
/* ===================================================================== */

const BudgetView = ({ ds, scored, bench, ctrl, fmt }) => {
  const [changes, setChanges] = useState({});
  const [decay, setDecay] = useState(0.15);
  const [planNote, setPlanNote] = useState(null);
  const [includeOff, setIncludeOff] = useState(false);
  const levelWord = ctrl.level === 'ad' ? 'ad' : ctrl.level === 'adset' ? 'ad set' : 'campaign';
  // Budgets can only be moved on things that are still delivering. Listing
  // 220 switched-off ads with sliders invites plans that cannot be executed.
  const hasStatus = scored.some(e => e.status && e.status !== 'unknown');
  const rows = useMemo(() => (hasStatus && !includeOff ? scored.filter(e => e.isLive) : scored), [scored, hasStatus, includeOff]);
  const offCount = scored.length - rows.length;
  useEffect(() => { setChanges({}); setPlanNote(null); }, [ctrl.level, includeOff]);
  const sim = useMemo(() => simulateReallocation(rows, changes, { decayPerDouble: decay }), [rows, changes, decay]);

  const MAX_MULT = 3;
  const suggest = () => {
    const next = {};
    // Sources in order of how confident we are that the money is wasted.
    // Previously only "cut" counted, so on an account with none the button
    // silently did nothing at all.
    const cuts = rows.filter(e => e.verdict === 'cut');
    const fixes = rows.filter(e => e.verdict === 'fix');
    const watches = rows.filter(e => e.verdict === 'watch');
    let freed = 0;
    const take = (list, keepFraction) => list.forEach(e => {
      const base = e.m.cpaSpend || e.m.spend;
      if (!(base > 0)) return;
      next[e.key] = keepFraction;
      freed += base * (1 - keepFraction);
    });
    take(cuts, 0);
    if (freed <= 0) take(fixes, 0.5);
    if (freed <= 0) take(watches, 0.75);

    const winners = rows
      .filter(e => ['scale', 'starve', 'keep'].includes(e.verdict) && e.m.conv >= ctrl.minConv && e.m.cpa !== null)
      .sort((a, b) => a.m.cpa - b.m.cpa);

    if (!winners.length) {
      setPlanNote(`Nothing to reallocate into: no ${levelWord} is under target with at least ${ctrl.minConv} ${ds.convLabel.toLowerCase()}. Lower "Min results" in the control bar, or widen the period, before trusting a plan.`);
      setChanges(next); return;
    }
    if (freed <= 0) {
      setPlanNote(`Nothing to reallocate out of: no ${levelWord} in this view is running above target. That is a good position to be in, so any growth here means adding budget rather than moving it.`);
      setChanges({}); return;
    }

    // Weight towards the most efficient rather than splitting evenly.
    const picks = winners.slice(0, 3);
    const weights = picks.map((_, i) => 1 / (i + 1));
    const wsum = weights.reduce((s, w) => s + w, 0);
    let capped = false;
    picks.forEach((e, i) => {
      const base = e.m.cpaSpend || e.m.spend;
      if (!(base > 0)) return;
      const raw = (base + freed * (weights[i] / wsum)) / base;
      const m = Math.round(Math.min(raw, MAX_MULT) * 10) / 10;
      if (raw > MAX_MULT) capped = true;
      next[e.key] = m;
    });
    setPlanNote(`Freed ${fmt.money0(freed)} from ${cuts.length ? `${cuts.length} rated Cut` : fixes.length ? `${fixes.length} rated Fix` : `${watches.length} rated Watch`} and weighted it towards the ${picks.length} cheapest performers.${capped ? ` One or more increases were capped at ${MAX_MULT}× because tripling a budget is already beyond what these figures can support.` : ''}`);
    setChanges(next);
  };

  const changedCount = Object.keys(changes).filter(k => changes[k] !== 1).length;
  const dConv = sim.newConv - sim.curConv;

  return (
    <div className="anim-in space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Spend now" value={fmt.moneyCompact(sim.curSpend)} sub={`${fmt.int(sim.curConv)} ${ds.convLabel.toLowerCase()}`}
          tip="On-goal spend and conversions for everything currently in view." />
        <Stat label="Spend after changes" value={fmt.moneyCompact(sim.newSpend)}
          sub={`${changedCount} change${changedCount === 1 ? '' : 's'}`}
          tip="What you would be spending if the multipliers below were applied." />
        <Stat label={`${ds.convLabel} after`} value={fmt.int(Math.round(sim.newConv))}
          tone={dConv > 0 ? 'var(--good)' : dConv < 0 ? 'var(--bad)' : undefined}
          sub={`${dConv >= 0 ? '+' : ''}${Math.round(dConv)} versus now`}
          tip="Projected conversions, with the efficiency penalty below applied to anything you scale up." />
        <Stat label="Cost per result after" value={fmt.money(sim.newCpa)}
          tone={sim.newCpa === null ? undefined : sim.newCpa <= ctrl.targetCpa ? 'var(--good)' : 'var(--bad)'}
          sub={sim.curCpa ? `now ${fmt.money(sim.curCpa)}` : ''}
          tip="Projected blended cost per result across the new plan." />
      </div>

      <Card title="How pessimistic should this be?" icon={SlidersHorizontal}>
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          {/* min-w-0 stops the slider column overflowing under the buttons */}
          <div className="flex-1 min-w-0">
            <div className="flex justify-between text-[11px] mb-1.5">
              <Tip tip="Doubling a budget almost never keeps the same cost per result, because you buy a less responsive audience and compete against yourself in the auction. This is how much worse each doubling gets. Zero is the naive projection almost every media plan quietly assumes, and it is the main reason plans miss.">
                <span className="help" style={{ color: 'var(--ink-3)' }}>Efficiency lost per doubling of budget</span>
              </Tip>
              <span className="num font-bold" style={{ color: 'var(--accent)' }}>{(decay * 100).toFixed(0)}%</span>
            </div>
            <input type="range" min={0} max={0.6} step={0.05} value={decay}
              onChange={e => setDecay(parseFloat(e.target.value))} className="w-full" />
            <div className="flex justify-between text-[10px] num mt-1" style={{ color: 'var(--ink-4)' }}>
              <span>0% naive</span><span>15% typical</span><span>60% harsh</span>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Tip tip="Zero out everything rated Cut and spread the freed budget across your three most efficient performers, in proportion.">
              <button className="btn btn-on px-3 py-2 text-[12px] font-semibold inline-flex items-center gap-1.5" onClick={suggest}>
                <Sparkles size={13} /> Suggest a plan
              </button>
            </Tip>
            <button className="btn px-3 py-2 text-[12px] font-semibold"
              onClick={() => { setChanges({}); setPlanNote(null); }}>Reset</button>
          </div>
        </div>
      </Card>

      {planNote && (
        <div className="card card-quiet px-4 py-3 flex items-start gap-2.5">
          <Sparkles size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
          <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>{planNote}</p>
        </div>
      )}

      {hasStatus && offCount > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap text-[11.5px] px-1" style={{ color: 'var(--ink-4)' }}>
          <span>Showing the {rows.length} {levelWord}{rows.length === 1 ? '' : 's'} still delivering. {offCount} switched off {offCount === 1 ? 'is' : 'are'} hidden, because their budgets cannot be changed.</span>
          <button className="btn px-2.5 py-1 text-[11px] font-semibold" onClick={() => setIncludeOff(v => !v)}>
            {includeOff ? 'Hide switched off' : 'Show switched off too'}
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-auto scroll" style={{ maxHeight: '55vh' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th className="stick" style={{ textAlign: 'left', minWidth: 220 }}>{ctrl.level}</th>
                <th style={{ textAlign: 'left' }}>Call</th>
                <th>Spend now</th>
                <th>Cost now</th>
                <th style={{ textAlign: 'center', minWidth: 190 }}>
                  <Tip tip="Multiply this entity's budget. Zero switches it off entirely."><span className="help">New budget</span></Tip>
                </th>
                <th>Spend after</th>
                <th><Tip tip="Cost per result after the efficiency penalty is applied to any increase."><span className="help">Cost after</span></Tip></th>
                <th><Tip tip="Projected conversions at the new budget and cost."><span className="help">Results after</span></Tip></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(e => {
                const mult = changes[e.key] ?? 1;
                const base = e.m.cpaSpend || e.m.spend;
                const cpa1 = e.m.cpa === null ? null : mult > 1 ? e.m.cpa * (1 + decay * Math.log2(mult)) : e.m.cpa;
                const spend1 = base * mult;
                const conv1 = cpa1 && cpa1 > 0 ? spend1 / cpa1 : 0;
                return (
                  <tr key={e.key}>
                    <td className="stick" style={{ textAlign: 'left' }}>
                      <div className="font-semibold truncate max-w-[240px]" title={e.name}>{e.name}</div>
                    </td>
                    <td style={{ textAlign: 'left' }}><Badge verdict={e.verdict} /></td>
                    <td className="num">{fmt.money0(base)}</td>
                    <td className="num">{fmt.money(e.m.cpa)}</td>
                    <td>
                      <div className="flex items-center gap-2 justify-center">
                        <input type="range" min={0} max={MAX_MULT} step={0.1} value={Math.min(mult, MAX_MULT)} style={{ width: 96 }}
                          onChange={ev => setChanges(c => ({ ...c, [e.key]: parseFloat(ev.target.value) }))} />
                        <span className="num text-[11px] w-9 text-right"
                          style={{ color: mult === 0 ? 'var(--bad)' : mult > 1 ? 'var(--good)' : mult < 1 ? 'var(--warn)' : 'var(--ink-4)' }}>
                          {mult === 0 ? 'off' : `${mult.toFixed(1)}×`}
                        </span>
                      </div>
                    </td>
                    <td className="num" style={{ color: mult !== 1 ? 'var(--ink)' : 'var(--ink-4)' }}>{fmt.money0(spend1)}</td>
                    <td className="num" style={{ color: cpa1 && cpa1 > ctrl.targetCpa ? 'var(--bad)' : undefined }}>{fmt.money(cpa1)}</td>
                    <td className="num">{conv1 ? nf(conv1, 1) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-quiet px-4 py-3 flex items-start gap-2.5">
        <Info size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--info)' }} />
        <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          This is arithmetic on past performance, not a forecast. It assumes each entity keeps working the way it has,
          which is least true exactly where you are most tempted to believe it, namely the winner you want to triple. Treat the
          projection as a ceiling, move budgets in steps of twenty or thirty percent, and re-read the numbers before the
          next step. Anything switched off also loses its learning, so switching it back on later is not free.
        </p>
      </div>
    </div>
  );
};

/* ===================================================================== */
/* APP SHELL                                                              */
/* ===================================================================== */

// Bumped on every delivery. If the sidebar does not show this string, the
// browser is still running an older bundle.
const BUILD = 'build 2.4 · 2026-08-06';

const NAV = [
  { id: 'files', label: 'Exports', icon: Database },
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'performance', label: 'Performance', icon: Table2 },
  { id: 'compare', label: 'Compare', icon: GitCompare },
  { id: 'segments', label: 'Segments', icon: Boxes },
  { id: 'change', label: 'Change', icon: History },
  { id: 'budget', label: 'Budget', icon: Wallet },
];

export default function App() {
  const [theme, setTheme] = useStored('mv_theme', 'dark');
  const [files, setFiles] = useState([]);
  const [activeId, setActiveId] = useStored('mv_active', null);
  const [tab, setTab] = useState('files');
  const [picks, setPicks] = useState([]);
  const [ctrlStore, setCtrlStore] = useStored('mv_ctrl', { targetCpa: 30, minConv: 5, fatigueFreq: 2.5, grain: 'day' });
  const [level, setLevel] = useState(null);
  const [search, setSearch] = useState('');
  const [indicator, setIndicator] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [delivery, setDelivery] = useState('');

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  /* --- persistence --- */
  useEffect(() => {
    let dead = false;
    store.all().then(list => {
      if (dead || !list.length) return;
      const restored = [];
      for (const rec of list.sort((a, b) => a.addedAt - b.addedAt)) {
        try { restored.push({ id: rec.id, name: rec.name, addedAt: rec.addedAt, ds: parseMetaCSV(rec.text, rec.name) }); }
        catch { /* a file that no longer parses is dropped silently */ }
      }
      if (!restored.length) return;
      setFiles(restored);
      setActiveId(prev => restored.some(f => f.id === prev) ? prev : restored[0].id);
      setTab('overview');
    }).catch(() => {});
    return () => { dead = true; };
  }, []);

  const addFile = (ds, text) => {
    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      let name = ds.fileName.replace(/^\d{8,}[_-]/, '').replace(/-\d{1,2}-[A-Za-z]{3}-\d{4}-\d{1,2}-[A-Za-z]{3}-\d{4}$/, ''); let n = 2;
      while (names.has(name)) name = `${ds.fileName} (${n++})`;
      store.put({ id, name, text, addedAt: Date.now() });
      return [...prev, { id, name, addedAt: Date.now(), ds }];
    });
    setActiveId(id);
  };
  const removeFile = (id) => {
    store.del(id);
    setFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      if (id === activeId) setActiveId(next[0]?.id || null);
      return next;
    });
  };
  const renameFile = (id, name) => setFiles(prev => prev.map(f => {
    if (f.id !== id) return f;
    store.all().then(all => {
      const rec = all.find(r => r.id === id);
      if (rec) store.put({ ...rec, name });
    }).catch(() => {});
    return { ...f, name };
  }));

  const active = files.find(f => f.id === activeId) || null;
  const ds = active?.ds || null;
  const fmt = useMemo(() => makeFmt(ds), [ds]);

  /* --- level defaults to the finest available in this file --- */
  useEffect(() => {
    if (!ds) return;
    // Always drop to the finest level the new file supports. Carrying a
    // coarser choice over from a previous export silently hides the detail
    // the user just loaded.
    setLevel(ds.finestLevel);
    setIndicator('');
    setDelivery('');
    setRange({ from: '', to: '' });
    setPicks([]);
    // A name filter left over from another export makes the new one look
    // empty with no visible cause.
    setSearch('');
  }, [ds]);

  // A fresh object literal here would give every downstream memo a new
  // dependency on every keystroke, re-scoring 25k rows as the user types.
  const ctrl = useMemo(() => ({ ...ctrlStore, level: level || ds?.finestLevel || 'campaign' }),
    [ctrlStore, level, ds]);
  // Status is a property of the entity, not of each row. Filtering rows by
  // delivery would show only the spend that happened while an ad was active,
  // which is a different and far more confusing question than "what is live".
  const filters = useMemo(() => ({
    dateFrom: range.from || undefined, dateTo: range.to || undefined,
    indicator: indicator || undefined, search: search || undefined,
  }), [range, indicator, search]);
  const byStatus = useCallback((list) => (
    !delivery ? list : list.filter(e => (e.m.status || 'unknown') === delivery)
  ), [delivery]);

  const entitiesAll = useMemo(() => ds ? aggregate(ds, { level: ctrl.level, filters }) : [], [ds, ctrl.level, filters]);
  const entities = useMemo(() => byStatus(entitiesAll), [entitiesAll, byStatus]);
  // Benchmarks come from the unfiltered account so a search cannot move
  // the yardstick an entity is being judged against.
  const universe = useMemo(() => ds ? aggregate(ds, {
    level: ctrl.level, filters: { dateFrom: range.from || undefined, dateTo: range.to || undefined, indicator: indicator || undefined },
  }) : [], [ds, ctrl.level, range, indicator]);
  const statusCounts = useMemo(() => {
    const c = { all: universe.length, live: 0, off: 0, unknown: 0 };
    universe.forEach(e => { c[e.m.status || 'unknown'] = (c[e.m.status || 'unknown'] || 0) + 1; });
    c.spendLive = universe.filter(e => e.m.status === 'live').reduce((s, e) => s + e.m.spend, 0);
    c.spendOff = universe.filter(e => e.m.status === 'off').reduce((s, e) => s + e.m.spend, 0);
    return c;
  }, [universe]);
  const benchBase = useMemo(() => byStatus(universe), [universe, byStatus]);
  const bench = useMemo(() => buildBenchmarks(benchBase), [benchBase]);
  const scored = useMemo(() => ds ? scoreEntities(entities, bench, ds, ctrl) : [], [entities, bench, ds, ctrl]);
  const scoredAll = useMemo(() => ds ? scoreEntities(benchBase, bench, ds, ctrl) : [], [benchBase, bench, ds, ctrl]);
  const findings = useMemo(() => ds ? generateFindings(scoredAll, bench, ds, ctrl) : [], [scoredAll, bench, ds, ctrl]);
  const series = useMemo(() => ds ? entitySeries(ds, ctrl.level, filters) : new Map(), [ds, ctrl.level, filters]);

  const focus = (key) => { setSearch(key); setTab('performance'); };
  const addCompare = (key) => {
    setPicks(p => p.includes(key) ? p : [...p, key].slice(-4));
    setTab('compare');
  };

  const NavBtn = ({ id, label, icon: Icon }) => {
    const on = tab === id;
    const disabled = !ds && id !== 'files';
    return (
      <button disabled={disabled} onClick={() => setTab(id)}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl border text-[13px] font-medium transition-colors ${on ? '' : 'border-transparent'}`}
        style={{
          borderColor: on ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'transparent',
          background: on ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
          color: disabled ? 'var(--ink-4)' : on ? 'var(--ink)' : 'var(--ink-3)',
          opacity: disabled ? 0.45 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
        }}>
        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border"
          style={on
            ? { background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', borderColor: 'transparent', color: 'var(--on-accent)' }
            : { background: 'var(--panel-lo)', borderColor: 'var(--edge)', color: 'inherit' }}>
          <Icon size={15} strokeWidth={2.2} />
        </span>
        <span className={on ? 'font-semibold' : ''}>{label}</span>
        {id === 'files' && files.length > 0 && (
          <span className="ml-auto num text-[10px] px-1.5 rounded" style={{ background: 'var(--hover)', color: 'var(--ink-4)' }}>
            {files.length}
          </span>
        )}
      </button>
    );
  };

  return (
    <ThemeCtx.Provider value={theme}>
      <div className="min-h-screen flex">
        <aside className="fixed inset-y-0 left-0 w-[228px] hidden md:flex flex-col z-30"
          style={{ background: 'var(--sticky)', borderRight: '1px solid var(--edge)' }}>
          <div className="px-4 py-5">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
                <Gauge size={17} style={{ color: 'var(--on-accent)' }} />
              </span>
              <div>
                <div className="font-bold leading-none">Meta<span style={{ color: 'var(--ink-3)', fontWeight: 300 }}>Vision</span></div>
                <div className="eyebrow mt-1" style={{ letterSpacing: '0.14em' }}>Decision engine</div>
                <div className="num text-[9px] mt-0.5" style={{ color: 'var(--ink-4)' }}>{BUILD}</div>
              </div>
            </div>
          </div>
          <nav className="flex-1 px-3 space-y-1 overflow-y-auto scroll">
            {NAV.map(n => <NavBtn key={n.id} {...n} />)}
          </nav>
          <div className="p-3">
            <div className="card card-quiet px-3 py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold truncate">{active ? active.name : 'No export loaded'}</div>
                <div className="text-[10px]" style={{ color: 'var(--ink-4)' }}>Processed in this browser</div>
              </div>
              <Tip tip={`Switch to the ${theme === 'dark' ? 'light' : 'dark'} theme.`}>
                <button className="btn p-1.5" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
                  {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                </button>
              </Tip>
            </div>
          </div>
        </aside>

        <main className="flex-1 md:ml-[228px] min-w-0">
          {/* control bar */}
          <div className="sticky top-0 z-20 px-4 md:px-7 py-3"
            style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--edge)' }}>
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="md:hidden seg">
                {NAV.map(n => <button key={n.id} aria-pressed={tab === n.id} onClick={() => setTab(n.id)}
                  disabled={!ds && n.id !== 'files'} className="px-2"><n.icon size={14} /></button>)}
              </div>

              {ds && (
                <>
                  {ds.levelsPresent.length > 1 && (
                    <Tip tip="Which level of the account to analyse. Ad-level data rolls up into ad sets and campaigns, so an ad-level export can answer all three; the reverse is not true.">
                      <div className="seg">
                        {ds.levelsPresent.map(l => (
                          <button key={l} aria-pressed={ctrl.level === l} onClick={() => { setLevel(l); setPicks([]); }}>
                            {l === 'adset' ? 'Ad sets' : l === 'ad' ? 'Ads' : 'Campaigns'}
                          </button>
                        ))}
                      </div>
                    </Tip>
                  )}

                  <Tip tip={`Everything is judged against this. Set it to what a ${ds.convLabel.toLowerCase().replace(/s$/, '')} is actually worth to you. For a booking, that is usually the value of the booking multiplied by your margin.`}>
                    <label className="flex items-center gap-1.5 field py-1.5 px-2.5 cursor-help">
                      <Target size={13} style={{ color: 'var(--accent)' }} />
                      <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>Target</span>
                      <span className="num text-[12px]">{fmt.sym}</span>
                      <input type="number" min={0} step={1} value={ctrlStore.targetCpa}
                        onChange={e => setCtrlStore({ ...ctrlStore, targetCpa: Math.max(0, parseFloat(e.target.value) || 0) })}
                        className="num bg-transparent w-14 text-[12px] focus:outline-none" style={{ color: 'var(--ink)' }} />
                    </label>
                  </Tip>

                  <Tip tip="How many conversions an entity needs before its cost figure is treated as a real read rather than noise. Below this it is labelled “No read” instead of being praised or condemned.">
                    <label className="flex items-center gap-1.5 field py-1.5 px-2.5 cursor-help">
                      <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>Min results</span>
                      <input type="number" min={1} step={1} value={ctrlStore.minConv}
                        onChange={e => setCtrlStore({ ...ctrlStore, minConv: Math.max(1, parseInt(e.target.value) || 1) })}
                        className="num bg-transparent w-9 text-[12px] focus:outline-none" style={{ color: 'var(--ink)' }} />
                    </label>
                  </Tip>

                  {ds.indicators.length > 1 && (
                    <Tip tip="Isolate one optimisation goal. Results mean something different under each, so comparing across them is not meaningful.">
                      <select className="field text-[12px] py-1.5" value={indicator} onChange={e => setIndicator(e.target.value)}>
                        <option value="">All goals</option>
                        {ds.indicators.map(i => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </Tip>
                  )}

                  {statusCounts.live + statusCounts.off > 0 && (
                    <Tip tip={<span>Ads Manager keeps paused and archived entities in the export, and their spend is still counted here. <b>Live</b> is what you can still change today; <b>Off</b> is history. Verdicts and recommendations adapt to whichever you are looking at.</span>}>
                      <div className="seg">
                        {[['', 'All', statusCounts.all], ['live', 'Live', statusCounts.live], ['off', 'Off', statusCounts.off]]
                          .filter(([v, , n]) => v === '' || n > 0).map(([v, l, n]) => (
                          <button key={v} aria-pressed={delivery === v} onClick={() => setDelivery(v)}>
                            {v === 'live' && <span className="live-dot" />}{l}
                            <span className="ml-1.5 opacity-60 num">{n}</span>
                          </button>
                        ))}
                      </div>
                    </Tip>
                  )}

                  {ds.timeGrain !== 'lifetime' && (
                    <Tip tip="Narrow the period. Leave both blank for everything in the file.">
                      <span className="flex items-center gap-1">
                        <input type="date" className="field text-[11px] py-1.5" value={range.from}
                          min={ds.dateRange.start} max={ds.dateRange.end}
                          onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
                        <span style={{ color: 'var(--ink-4)' }}>→</span>
                        <input type="date" className="field text-[11px] py-1.5" value={range.to}
                          min={ds.dateRange.start} max={ds.dateRange.end}
                          onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
                      </span>
                    </Tip>
                  )}

                  <label className="flex items-center gap-1.5 field py-1.5 px-2.5 flex-1 min-w-[150px] max-w-[300px]">
                    <Search size={13} style={{ color: 'var(--ink-4)' }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by name"
                      className="bg-transparent text-[12px] w-full focus:outline-none" style={{ color: 'var(--ink)' }} />
                    {search && <button onClick={() => setSearch('')} aria-label="Clear filter"><X size={12} /></button>}
                  </label>

                  {files.length > 1 && (
                    <Tip tip="Switch between loaded exports. Each keeps its own structure, currency and warnings.">
                      <select className="field text-[12px] py-1.5 max-w-[170px] truncate" value={activeId || ''}
                        onChange={e => setActiveId(e.target.value)}>
                        {files.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </Tip>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="px-4 md:px-7 py-6 pb-20 max-w-[1500px]">
            {tab !== 'files' && ds && (
              <header className="mb-5">
                <div className="eyebrow mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {delivery === 'live' && <span className="chip t-good"><span className="live-dot" />Live only</span>}
                  {delivery === 'off' && <span className="chip t-muted">Switched off only</span>}
                  <span>{ds.currency} · {ctrl.level === 'ad' ? 'Ad level' : ctrl.level === 'adset' ? 'Ad set level' : 'Campaign level'}</span>
                  {(() => {
                    // For a lifetime export every row carries the same start date, so
                    // the min and max of the row dates collapse to a single day. The
                    // window that actually describes the file is the reporting range.
                    const r = ds.timeGrain === 'lifetime' ? ds.reportingRange : ds.dateRange;
                    return r?.start ? ` · ${longDate(r.start)} → ${longDate(r.end || r.start)}` : ' · lifetime totals';
                  })()}
                </div>
                <h1 className="text-[26px] font-light leading-tight">
                  {tab === 'overview' && <>What is <span className="font-bold">working</span></>}
                  {tab === 'performance' && <>Every <span className="font-bold">{ctrl.level === 'ad' ? 'ad' : ctrl.level === 'adset' ? 'ad set' : 'campaign'}</span>, judged</>}
                  {tab === 'compare' && <>Head to <span className="font-bold">head</span></>}
                  {tab === 'segments' && <>Patterns across <span className="font-bold">segments</span></>}
                  {tab === 'change' && <>What <span className="font-bold">changed</span></>}
                  {tab === 'budget' && <>Where the <span className="font-bold">budget</span> should go</>}
                </h1>
              </header>
            )}

            {tab === 'files' && (
              <IngestionView files={files} activeId={activeId} onAdd={addFile} onRemove={removeFile}
                onRename={renameFile} onSelect={(id) => { setActiveId(id); setTab('overview'); }} />
            )}
            {!ds && tab !== 'files' && (
              <Card quiet><p className="text-[13px] py-8 text-center" style={{ color: 'var(--ink-4)' }}>
                Load an export first.</p></Card>
            )}
            {ds && tab === 'overview' && (
              <OverviewView ds={ds} entities={entities} scored={scored} bench={bench} findings={findings}
                ctrl={ctrl} fmt={fmt} onFocus={focus} series={series} />
            )}
            {ds && tab === 'performance' && (
              <PerformanceView ds={ds} scored={scored} bench={bench} ctrl={ctrl} fmt={fmt}
                series={series} onFocus={focus} onCompare={addCompare} />
            )}
            {ds && tab === 'compare' && (
              <CompareView ds={ds} scored={scoredAll} bench={bench} ctrl={ctrl} fmt={fmt}
                picks={picks} setPicks={setPicks} series={series} />
            )}
            {ds && tab === 'segments' && (
              <SegmentsView ds={ds} ctrl={ctrl} fmt={fmt} filters={filters} />
            )}
            {ds && tab === 'change' && (
              <ChangeView ds={ds} ctrl={ctrl} fmt={fmt} filters={filters} />
            )}
            {ds && tab === 'budget' && (
              <BudgetView ds={ds} scored={scored} bench={bench} ctrl={ctrl} fmt={fmt} />
            )}
          </div>
        </main>
      </div>
    </ThemeCtx.Provider>
  );
}
