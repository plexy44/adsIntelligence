# MetaVision

**A decision engine for Meta Ads exports. Drop in a CSV, get a judgement on every campaign, ad set or ad, with the reasoning shown.**

**[Open the app →](https://sementra.netlify.app/)**

No account, no login, no API connection. Everything runs in the browser tab.

---

## What it does

Ads Manager shows you numbers. This tells you what to do about them, and refuses to tell you when the data cannot support an answer.

Load any csv export from Ads Manager and it will:

- **Judge every entity** against a cost target you set, with the reasoning attached to each verdict
- **Rank findings by money at stake**, so the list sorts itself by what matters rather than what is loudest
- **Diagnose *why* something is expensive** by decomposing cost into auction price, click-through rate and post-click conversion, then naming the stage that is actually at fault
- **Say when it does not know.** A cost figure resting on three conversions is noise, and the app labels it as such rather than dressing it up as a finding
- **Reconcile its own arithmetic** against the account total Meta states inside the file

### The verdicts

| Verdict | Meaning |
|---|---|
| **Scale** | Beating target with enough data to trust |
| **Keep** | At or under target, leave it alone |
| **Watch** | Slightly over target, monitor rather than act |
| **Fix** | Over target with an identifiable cause worth addressing first |
| **Cut** | Well over target with enough data to be confident |
| **Underfunded** | Efficient but funded far below your other winners |
| **No read** | Too few conversions for the cost figure to mean anything |
| **Restart** | Beat target while it ran, but is switched off now |
| **Already off** | Not delivering, so there is nothing left to stop |

The last two exist because most rows in a mature export are entities that stopped months ago. Telling you to pause something already paused is noise, and an efficient creative that got switched off is an opportunity nobody surfaces.

---

## Why CSV rather than an API connection

Every comparable tool needs OAuth into the ad account. That means a data processing agreement, a sub-processor addendum, and in regulated sectors a security review that can take months.

This needs a file and a browser tab. Which makes it the only option when:

- you are auditing an account you do not have access to yet, such as a pitch or a prospect
- the client will send a CSV but will not grant API access
- procurement will not approve another data processor

**Nothing is uploaded.** Parsing, aggregation, statistics, verdicts and PDF export all run locally in JavaScript. Files are cached in IndexedDB so they survive a refresh, and clearing site data removes them completely.

---

## Getting a good export

Ads Manager's default column set omits things the analysis needs. In the export dialog:

| Setting | Choose | Why |
|---|---|---|
| **Level** | Ads tab, not Campaigns | Ad-level data rolls up to ad set and campaign; the reverse is impossible |
| **Breakdown** | By Time → Day | Unlocks trends, click-through decay and period comparison |
| **Columns** | Performance, plus Impressions, Reach, Frequency, Link clicks, CTR, CPM and your conversion column | Missing columns are worked around where possible, but not always |
| **Attribution** | One window for the whole export | An ad on 7-day click will always beat the same ad on 1-day |
| **Rankings** | Quality, Engagement rate, Conversion rate ranking | Meta's own competitive read, free to include |

The app reports exactly which columns it mapped to which role, so you can check it read your file correctly before trusting anything in it.

---

## What the parser handles

Meta exports vary more than the documentation suggests. These are the cases the parser resolves, each of which produces a confidently wrong number if handled naively:

- **Blank `Result indicator`** marks a period with no results, not a different objective. Treating it as a different goal and excluding its spend understates cost per result, easily by a third on an account where most days produce nothing.
- **Reach cannot be summed.** Someone reached on twenty days is one person counted twenty times. Where an entity spans multiple rows, the app reports average daily reach and frequency and says so, rather than adding them up and reporting a fatiguing ad as fresh.
- **Missing click counts.** Some column sets ship click *rates* without the click *count*. Since CTR is clicks ÷ impressions and CPC is spend ÷ clicks, the count is exactly recoverable, and the app discloses that it did so.
- **Days running** counts days that actually delivered, not the span between first and last, because ads run in bursts.
- **Grand-total row** is excluded from the data and used to verify the arithmetic instead.
- **Locale and date order** are decided per file by voting across every value, so `1.753` and `06/01/2026` are read correctly in both European and US exports.
- **Mixed objectives** are never blended. Adding engagements to purchases produces a headline number with no meaning.
- **Single-level exports.** An Ads export contains no campaign or ad set column at all, so name-derived dimensions become the route to cross-level analysis.

---

## Features

**Exports** — multiple files at once, any level, any locale. A per-file report of every column mapped, every row skipped and every assumption made.

**Overview** — headline figures, ranked findings, spend by verdict, and a trend chart with optional seven-day smoothing.

**Performance** — every entity judged, sortable, with confidence ranges under each cost figure and a full diagnosis on expansion. Or plot the account on an efficiency map of spend against cost, split into four quadrants.

**Compare** — up to four entities side by side, with a significance read that distinguishes a real difference from noise, and reports the smallest gap the data could actually resolve.

**Segments** — group by words in your naming convention (format, funnel stage, budget type, objective, placement) or by any Meta breakdown in the file. Recurring tags let you compare, for example, every video against every static, even when the naming is not rigidly positional.

**Change** — split the period at any date and see which entities improved and which decayed.

**Budget** — a reallocation simulator with an explicit efficiency-decay assumption, because the naive projection that a doubled budget keeps the same cost is how media plans miss.

---

## Running locally

```bash
npm install
npm run dev      # development server
npm run build    # production build to dist/
npm run preview  # serve the production build
```

**Stack:** React 18, Vite, Tailwind CSS, Recharts, lucide-react. No backend, no database, no environment variables.

```
src/
  engine.js    parsing, aggregation, statistics and verdicts (no React)
  App.jsx      interface
  index.css    theme tokens and the glass surface system
  main.jsx     entry point
```

`engine.js` is deliberately free of React so the analysis can be tested directly, reused elsewhere, or run in Node.

---

## Statistics, briefly

Cost per result rests almost entirely on the conversion count, so the app treats conversions as counts rather than as continuous measurements.

- **Confidence ranges** on each cost figure come from the Poisson relative standard error, which is why four conversions produce a range wide enough to be useless and forty do not.
- **Comparisons** use a Poisson rate test with spend as exposure. Where a difference is not significant, the app reports the **minimum detectable difference**, which is the smallest gap the current volume could resolve. This is a bounded, useful number, unlike extrapolating how much more data a near-zero gap would need.
- **Benchmarks** are computed from account totals, not by averaging each entity's rate, so a small ad with one lucky conversion cannot move the yardstick.

---

## Limitations

Worth knowing before you rely on it:

- **Deduplicated reach for a whole period is unavailable from a day-level export.** Use an export without a time breakdown when you specifically need true reach and frequency.
- **Cross-level analysis needs separate files.** Meta provides no join key between an Ads export and a Campaigns export.
- **Where only "all clicks" is available**, click-through and post-click rates read higher and lower respectively than their link-click equivalents. Comparisons between entities stay valid because the basis is the same for all of them.
- **Meta changes export formats without notice.** The parser fails loudly on a missing required column rather than guessing, but a genuinely new column shape may need a fix.
- **This reads exports. It does not change anything** in your ad account.

---

## Licence

`MIT LICENSE`

## Notes

Not affiliated with, endorsed by, or connected to Meta Platforms, Inc. "Meta" is a trademark of Meta Platforms, Inc., used here only to describe what the tool reads.
