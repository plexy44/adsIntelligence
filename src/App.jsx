import React, { useState, useMemo, useEffect } from 'react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, 
  AreaChart, Area, Line, ComposedChart, Legend, BarChart, Bar, Cell, 
  LineChart, ScatterChart, Scatter
} from 'recharts';
import { 
  Upload, CheckCircle, AlertCircle, RefreshCw, Activity, 
  TrendingUp, TrendingDown, DollarSign, Target, MousePointerClick, 
  BarChart2, Layers, Sparkles, LayoutDashboard, Search, Calendar, Info,
  BarChart3, LineChart as LineChartIcon, ScatterChart as ScatterChartIcon, ArrowRightLeft,
  ChevronUp, ChevronDown, ListOrdered, Filter
} from 'lucide-react';

// --- ROBUST LEXICAL CSV PARSER ---
const parseCSV = (text) => {
    const lines = [];
    let currentLine = [];
    let currentCell = '';
    let inQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];
        
        if (c === '"') {
            if (inQuotes && next === '"') {
                currentCell += '"';
                i++; 
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            currentLine.push(currentCell);
            currentCell = '';
        } else if ((c === '\n' || c === '\r') && !inQuotes) {
            if (c === '\r' && next === '\n') i++; 
            currentLine.push(currentCell);
            if (currentLine.some(cell => cell.trim() !== '')) lines.push(currentLine);
            currentLine = [];
            currentCell = '';
        } else {
            currentCell += c;
        }
    }
    
    if (currentCell !== '' || currentLine.length > 0) {
        currentLine.push(currentCell);
        if (currentLine.some(cell => cell.trim() !== '')) lines.push(currentLine);
    }
    return lines;
};

// --- UTILS & FORMATTERS ---

const formatToUKDate = (dateStr) => {
    if (!dateStr || !dateStr.includes('-')) return dateStr;
    const [y, m, d] = dateStr.split('-');
    if (y.length !== 4) return dateStr;
    
    const dateObj = new Date(y, parseInt(m) - 1, d);
    if (isNaN(dateObj)) return dateStr;
    
    const day = dateObj.getDate();
    const suffix = ["th", "st", "nd", "rd"][day % 10 > 3 ? 0 : (day % 100 - day % 10 !== 10) * day % 10];
    const month = dateObj.toLocaleString('en-GB', { month: 'short' });
    return `${day}${suffix} ${month} ${y}`;
};

const getGranularDate = (dateStr, granularity) => {
    if (!dateStr || dateStr === 'Unknown') return 'Unknown';
    const [y, m, d] = dateStr.split('-');
    const dateObj = new Date(y, parseInt(m) - 1, d);
    if (isNaN(dateObj)) return dateStr;

    if (granularity === 'monthly') {
        return `${y}-${m}-01`;
    }
    if (granularity === 'weekly') {
        const day = dateObj.getDay() || 7; 
        dateObj.setDate(dateObj.getDate() - day + 1); 
        return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
    }
    return dateStr; // daily
};

const formatValue = (val, unit) => {
    if (val === undefined || val === null || isNaN(val)) return '-';
    const num = Number(val);
    
    switch(unit) {
        case 'currency': return `£${num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        case 'percentage': return `${num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
        case 'ratio': return `${num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
        case 'integer': return Math.round(num).toLocaleString('en-GB');
        case 'float': return num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        default: return num.toLocaleString('en-GB');
    }
};

const formatYAxisTick = (val, unit) => {
    if (val === 0) return '0';
    if (unit === 'currency') return val >= 1000 ? `£${(val/1000).toFixed(1)}k` : `£${val.toFixed(0)}`;
    if (unit === 'percentage') return `${val.toFixed(1)}%`;
    if (unit === 'ratio') return `${val.toFixed(1)}x`;
    return val >= 1000 ? `${(val/1000).toFixed(1)}k` : val.toFixed(0);
};

const ENTITY_COLORS = ['#818cf8', '#2dd4bf', '#fb7185']; 
const METRIC_DASHES = ['', '5 5', '1 3']; 

// --- STYLING & GLASSMORPHISM UTILS ---

const GlassCard = ({ children, className = "", title, icon: Icon, action, noPadding }) => (
  <div className={`relative overflow-hidden rounded-2xl border border-white/10 bg-[#0e0e12]/60 backdrop-blur-2xl shadow-2xl transition-all flex flex-col ${className}`}>
    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
    <div className="relative z-10 flex flex-col h-full w-full">
      {(title || action) && (
        <div className={`px-5 pt-5 pb-3 flex items-center justify-between shrink-0 ${noPadding ? '' : ''}`}>
          <div className="flex items-center space-x-2 text-slate-400">
            {Icon && <Icon size={16} className="text-indigo-400" />}
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase">{title}</span>
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={`flex-1 flex flex-col w-full ${noPadding ? '' : (title ? 'px-5 pb-5' : 'p-5')}`}>
        {children}
      </div>
    </div>
  </div>
);

const KPICard = ({ title, value, trend, trendValue, icon: Icon }) => (
  <GlassCard className="group hover:border-indigo-500/30 hover:bg-white/[0.04]">
    <div className="flex items-start justify-between mb-2">
      <div className="flex items-center space-x-2 text-slate-400">
        <Icon size={16} className="text-indigo-400 group-hover:text-indigo-300 transition-colors" />
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase">{title}</span>
      </div>
      {trend && (
        <div className={`flex items-center px-2 py-1 rounded-md text-[10px] font-bold ${trend === 'up' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
          {trend === 'up' ? <TrendingUp size={12} className="mr-1" /> : <TrendingDown size={12} className="mr-1" />}
          {trendValue}
        </div>
      )}
    </div>
    <div className="mt-4">
      <div className="text-3xl font-bold text-white tracking-tight flex items-baseline gap-1">
        {value}
      </div>
    </div>
  </GlassCard>
);

// --- CANONICAL ONTOLOGY ENGINE ---

const sanitizeNumber = (val) => {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  const cleaned = val.toString().replace(/[^0-9.-]+/g, "");
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
  return isNaN(parseFloat(cleaned)) ? 0 : parseFloat(cleaned);
};

const isNumericString = (val) => {
    if (val === 0 || val === '0') return true;
    if (!val || typeof val !== 'string' || val.trim() === '') return false;
    const cleaned = val.replace(/[\s£$€,%]/g, '');
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) return true;
    return false;
};

const cleanIndicatorText = (raw) => {
    if (!raw) return 'Unknown';
    let c = raw.toLowerCase().replace(/actions:|offsite_conversion\.fb_pixel_|omni_/g, '').replace(/_/g, ' ');
    if (c.includes('purchase')) return 'Purchase';
    if (c.includes('view') || c.includes('landing page')) return 'Page View';
    if (c.includes('lead')) return 'Lead';
    if (c.includes('click')) return 'Click';
    if (c.includes('install')) return 'App Install';
    if (c.includes('message') || c.includes('messaging')) return 'Messaging';
    if (c.includes('post engagement') || c.includes('engagement')) return 'Engagement';
    if (c.includes('add to cart')) return 'Add To Cart';
    if (c.includes('initiate checkout')) return 'Checkout';
    if (c.includes('search')) return 'Search';
    return c.charAt(0).toUpperCase() + c.slice(1).trim();
};

const CANONICAL_ONTOLOGY = [
    { keys: ['roas', 'return on ad spend'], math: 'weighted_ratio', formula: { num: 'revenue', den: 'spend', mult: 1 }, unit: 'ratio' },
    { keys: ['cpm', 'cost per 1,000'], math: 'weighted_ratio', formula: { num: 'spend', den: 'impressions', mult: 1000 }, unit: 'currency' },
    { keys: ['cpc', 'cost per link click', 'cost per click'], math: 'weighted_ratio', formula: { num: 'spend', den: 'clicks', mult: 1 }, unit: 'currency' },
    { keys: ['cost per purchase', 'cpp'], math: 'weighted_ratio', formula: { num: 'spend', den: 'purchases', mult: 1 }, unit: 'currency' },
    { keys: ['cpa', 'cost per result', 'cost per lead', 'cost per landing page view'], math: 'weighted_ratio', formula: { num: 'spend', den: 'results', mult: 1 }, unit: 'currency' },
    { keys: ['ctr', 'click-through rate'], math: 'weighted_ratio', formula: { num: 'clicks', den: 'impressions', mult: 100 }, unit: 'percentage' },
    { keys: ['rate'], math: 'average', unit: 'percentage' }, 
    { keys: ['cost per'], math: 'average', unit: 'currency' }, 
    { keys: ['spend', 'amount spent'], math: 'sum', unit: 'currency' },
    { keys: ['impressions'], math: 'sum', unit: 'integer' },
    { keys: ['reach'], math: 'non_additive', unit: 'integer' },
    { keys: ['frequency'], math: 'non_additive', unit: 'float' },
    { keys: ['click'], math: 'sum', unit: 'integer' },
    { keys: ['results', 'purchases', 'leads', 'installs'], math: 'sum', unit: 'integer' },
    { keys: ['revenue', 'conversion value', 'purchase value'], math: 'sum', unit: 'currency' },
    { keys: ['plays', 'views', 'shares', 'saves'], math: 'sum', unit: 'integer' }
];

const resolveMetricDefinition = (headerLower) => {
    for (const def of CANONICAL_ONTOLOGY) {
        if (def.keys.some(k => headerLower.includes(k))) {
            return { aggregation: def.math, formula: def.formula || null, unit: def.unit, isNonAdditive: def.math === 'non_additive' };
        }
    }
    return { aggregation: 'sum', formula: null, unit: 'integer', isNonAdditive: false };
};

const isColumnDateOrSystem = (validRows, colIndex, headerName) => {
    const lowerH = headerName.toLowerCase();
    const systemKeywords = ['starts', 'ends', 'date', 'time', 'day', 'status', 'delivery', 'indicator', 'objective', 'budget', 'edit', 'created'];
    if (systemKeywords.some(k => lowerH.includes(k))) return true;

    let hasData = false;
    let allDates = true;

    for (let r=0; r < Math.min(validRows.length, 30); r++) {
        const v = validRows[r][colIndex]?.trim();
        if (v && v !== '-' && v !== '') {
            hasData = true;
            const isIso = /^\d{4}-\d{2}-\d{2}/.test(v);
            const isUkDate = /^\d{2}\/\d{2}\/\d{4}/.test(v);
            const isUsDate = /^\d{1,2}\/\d{1,2}\/\d{4}/.test(v);
            const isOngoing = v.toLowerCase() === 'ongoing';
            if (!isIso && !isUkDate && !isUsDate && !isOngoing) {
                allDates = false;
                break;
            }
        }
    }
    return hasData && allDates;
};

const parseMetaCSV = (csvText) => {
  const lines = parseCSV(csvText);
  if (lines.length < 2) throw new Error("File appears empty or invalid.");

  const headers = lines[0];
  const cleanHeaders = headers.map(h => h.trim().replace(/^\uFEFF/, '')); 
  const lowerHeaders = cleanHeaders.map(h => h.toLowerCase());

  const findCol = (aliases, excludes = []) => {
      for (const alias of aliases) {
          const idx = lowerHeaders.findIndex(h => h === alias);
          if (idx !== -1) return idx;
      }
      for (const alias of aliases) {
          const idx = lowerHeaders.findIndex(h => h.includes(alias) && !excludes.some(ex => h.includes(ex)));
          if (idx !== -1) return idx;
      }
      return -1;
  };

  const map = {
    date: findCol(['reporting starts', 'day', 'date']),
    dateEnd: findCol(['reporting ends', 'ends']),
    identifier: findCol(['ad name', 'ad set name', 'campaign name', 'ad', 'ad set', 'campaign']),
    spend: findCol(['amount spent', 'spend']),
    results: findCol(['results'], ['cost', 'rate', 'indicator']),
    purchases: findCol(['website purchases', 'purchases'], ['cost', 'value', 'roas', 'rate']),
    revenue: findCol(['conversion value', 'revenue', 'purchase roas', 'roas'], ['cost', 'rate']),
    impressions: findCol(['impressions'], ['cpm', 'cost', 'rate']),
    clicks: findCol(['link clicks', 'clicks'], ['cpc', 'cost', 'rate', 'ctr']),
    resultIndicator: findCol(['result indicator', 'optimization goal', 'objective']),
    delivery: findCol(['delivery', 'status'])
  };

  if (map.spend === -1) throw new Error("Could not detect an 'Amount spent' column. Please check your Meta export.");

  const validRows = [];
  for (let r = 1; r < lines.length; r++) {
      const cols = lines[r];
      if (cols.length < 3) continue; 
      
      const idVal = map.identifier !== -1 ? cols[map.identifier] : cols[0];
      if (!idVal || String(idVal).trim() === '' || /^(total|summary|all)/i.test(String(idVal).trim())) {
          continue; 
      }
      validRows.push(cols);
  }

  if (validRows.length === 0) throw new Error("No valid data rows found. Ensure the export is not just a summary.");

  const metricDefs = {};
  const dimensionDefs = {};

  cleanHeaders.forEach((h, i) => {
     if (isColumnDateOrSystem(validRows, i, h)) return; 

     let isNum = true;
     let hasData = false;
     
     for(let r = 0; r < Math.min(validRows.length, 30); r++) {
         const val = validRows[r][i];
         if (val && val.trim() !== '') {
             hasData = true;
             if (!isNumericString(val)) {
                 isNum = false;
                 break;
             }
         }
     }
     
     if (hasData) {
         if (isNum) {
             const def = resolveMetricDefinition(lowerHeaders[i]);
             metricDefs[h] = {
                 id: h, label: h, ...def,
                 compatibleDimensions: def.isNonAdditive ? ['campaign', 'adset', 'ad'] : 'all'
             };
         } else {
             dimensionDefs[h] = { id: h, label: h };
         }
     }
  });

  if (Object.keys(dimensionDefs).length === 0) {
      dimensionDefs[cleanHeaders[0]] = { id: cleanHeaders[0], label: cleanHeaders[0] };
  }

  const parsedData = [];
  let minStart = '9999-12-31';
  let maxEnd = '0000-01-01';

  for (const cols of validRows) {
    const primaryName = map.identifier !== -1 ? cols[map.identifier] : cols[0] || 'Unknown';
    
    let dateRaw = map.date !== -1 ? cols[map.date] : 'Unknown';
    let dateEndRaw = map.dateEnd !== -1 ? cols[map.dateEnd] : dateRaw;
    
    const normalizeDate = (d) => {
        if (!d || String(d).toLowerCase() === 'ongoing') return null;
        if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.substring(0, 10);
        if (/^\d{2}\/\d{2}\/\d{4}/.test(d)) {
            const parts = d.split('/');
            return `${parts[2]}-${parts[1]}-${parts[0]}`; 
        }
        if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(d)) {
            const parts = d.split('/');
            return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`; 
        }
        return null;
    };

    const dStart = normalizeDate(dateRaw);
    const dEnd = normalizeDate(dateEndRaw) || dStart;

    if (dStart && dStart < minStart) minStart = dStart;
    if (dEnd && dEnd > maxEnd) maxEnd = dEnd;

    const timelineDateKey = dStart || 'Unknown';

    const cleanIndicator = cleanIndicatorText(map.resultIndicator !== -1 ? cols[map.resultIndicator] : '');
    const deliveryStatus = map.delivery !== -1 && cols[map.delivery] ? String(cols[map.delivery]).toLowerCase() : '';

    const spend = sanitizeNumber(cols[map.spend]);
    const results = map.results !== -1 ? sanitizeNumber(cols[map.results]) : 0;
    
    let purchases = map.purchases !== -1 ? sanitizeNumber(cols[map.purchases]) : 0;
    if (cleanIndicator === 'Purchase' && results > 0) purchases = Math.max(purchases, results); 
    
    const isPurchaseGoal = cleanIndicator === 'Purchase' || purchases > 0;
    const purchaseCampSpend = isPurchaseGoal ? spend : 0;

    const clicks = map.clicks !== -1 ? sanitizeNumber(cols[map.clicks]) : 0;
    const impressions = map.impressions !== -1 ? sanitizeNumber(cols[map.impressions]) : 0;
    
    let revenue = 0;
    if (map.revenue !== -1) {
        const revRaw = sanitizeNumber(cols[map.revenue]);
        const isROASColumn = lowerHeaders[map.revenue].includes('roas') && !lowerHeaders[map.revenue].includes('value');
        revenue = isROASColumn ? (revRaw * spend) : revRaw;
    }

    const rowMetrics = {};
    const rowDimensions = {};
    
    cleanHeaders.forEach((h, idx) => {
        let v = cols[idx] || '';
        if (metricDefs[h]) {
            let numV = sanitizeNumber(v);
            if (metricDefs[h].rawMultiplier) numV = numV * metricDefs[h].rawMultiplier;
            rowMetrics[h] = numV;
        } else if (dimensionDefs[h]) {
            rowDimensions[h] = v;
        }
    });

    parsedData.push({
      dateRaw: timelineDateKey,
      campaign: primaryName,
      spend, results, purchases, purchaseCampSpend, revenue, clicks, impressions,
      resultIndicator: cleanIndicator,
      deliveryStatus,
      metrics: rowMetrics,
      dimensions: rowDimensions
    });
  }

  return {
      rows: parsedData,
      timeFrame: { 
          start: minStart !== '9999-12-31' ? formatToUKDate(minStart) : 'Unknown', 
          end: maxEnd !== '0000-01-01' ? formatToUKDate(maxEnd) : 'Unknown',
          startRaw: minStart !== '9999-12-31' ? minStart : '',
          endRaw: maxEnd !== '0000-01-01' ? maxEnd : ''
      },
      metricDefs,
      dimensionDefs
  };
};

// --- CORE DASHBOARD COMPONENT (OVERVIEW) ---

const MetaDashboard = ({ data }) => {
  const [sortConfig, setSortConfig] = useState({ key: 'spend', direction: 'desc' });
  const [granularity, setGranularity] = useState('daily');

  const { timeline, campaigns, kpis, insights } = useMemo(() => {
    if (!data.rows || data.rows.length === 0) return { timeline:[], campaigns:[], kpis:{}, insights:[] };

    const granularMap = {};
    const campMap = {};
    let totalSpend = 0, totalResults = 0, totalPurchases = 0, totalPurchaseCampSpend = 0;

    data.rows.forEach(row => {
        const isPurchaseGoal = row.resultIndicator === 'Purchase' || row.purchases > 0;

        if (row.dateRaw !== 'Unknown') {
            const granularDateRaw = getGranularDate(row.dateRaw, granularity);
            let formatDisplay = formatToUKDate(granularDateRaw);

            if (granularity === 'monthly') {
                const d = new Date(granularDateRaw);
                if (!isNaN(d)) formatDisplay = d.toLocaleString('en-GB', { month: 'short', year: 'numeric' });
            } else if (granularity === 'weekly') {
                const d = new Date(granularDateRaw);
                if (!isNaN(d)) formatDisplay = `Wk of ${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`;
            }

            if (!granularMap[granularDateRaw]) granularMap[granularDateRaw] = { date: granularDateRaw, dateFormatted: formatDisplay, spend: 0, purchases: 0, purchaseCampSpend: 0 };
            granularMap[granularDateRaw].spend += row.spend;
            granularMap[granularDateRaw].purchases += row.purchases;
            if (isPurchaseGoal) granularMap[granularDateRaw].purchaseCampSpend += row.spend;
        }

        if (!campMap[row.campaign]) {
            campMap[row.campaign] = { 
                name: row.campaign, spend: 0, revenue: 0, results: 0, purchases: 0, impressions: 0, clicks: 0, 
                indicators: new Set(), deliveryStatus: row.deliveryStatus 
            };
        }
        const camp = campMap[row.campaign];
        camp.spend += row.spend;
        camp.revenue += row.revenue;
        camp.results += row.results;
        camp.purchases += row.purchases;
        camp.impressions += row.impressions;
        camp.clicks += row.clicks;
        
        if (row.deliveryStatus && row.deliveryStatus !== '') camp.deliveryStatus = row.deliveryStatus;
        if (row.resultIndicator) camp.indicators.add(row.resultIndicator);

        totalSpend += row.spend;
        totalResults += row.results;
        totalPurchases += row.purchases;
        if (isPurchaseGoal) totalPurchaseCampSpend += row.spend;
    });

    const timelineArr = Object.values(granularMap).sort((a,b) => a.date.localeCompare(b.date)).map(d => ({
        ...d,
        cpa: d.purchases > 0 ? (d.purchaseCampSpend / d.purchases) : 0
    }));

    let campArr = Object.values(campMap).map(c => {
        const inds = Array.from(c.indicators).filter(Boolean);
        return {
            ...c,
            primaryIndicator: inds.length > 0 ? inds[0] : 'Unknown',
            hasMixedIndicators: inds.length > 1,
            roas: c.spend > 0 ? (c.revenue / c.spend) : 0,
            purchaseCpa: c.purchases > 0 ? (c.spend / c.purchases) : 0,
            ctr: c.impressions > 0 ? ((c.clicks / c.impressions) * 100) : 0
        };
    });

    campArr.sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];
        if (sortConfig.key === 'name' || sortConfig.key === 'primaryIndicator') {
            return sortConfig.direction === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
        }
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    const generatedInsights = [];
    
    // 1. Highest Spender
    const topSpender = [...campArr].sort((a, b) => b.spend - a.spend)[0];
    if (topSpender && topSpender.spend > 0) {
        generatedInsights.push({ 
            type: 'warning', 
            text: `Highest Spender: "${topSpender.name}" consumed the most budget (${formatValue(topSpender.spend, 'currency')}). Monitor closely to ensure it maintains a profitable return on ad spend.` 
        });
    }

    // 2. Most Volume
    const topVolume = [...campArr].sort((a, b) => b.results - a.results)[0];
    if (topVolume && topVolume.results > 0) {
        generatedInsights.push({ 
            type: 'success', 
            text: `Volume Leader: "${topVolume.name}" is driving the highest conversion volume (${formatValue(topVolume.results, 'integer')} results). Consider scaling this entity.` 
        });
    }

    // 3. Lowest CPA
    // Use entities with at least a few results to filter out single-click anomalies
    const cpaEligible = campArr.filter(c => c.purchases > 2 || c.results > 2);
    const fallbackEligible = campArr.filter(c => c.purchases > 0 || c.results > 0);
    const targetArray = cpaEligible.length > 0 ? cpaEligible : fallbackEligible;

    if (targetArray.length > 0) {
        const bestCpa = targetArray.sort((a, b) => {
            const cpaA = a.purchases > 0 ? a.purchaseCpa : (a.spend / a.results);
            const cpaB = b.purchases > 0 ? b.purchaseCpa : (b.spend / b.results);
            return cpaA - cpaB;
        })[0];
        
        const cpaVal = bestCpa.purchases > 0 ? bestCpa.purchaseCpa : (bestCpa.spend / bestCpa.results);
        generatedInsights.push({ 
            type: 'success', 
            text: `Efficiency Winner: "${bestCpa.name}" has the lowest CPA (${formatValue(cpaVal, 'currency')}). Shift budget from underperforming entities here to maximize your ROI.` 
        });
    }

    return {
        timeline: timelineArr,
        campaigns: campArr,
        kpis: { spend: totalSpend, results: totalResults, purchaseCpa: totalPurchases > 0 ? (totalPurchaseCampSpend / totalPurchases) : 0 },
        insights: generatedInsights
    };
  }, [data, sortConfig, granularity]);

  const handleSort = (key) => {
      let direction = 'desc';
      if (sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
      setSortConfig({ key, direction });
  };

  const TableHeader = ({ label, sortKey }) => (
      <th className="pb-4 font-bold cursor-pointer hover:text-white transition-colors select-none" onClick={() => handleSort(sortKey)}>
          <div className={`flex items-center gap-1.5 ${sortKey !== 'name' && sortKey !== 'primaryIndicator' ? 'justify-end' : ''}`}>
              {label}
              <div className="flex flex-col text-slate-600">
                  <ChevronUp size={10} className={sortConfig.key === sortKey && sortConfig.direction === 'asc' ? 'text-indigo-400' : ''} />
                  <ChevronDown size={10} className={`-mt-1 ${sortConfig.key === sortKey && sortConfig.direction === 'desc' ? 'text-indigo-400' : ''}`} />
              </div>
          </div>
      </th>
  );

  const CustomChartTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-[#0e0e12]/95 border border-white/10 p-4 rounded-xl shadow-2xl backdrop-blur-xl z-50 min-w-[200px]">
          <p className="text-slate-400 font-bold mb-3 pb-2 border-b border-white/5 text-[10px] uppercase tracking-widest">{label}</p>
          <div className="flex flex-col gap-2">
            {payload.map((entry, index) => {
               const unit = entry.name.toLowerCase().includes('cpa') || entry.name.toLowerCase().includes('spend') ? 'currency' : 'integer';
               return (
                  <div key={index} className="flex items-center justify-between text-sm gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color }}></div>
                        <span className="text-slate-300 capitalize">{entry.name}</span>
                    </div>
                    <span className="text-white font-mono font-bold">
                        {formatValue(entry.value, unit)}
                    </span>
                  </div>
               );
            })}
          </div>
        </div>
      );
    }
    return null;
  };

  const GranularityToggle = () => (
      <div className="flex bg-[#0e0e12] rounded-lg border border-white/10 overflow-hidden p-0.5">
           <button onClick={() => setGranularity('daily')} className={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold rounded-md transition-colors ${granularity === 'daily' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500 hover:text-white'}`}>Daily</button>
           <button onClick={() => setGranularity('weekly')} className={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold rounded-md transition-colors ${granularity === 'weekly' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500 hover:text-white'}`}>Weekly</button>
           <button onClick={() => setGranularity('monthly')} className={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold rounded-md transition-colors ${granularity === 'monthly' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500 hover:text-white'}`}>Monthly</button>
      </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KPICard title="Total Spend" value={formatValue(kpis.spend, 'currency')} icon={DollarSign} />
            <KPICard title="Total Results" value={formatValue(kpis.results, 'integer')} icon={Target} />
            <KPICard title="Blended Purchase CPA" value={formatValue(kpis.purchaseCpa, 'currency')} icon={MousePointerClick} />
        </div>

        <GlassCard className="w-full" title="Core Performance Timeline" icon={BarChart2} action={<GranularityToggle />}>
            <div style={{ height: '400px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={timeline} margin={{ top: 10, right: 0, left: -20, bottom: 65 }}>
                        <defs>
                            <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                        <XAxis dataKey="dateFormatted" stroke="#475569" tick={{fill: '#64748b', fontSize: 10}} axisLine={false} tickLine={false} minTickGap={20} angle={-35} textAnchor="end" height={60} />
                        <YAxis yAxisId="left" stroke="#818cf8" tick={{fill: '#64748b', fontSize: 10}} axisLine={false} tickLine={false} tickFormatter={(v) => formatYAxisTick(v, 'currency')} />
                        <YAxis yAxisId="right" orientation="right" stroke="#2dd4bf" tick={{fill: '#64748b', fontSize: 10}} axisLine={false} tickLine={false} tickFormatter={(v) => formatYAxisTick(v, 'currency')} />
                        <RechartsTooltip content={<CustomChartTooltip />} cursor={{fill: 'rgba(255,255,255,0.02)'}} />
                        <Legend wrapperStyle={{fontSize: '11px', paddingTop: '10px'}} iconType="circle" verticalAlign="top" />
                        
                        <Area yAxisId="left" type="monotone" dataKey="spend" name="Spend" stroke="#818cf8" strokeWidth={2} fill="url(#colorSpend)" dot={timeline.length === 1 ? { r: 5, fill: '#818cf8', strokeWidth: 0 } : false} />
                        <Line yAxisId="right" type="monotone" dataKey="cpa" name="Purchase CPA" stroke="#2dd4bf" strokeWidth={3} dot={timeline.length === 1 ? { r: 5, fill: '#2dd4bf', strokeWidth: 0 } : false} activeDot={{r: 5, fill: '#2dd4bf', stroke: '#0e0e12', strokeWidth: 2}} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </GlassCard>

        <GlassCard className="w-full" title="Engine Insights" icon={Sparkles}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
                {insights.map((insight, idx) => (
                    <div key={idx} className="p-4 rounded-xl bg-white/[0.03] border border-white/5 flex gap-3 group hover:bg-white/[0.05] transition-colors">
                        <div className="pt-0.5 shrink-0">
                            {insight.type === 'warning' && <AlertCircle size={16} className="text-amber-400" />}
                            {insight.type === 'success' && <TrendingUp size={16} className="text-emerald-400" />}
                            {insight.type === 'alert' && <AlertCircle size={16} className="text-rose-400" />}
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed font-medium">
                            {insight.text}
                        </p>
                    </div>
                ))}
                {insights.length === 0 && (
                    <div className="col-span-3 flex flex-col items-center justify-center text-slate-500 opacity-50 py-8">
                        <CheckCircle size={32} className="mb-2" />
                        <span className="text-sm">Metrics are stable.</span>
                    </div>
                )}
            </div>
        </GlassCard>

        <GlassCard title="Segment Explorer" icon={ListOrdered}>
            <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                        <tr className="border-b border-white/10 text-[10px] uppercase tracking-widest text-slate-500">
                            <TableHeader label="Identifier Name" sortKey="name" />
                            <TableHeader label="Goal" sortKey="primaryIndicator" />
                            <TableHeader label="Spend" sortKey="spend" />
                            <TableHeader label="Results" sortKey="results" />
                            <TableHeader label="Purchases" sortKey="purchases" />
                            <TableHeader label="Pur. CPA" sortKey="purchaseCpa" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                        {campaigns.map((camp, i) => (
                            <tr key={i} className="group hover:bg-white/[0.02] transition-colors">
                                <td className="py-4 text-sm font-medium text-slate-200">
                                    <div className="flex items-center gap-3">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500/50 group-hover:bg-indigo-400 transition-colors shrink-0"></div>
                                        <div className="flex flex-col md:flex-row md:items-center gap-2">
                                            <span className="truncate max-w-[280px] block" title={camp.name}>{camp.name}</span>
                                            {camp.deliveryStatus && (
                                                <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 w-max ${camp.deliveryStatus.includes('active') && !camp.deliveryStatus.includes('inactive') ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-500/20 text-slate-400'}`}>
                                                    {camp.deliveryStatus.replace(/_/g, ' ')}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </td>
                                
                                <td className="py-4 text-sm text-left">
                                    <div className="flex flex-col gap-1">
                                        <span className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded tracking-widest uppercase w-max ${camp.primaryIndicator === 'Purchase' ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-300' : 'bg-amber-500/10 border border-amber-500/20 text-amber-300'}`}>
                                            {camp.primaryIndicator === 'Purchase' ? <Target size={10} /> : <Info size={10} />}
                                            {camp.primaryIndicator}
                                        </span>
                                        {camp.hasMixedIndicators && (
                                             <span className="text-[9px] bg-slate-500/10 border border-slate-500/20 text-slate-400 px-1.5 py-0.5 rounded tracking-widest uppercase w-max" title="Multiple conversion types detected">
                                                Mixed Goals
                                             </span>
                                        )}
                                    </div>
                                </td>

                                <td className="py-4 text-sm text-right font-mono text-slate-300">{formatValue(camp.spend, 'currency')}</td>
                                <td className="py-4 text-sm text-right font-mono text-slate-400">{formatValue(camp.results, 'integer')}</td>
                                <td className="py-4 text-sm text-right font-mono text-white font-bold">{formatValue(camp.purchases, 'integer')}</td>
                                <td className="py-4 text-sm text-right font-mono text-slate-300">{formatValue(camp.purchaseCpa, 'currency')}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </GlassCard>
    </div>
  );
};

// --- COMPATIBILITY GATEKEEPER HOOK ---
const useExplorerOptions = (metricDefs, dimensionDefs) => {
    const dimKeys = useMemo(() => Object.keys(dimensionDefs).sort(), [dimensionDefs]);
    const metKeys = useMemo(() => Object.keys(metricDefs).sort(), [metricDefs]);
    
    const [selectedDim, setSelectedDim] = useState('');
    const [selectedMetric, setSelectedMetric] = useState('');

    const availableMetrics = useMemo(() => {
        if (!selectedDim) return metKeys;
        const isDemographic = selectedDim.toLowerCase().includes('age') || selectedDim.toLowerCase().includes('gender') || selectedDim.toLowerCase().includes('country');
        
        return metKeys.filter(mKey => {
            const mDef = metricDefs[mKey];
            if (!mDef) return false;
            if (mDef.compatibleDimensions === 'all') return true;
            if (mDef.isNonAdditive && isDemographic) return false;
            return true;
        });
    }, [selectedDim, metricDefs, metKeys]);

    useEffect(() => {
        if (dimKeys.length > 0 && (!selectedDim || !dimKeys.includes(selectedDim))) setSelectedDim(dimKeys[0]);
    }, [dimKeys, selectedDim]);

    useEffect(() => {
        if (availableMetrics.length > 0 && (!selectedMetric || !availableMetrics.includes(selectedMetric))) setSelectedMetric(availableMetrics[0]);
    }, [availableMetrics, selectedMetric]);

    const handleDimChange = (newDim) => setSelectedDim(newDim);

    return { selectedDim, handleDimChange, selectedMetric, setSelectedMetric, availableMetrics, dimKeys };
};

// --- DEEP DIVE DASHBOARD COMPONENT ---

const DeepDiveDashboard = ({ data }) => {
  const { selectedDim, handleDimChange, selectedMetric, setSelectedMetric, availableMetrics, dimKeys } = useExplorerOptions(data.metricDefs, data.dimensionDefs);
  const [viewMode, setViewMode] = useState('explorer'); 
  const [chartType, setChartType] = useState('line'); 
  
  // Date and Granularity Controls
  const [dateRange, setDateRange] = useState({ start: data.timeFrame.startRaw, end: data.timeFrame.endRaw });
  const [granularity, setGranularity] = useState('daily');

  useEffect(() => {
      setDateRange({ start: data.timeFrame.startRaw, end: data.timeFrame.endRaw });
  }, [data.timeFrame.startRaw, data.timeFrame.endRaw]);
  
  const availableItemsForDim = useMemo(() => {
      if (!selectedDim) return [];
      const items = new Set();
      data.rows.forEach(r => {
          const val = r.dimensions[selectedDim];
          if (val !== undefined && val !== null && String(val).trim() !== '') items.add(String(val).trim());
      });
      return Array.from(items).sort();
  }, [data.rows, selectedDim]);

  const [compareEntities, setCompareEntities] = useState(['', '', '']);
  const [compareMetrics, setCompareMetrics] = useState(['', '', '']);

  useEffect(() => {
      if (availableItemsForDim.length > 0) {
          setCompareEntities([
              availableItemsForDim[0], 
              availableItemsForDim.length > 1 ? availableItemsForDim[1] : '',
              availableItemsForDim.length > 2 ? availableItemsForDim[2] : ''
          ]);
      } else {
          setCompareEntities(['', '', '']);
      }
  }, [availableItemsForDim]);

  useEffect(() => {
      if (availableMetrics.length > 0) {
          setCompareMetrics([
              availableMetrics[0],
              availableMetrics.length > 1 ? availableMetrics[1] : '',
              availableMetrics.length > 2 ? availableMetrics[2] : ''
          ]);
      } else {
          setCompareMetrics(['', '', '']);
      }
  }, [availableMetrics]);

  const updateCompareEntity = (idx, value) => {
      const updated = [...compareEntities];
      updated[idx] = value;
      setCompareEntities(updated);
  };

  const updateCompareMetric = (idx, value) => {
      const updated = [...compareMetrics];
      updated[idx] = value;
      setCompareMetrics(updated);
  };

  const activeMetricDef = data.metricDefs[selectedMetric] || { unit: 'integer', aggregation: 'SUM' };

  const breakdownData = useMemo(() => {
      if (viewMode !== 'explorer' || !selectedDim) return [];
      const dimMap = {};

      data.rows.forEach(row => {
          if (row.dateRaw !== 'Unknown') {
              if (dateRange.start && row.dateRaw < dateRange.start) return;
              if (dateRange.end && row.dateRaw > dateRange.end) return;
          }

          const key = String(row.dimensions[selectedDim] || 'Unknown/Blank').trim();
          if (!dimMap[key]) {
              dimMap[key] = { name: key, rawValue: 0, spend: 0, clicks: 0, impressions: 0, revenue: 0, results: 0, purchases: 0, purchaseCampSpend: 0, rowCount: 0 };
          }
          
          dimMap[key].rawValue += row.metrics[selectedMetric] || 0;
          dimMap[key].spend += row.spend || 0;
          dimMap[key].clicks += row.clicks || 0;
          dimMap[key].impressions += row.impressions || 0;
          dimMap[key].revenue += row.revenue || 0;
          dimMap[key].results += row.results || 0;
          dimMap[key].purchases += row.purchases || 0;
          dimMap[key].purchaseCampSpend += row.purchaseCampSpend || 0;
          dimMap[key].rowCount += 1;
      });

      return Object.values(dimMap).map(d => {
          let finalValue = d.rawValue;
          let isInvalidNonAdditive = false;

          if (activeMetricDef.aggregation === 'WEIGHTED_RATIO' && activeMetricDef.formula) {
              const { num, den, mult = 1 } = activeMetricDef.formula;
              const nVal = d[num];
              const dVal = d[den];
              finalValue = (dVal && dVal > 0) ? (nVal / dVal) * mult : 0;
          } else if (activeMetricDef.aggregation === 'AVERAGE') {
              finalValue = d.rowCount > 0 ? (d.rawValue / d.rowCount) : 0;
          } else if (activeMetricDef.aggregation === 'NON_ADDITIVE' && d.rowCount > 1) {
              isInvalidNonAdditive = true;
              finalValue = 0; 
          }

          return { name: d.name, value: finalValue, isInvalidNonAdditive };
      }).sort((a,b) => b.value - a.value).slice(0, 15);
  }, [data.rows, selectedDim, selectedMetric, viewMode, activeMetricDef, dateRange]);

  const activeCompareEntities = compareEntities.filter(Boolean);
  const activeCompareMetrics = compareMetrics.filter(Boolean);

  const compareTimelineData = useMemo(() => {
      if (viewMode !== 'compare' || !selectedDim) return [];
      const dateMap = {};

      data.rows.forEach(row => {
          if (row.dateRaw === 'Unknown') return;
          if (dateRange.start && row.dateRaw < dateRange.start) return;
          if (dateRange.end && row.dateRaw > dateRange.end) return;

          const key = String(row.dimensions[selectedDim] || '').trim();
          if (!activeCompareEntities.includes(key)) return;
          
          const granularDateRaw = getGranularDate(row.dateRaw, granularity);
          let formatDisplay = formatToUKDate(granularDateRaw);
          
          if (granularity === 'monthly') {
              const d = new Date(granularDateRaw);
              if (!isNaN(d)) formatDisplay = d.toLocaleString('en-GB', { month: 'short', year: 'numeric' });
          } else if (granularity === 'weekly') {
              const d = new Date(granularDateRaw);
              if (!isNaN(d)) formatDisplay = `Wk of ${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`;
          }
          
          const dateKey = granularDateRaw;

          if (!dateMap[dateKey]) {
              dateMap[dateKey] = { dateRaw: dateKey, dateFormatted: formatDisplay };
              activeCompareEntities.forEach(ent => {
                 dateMap[dateKey][ent] = { rowCount: 0, rawValues: {}, spend: 0, clicks: 0, impressions: 0, revenue: 0, results: 0, purchases: 0, purchaseCampSpend: 0 };
              });
          }

          const entData = dateMap[dateKey][key];
          entData.rowCount += 1;
          entData.spend += row.spend || 0;
          entData.clicks += row.clicks || 0;
          entData.impressions += row.impressions || 0;
          entData.revenue += row.revenue || 0;
          entData.results += row.results || 0;
          entData.purchases += row.purchases || 0;
          entData.purchaseCampSpend += row.purchaseCampSpend || 0;

          activeCompareMetrics.forEach(mKey => {
              if (!entData.rawValues[mKey]) entData.rawValues[mKey] = 0;
              entData.rawValues[mKey] += row.metrics[mKey] || 0;
          });
      });

      return Object.values(dateMap).sort((a,b) => a.dateRaw.localeCompare(b.dateRaw)).map(d => {
          const out = { dateFormatted: d.dateFormatted };

          activeCompareEntities.forEach(ent => {
              const entData = d[ent];
              activeCompareMetrics.forEach(mKey => {
                  const mDef = data.metricDefs[mKey] || { aggregation: 'SUM' };
                  let val = entData ? (entData.rawValues[mKey] || 0) : 0;
                  let invalid = false;

                  if (entData) {
                      if (mDef.aggregation === 'WEIGHTED_RATIO' && mDef.formula) {
                          const { num, den, mult = 1 } = mDef.formula;
                          const nVal = entData[num];
                          const dVal = entData[den];
                          val = (dVal && dVal > 0) ? (nVal / dVal) * mult : 0;
                      } else if (mDef.aggregation === 'AVERAGE') {
                          val = entData.rowCount > 0 ? (entData.rawValues[mKey] / entData.rowCount) : 0;
                      } else if (mDef.aggregation === 'NON_ADDITIVE' && entData.rowCount > 1) {
                          val = 0;
                          invalid = true;
                      }
                  }

                  out[`${ent}|${mKey}`] = val;
                  out[`${ent}|${mKey}_invalid`] = invalid;
              });
          });
          return out;
      });
  }, [data.rows, selectedDim, viewMode, activeCompareEntities, activeCompareMetrics, data.metricDefs, dateRange, granularity]);

  const BreakdownTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const point = payload[0].payload;
      return (
        <div className="bg-[#0e0e12]/95 border border-white/10 p-4 rounded-xl shadow-2xl backdrop-blur-xl z-50 min-w-[200px]">
          <p className="text-slate-400 font-bold mb-3 pb-2 border-b border-white/5 text-[10px] uppercase tracking-widest">
            {selectedDim}: <span className="text-white normal-case text-sm ml-1">{label}</span>
          </p>
          <div className="flex items-center justify-between text-sm gap-6 mt-1">
            <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: payload[0].color }}></div>
                <span className="text-slate-300 capitalize">{selectedMetric}</span>
            </div>
            {point.isInvalidNonAdditive ? (
                <span className="text-amber-400 font-mono font-bold flex items-center gap-1">
                    <AlertCircle size={12}/> N/A (Non-Additive)
                </span>
            ) : (
                <span className="text-white font-mono font-bold">
                    {formatValue(point.value, activeMetricDef.unit)}
                </span>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  const CompareTooltip = ({ active, payload, label }) => {
      if (active && payload && payload.length) {
        return (
          <div className="bg-[#0e0e12]/95 border border-white/10 p-4 rounded-xl shadow-2xl backdrop-blur-xl z-50 min-w-[250px]">
            <p className="text-slate-400 font-bold mb-3 pb-2 border-b border-white/5 text-[10px] uppercase tracking-widest">{label}</p>
            <div className="flex flex-col gap-3">
              {payload.map((entry, index) => {
                  const [ent, mKey] = entry.dataKey.split('|');
                  const mDef = data.metricDefs[mKey] || { unit: 'float' };
                  const isInvalid = entry.payload[`${entry.dataKey}_invalid`];

                  return (
                    <div key={index} className="flex items-center justify-between text-sm gap-6">
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }}></div>
                            <span className="text-slate-300 capitalize truncate max-w-[180px]" title={`${ent} (${mKey})`}>
                                <span className="font-semibold text-white">{ent}</span>
                                <span className="text-slate-500 text-[10px] ml-1.5 uppercase tracking-wide">({mKey})</span>
                            </span>
                        </div>
                        {isInvalid ? (
                            <span className="text-amber-400 font-mono font-bold text-xs shrink-0"><AlertCircle size={10} className="inline"/> N/A</span>
                        ) : (
                            <span className="text-white font-mono font-bold shrink-0">{formatValue(entry.value, mDef.unit)}</span>
                        )}
                    </div>
                  );
              })}
            </div>
          </div>
        );
      }
      return null;
  };

  const primaryCompareMetricDef = data.metricDefs[activeCompareMetrics[0]] || { unit: 'integer' };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
        
        {/* Deep Dive Toolbar */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-white/[0.02] p-4 rounded-2xl border border-white/5 shadow-xl">
            
            <div className="flex bg-[#0e0e12] p-1.5 rounded-xl border border-white/10 w-max">
                <button onClick={() => setViewMode('explorer')} className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'explorer' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-white'}`}>
                    <Search size={16} /> Semantic Explorer
                </button>
                <button onClick={() => setViewMode('compare')} className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'compare' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-white'}`}>
                    <ArrowRightLeft size={16} /> Advanced Compare
                </button>
            </div>

            <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1.5 block">Analysis Period</label>
                    <div className="flex items-center gap-2">
                        <input type="date" value={dateRange.start} min={data.timeFrame.startRaw} max={data.timeFrame.endRaw} onChange={e => setDateRange(prev => ({...prev, start: e.target.value}))} className="bg-[#0e0e12] border border-white/10 text-slate-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500/50 [color-scheme:dark]" />
                        <span className="text-slate-600">-</span>
                        <input type="date" value={dateRange.end} min={data.timeFrame.startRaw} max={data.timeFrame.endRaw} onChange={e => setDateRange(prev => ({...prev, end: e.target.value}))} className="bg-[#0e0e12] border border-white/10 text-slate-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500/50 [color-scheme:dark]" />
                    </div>
                </div>

                {viewMode === 'compare' && (
                    <div>
                         <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1.5 block">Time Granularity</label>
                         <div className="flex bg-[#0e0e12] rounded-lg border border-white/10 overflow-hidden p-0.5">
                             <button onClick={() => setGranularity('daily')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${granularity === 'daily' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-white'}`}>Daily</button>
                             <button onClick={() => setGranularity('weekly')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${granularity === 'weekly' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-white'}`}>Weekly</button>
                             <button onClick={() => setGranularity('monthly')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${granularity === 'monthly' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-white'}`}>Monthly</button>
                         </div>
                    </div>
                )}
            </div>
        </div>

        <GlassCard className="flex flex-col" title={viewMode === 'explorer' ? "Semantic Breakdown Explorer" : "Head-to-Head Comparison Engine"}>
            
            {/* Visualizer Configuration */}
            <div className="shrink-0 mb-6 relative z-20">
                {viewMode === 'explorer' ? (
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-1">
                            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2 block">Dimension Context</label>
                            <select value={selectedDim} onChange={(e) => handleDimChange(e.target.value)} className="w-full bg-[#0e0e12] border border-white/10 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500/50 appearance-none capitalize">
                                {dimKeys.map(d => (<option key={d} value={d}>{d}</option>))}
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2 flex items-center justify-between">
                                Analyse Metric
                                <div className="flex items-center gap-1 bg-[#0e0e12] rounded-md border border-white/5 overflow-hidden">
                                    <button onClick={() => setChartType('line')} className={`p-1.5 transition-colors ${chartType === 'line' ? 'bg-indigo-500/20 text-indigo-400' : 'hover:bg-white/5'}`}><LineChartIcon size={14}/></button>
                                    <button onClick={() => setChartType('scatter')} className={`p-1.5 transition-colors ${chartType === 'scatter' ? 'bg-indigo-500/20 text-indigo-400' : 'hover:bg-white/5'}`}><ScatterChartIcon size={14}/></button>
                                    <button onClick={() => setChartType('bar')} className={`p-1.5 transition-colors ${chartType === 'bar' ? 'bg-indigo-500/20 text-indigo-400' : 'hover:bg-white/5'}`}><BarChart3 size={14}/></button>
                                </div>
                            </label>
                            <select value={selectedMetric} onChange={(e) => setSelectedMetric(e.target.value)} className="w-full bg-[#0e0e12] border border-white/10 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-500/50 appearance-none capitalize">
                                {availableMetrics.map(m => (
                                    <option key={m} value={m}>{m} {data.metricDefs[m]?.isNonAdditive ? '(Non-Additive)' : ''}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4 bg-white/[0.02] p-4 rounded-xl border border-white/5">
                        <div className="w-full">
                            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2 block">Shared Comparison Dimension</label>
                            <select value={selectedDim} onChange={(e) => handleDimChange(e.target.value)} className="w-full bg-[#0e0e12] border border-white/10 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500/50 appearance-none capitalize">
                                {dimKeys.map(d => (<option key={d} value={d}>{d}</option>))}
                            </select>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {[0, 1, 2].map(idx => (
                                <div key={`ent-${idx}`}>
                                    <label className="text-[10px] uppercase tracking-widest text-white font-bold mb-2 flex items-center">
                                        <div className="w-1.5 h-1.5 rounded-full mr-2" style={{ backgroundColor: ENTITY_COLORS[idx] }}></div>
                                        Entity {idx + 1}
                                    </label>
                                    <select value={compareEntities[idx]} onChange={(e) => updateCompareEntity(idx, e.target.value)} className="w-full bg-[#0e0e12] border border-white/10 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500/50 appearance-none">
                                        <option value="">-- None --</option>
                                        {availableItemsForDim.map(item => (<option key={`ent-${idx}-${item}`} value={item}>{item}</option>))}
                                    </select>
                                </div>
                            ))}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {[0, 1, 2].map(idx => (
                                <div key={`met-${idx}`}>
                                    <label className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-2 flex items-center">
                                        <svg width="16" height="4" className="mr-2 shrink-0">
                                             <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray={METRIC_DASHES[idx]} />
                                        </svg>
                                        Metric {idx + 1}
                                    </label>
                                    <select value={compareMetrics[idx]} onChange={(e) => updateCompareMetric(idx, e.target.value)} className="w-full bg-[#0e0e12] border border-white/10 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-500/50 appearance-none capitalize">
                                        <option value="">-- None --</option>
                                        {availableMetrics.map(m => (<option key={`met-${idx}-${m}`} value={m}>{m}</option>))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Rendering Engine */}
            <div style={{ height: '550px', width: '100%', paddingBottom: '20px' }}>
                {viewMode === 'explorer' ? (
                    <ResponsiveContainer width="100%" height="100%">
                        {chartType === 'line' ? (
                            <LineChart data={breakdownData} margin={{ top: 10, right: 30, left: 10, bottom: 130 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                                <XAxis dataKey="name" stroke="#475569" tick={{fill: '#94a3b8', fontSize: 10}} axisLine={false} tickLine={false} minTickGap={10} angle={-45} textAnchor="end" height={120} tickFormatter={(val) => val.length > 30 ? val.substring(0,30)+'...' : val} />
                                <YAxis stroke="#475569" tick={{fill: '#64748b', fontSize: 10}} axisLine={false} tickLine={false} tickFormatter={(v) => formatYAxisTick(v, activeMetricDef.unit)} />
                                <RechartsTooltip content={<BreakdownTooltip />} cursor={{fill: 'rgba(255,255,255,0.02)'}} />
                                <Line type="monotone" dataKey="value" name={selectedMetric} stroke="#818cf8" strokeWidth={3} dot={breakdownData.length === 1 ? {r: 5, fill: '#818cf8', strokeWidth: 0} : {r: 3, fill: '#818cf8', strokeWidth: 0}} activeDot={{r: 5, fill: '#818cf8', stroke: '#0e0e12', strokeWidth: 2}} />
                            </LineChart>
                        ) : chartType === 'scatter' ? (
                            <ScatterChart margin={{ top: 10, right: 30, left: 10, bottom: 130 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                                <XAxis type="category" dataKey="name" name="Entity" stroke="#475569" tick={{fill: '#94a3b8', fontSize: 10}} angle={-45} textAnchor="end" height={120} tickFormatter={(val) => val.length > 30 ? val.substring(0,30)+'...' : val} />
                                <YAxis type="number" dataKey="value" name={selectedMetric} stroke="#475569" tick={{fill: '#64748b', fontSize: 10}} axisLine={false} tickLine={false} tickFormatter={(v) => formatYAxisTick(v, activeMetricDef.unit)} />
                                <RechartsTooltip cursor={{strokeDasharray: '3 3'}} content={<BreakdownTooltip />} />
                                <Scatter name={selectedMetric} data={breakdownData} fill="#818cf8">
                                    {breakdownData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.isInvalidNonAdditive ? 'rgba(255,255,255,0.05)' : `hsl(238, 80%, ${70 - (index * 1.5)}%)`} />
                                    ))}
                                </Scatter>
                            </ScatterChart>
                        ) : (
                            <BarChart data={breakdownData} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }} barCategoryGap="20%">
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" horizontal={true} vertical={false} />
                                <XAxis type="number" stroke="#475569" tick={{fill: '#64748b', fontSize: 10}} axisLine={false} tickLine={false} tickFormatter={(v) => formatYAxisTick(v, activeMetricDef.unit)} />
                                <YAxis type="category" dataKey="name" width={280} stroke="#475569" tick={{fill: '#94a3b8', fontSize: 11}} axisLine={false} tickLine={false} tickFormatter={(val) => val.length > 40 ? val.substring(0,40)+'...' : val} />
                                <RechartsTooltip cursor={{fill: 'rgba(255,255,255,0.02)'}} content={<BreakdownTooltip />} />
                                <Bar dataKey="value" name={selectedMetric} radius={[0, 4, 4, 0]}>
                                    {breakdownData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.isInvalidNonAdditive ? 'rgba(255,255,255,0.05)' : `hsl(238, 80%, ${70 - (index * 1.5)}%)`} />
                                    ))}
                                </Bar>
                            </BarChart>
                        )}
                    </ResponsiveContainer>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={compareTimelineData} margin={{ top: 10, right: 10, left: -20, bottom: 130 }} key={compareMetrics.join('-')}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                            <XAxis dataKey="dateFormatted" stroke="#475569" tick={{fill: '#64748b', fontSize: 10}} axisLine={false} tickLine={false} minTickGap={20} angle={-45} textAnchor="end" height={120} />
                            <YAxis stroke="#475569" tick={{fill: '#64748b', fontSize: 10}} axisLine={false} tickLine={false} tickFormatter={(v) => formatYAxisTick(v, primaryCompareMetricDef.unit)} />
                            <RechartsTooltip content={<CompareTooltip />} cursor={{fill: 'rgba(255,255,255,0.02)'}} />
                            <Legend wrapperStyle={{fontSize: '11px', paddingTop: '10px'}} iconType="circle" />
                            
                            {activeCompareEntities.map((ent, eIdx) => 
                                activeCompareMetrics.map((mKey, mIdx) => {
                                    const dataKey = `${ent}|${mKey}`;
                                    const color = ENTITY_COLORS[eIdx % 3];
                                    const dashStyle = METRIC_DASHES[mIdx % 3];
                                    return (
                                        <Line 
                                            key={dataKey}
                                            type="monotone" 
                                            dataKey={dataKey} 
                                            name={`${ent} (${mKey})`} 
                                            stroke={color} 
                                            strokeWidth={2} 
                                            strokeDasharray={dashStyle}
                                            dot={compareTimelineData.length === 1 ? {r: 4, fill: color, strokeWidth: 0} : {r: 1.5, fill: color, strokeWidth: 0}} 
                                            activeDot={{r: 4, fill: color, stroke: '#0e0e12', strokeWidth: 2}} 
                                        />
                                    );
                                })
                            )}
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>
        </GlassCard>
    </div>
  );
};

// --- APP SHELL & NAVIGATION ---

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsProcessing(true);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = parseMetaCSV(event.target.result);
        setData(parsed);
        setError(null);
        setActiveTab('overview');
      } catch (err) {
        setError(err.message || "Failed to parse CSV. Ensure it is a valid Meta Ads export.");
      }
      setIsProcessing(false);
    };
    reader.readAsText(file);
  };

  const NavItem = ({ id, label, icon: Icon }) => (
    <button 
        onClick={() => { if(data) setActiveTab(id); }}
        disabled={!data}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-sm
        ${data && activeTab === id ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 
          data ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-600 cursor-not-allowed'}`}
    >
        <Icon size={18} /> {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#050507] text-slate-200 font-sans selection:bg-indigo-500/30 overflow-hidden flex flex-col md:flex-row">
      
      {/* Background Ambience */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] h-[70vw] w-[70vw] rounded-full bg-indigo-900/10 blur-[120px] mix-blend-screen" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[60vw] w-[60vw] rounded-full bg-cyan-900/10 blur-[120px] mix-blend-screen" />
      </div>

      {/* Sidebar Navigation */}
      <aside className="relative z-50 w-full md:w-64 bg-[#0a0a0c]/80 backdrop-blur-2xl border-r border-white/5 flex flex-col shrink-0">
          <div className="p-6 border-b border-white/5 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.4)]">
                  <Activity size={18} className="text-white" />
              </div>
              <div>
                  <h1 className="font-bold text-white tracking-wide">Meta<span className="font-light">Vision</span></h1>
              </div>
          </div>
          
          <nav className="flex-1 p-4 space-y-2">
              <div className="px-4 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Platform</div>
              <NavItem id="overview" label="Overview" icon={LayoutDashboard} />
              <NavItem id="deepdive" label="Deep Dive" icon={Search} />
          </nav>

          {data && (
              <div className="p-4 border-t border-white/5">
                  <button 
                      onClick={() => setData(null)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors border border-white/5"
                  >
                      <RefreshCw size={16} /> New Export
                  </button>
              </div>
          )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 relative z-10 h-screen overflow-y-auto custom-scrollbar">
          
          {/* Header */}
          <header className="px-6 py-8 md:px-10 md:py-10 max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-white/[0.02]">
             <div>
                 <h2 className="text-3xl font-light text-white mb-2 tracking-tight">
                     Ads <span className="font-bold">Intelligence</span>
                 </h2>
                 <p className="text-slate-400 text-sm font-medium">
                     Semantic parsing engine. Zero latency. Infinite clarity.
                 </p>
             </div>
             {data && (
                 <div className="flex flex-col items-end gap-2">
                     <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-widest">
                         <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
                         Live View
                     </div>
                     <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono bg-white/[0.02] px-3 py-1.5 rounded-lg border border-white/5">
                        <Calendar size={12} className="text-indigo-400" />
                        {data.timeFrame.start} <span className="mx-1">→</span> {data.timeFrame.end}
                     </div>
                 </div>
             )}
          </header>

          <div className="px-6 py-8 md:px-10 max-w-7xl mx-auto pb-24">
             {!data ? (
                <div className="max-w-2xl mx-auto mt-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
                    <GlassCard className="p-12 text-center border-dashed border-2 hover:border-indigo-500/40 hover:bg-[#0e0e12]/80 group">
                        <label className="cursor-pointer flex flex-col items-center">
                            <div className="w-24 h-24 rounded-3xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 mb-6 group-hover:scale-110 group-hover:bg-indigo-500/20 transition-all shadow-[0_0_40px_rgba(99,102,241,0.1)]">
                                {isProcessing ? <RefreshCw className="animate-spin" size={32} /> : <Upload size={32} />}
                            </div>
                            <h3 className="text-2xl font-bold text-white mb-2">Upload Meta CSV</h3>
                            <p className="text-slate-400 text-sm max-w-sm">
                                Drag and drop your exported Campaign, Ad Set, or Ad report from Ads Manager.
                            </p>
                            <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                        </label>
                    </GlassCard>

                    {error && (
                        <div className="mt-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center gap-3 text-rose-200 text-sm animate-in slide-in-from-top-2">
                            <AlertCircle size={18} className="shrink-0" /> {error}
                        </div>
                    )}
                </div>
             ) : (
                <>
                   {activeTab === 'overview' && <MetaDashboard data={data} />}
                   {activeTab === 'deepdive' && <DeepDiveDashboard data={data} />}
                </>
             )}
          </div>
      </main>
