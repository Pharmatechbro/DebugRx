'use strict';
/* DebugRx — antibiotic appropriateness review.
   Pure client-side: all data lives in this browser tab, optionally mirrored
   to this device's localStorage with the visitor's explicit consent.
   Nothing is ever transmitted to a server. */

/* ═══════════════ reference data ═══════════════ */

// [agent, AWaRe class, WHO DDD in grams] — edit for your formulary.
const REF = [
  ['Cefazolin', 'Access', 3], ['Amoxicillin/clavulanate', 'Access', 3], ['Ampicillin/sulbactam', 'Access', 6],
  ['Metronidazole', 'Access', 1.5], ['Gentamicin', 'Access', 0.24], ['Amikacin', 'Access', 1], ['Clindamycin', 'Access', 1.8],
  ['Ceftriaxone', 'Watch', 2], ['Cefepime', 'Watch', 2], ['Ceftazidime', 'Watch', 4], ['Piperacillin/tazobactam', 'Watch', 14],
  ['Meropenem', 'Watch', 3], ['Ertapenem', 'Watch', 1], ['Vancomycin', 'Watch', 2], ['Levofloxacin', 'Watch', 0.5],
  ['Ciprofloxacin', 'Watch', 0.8], ['Azithromycin', 'Watch', 0.3],
  ['Linezolid', 'Reserve', 1.2], ['Tigecycline', 'Reserve', 0.1], ['Colistin', 'Reserve', 3]
];
const REFMAP = {};
REF.forEach(r => { REFMAP[r[0]] = { aware: r[1], ddd: r[2] }; });

/* The locked logic. Core domains: any "No" makes the order Inappropriate.
   Cultures are core and gate the verdict. The combined supporting-labs domain
   (procalcitonin, CRP, CBC white-cell/neutrophil picture, lactate where
   relevant) is a MINOR domain: biomarkers are adjuncts, so a "No" flags the
   order for optimisation rather than failing it outright. The individual lab
   VALUES are captured separately as optional documentation; the "labs" domain
   is the reviewer's holistic Yes/No/N-A call. Score it N/A when no supporting
   labs were obtained. */
const CRIT = [
  { key: 'indication', n: 1,  label: 'Indication documented',                            std: 'CDC Core Elements; ASHP',                              core: true,  short: 'indication' },
  { key: 'concordant', n: 2,  label: 'Guideline-concordant agent',                       std: 'IDSA/ATS/ACG/WHO + antibiogram',                       core: true,  short: 'agent' },
  { key: 'culture',    n: 3,  label: 'Cultures sent before therapy',                     std: 'IDSA-SHEA — sent before first dose',                   core: true,  short: 'cultures' },
  { key: 'dose',       n: 4,  label: 'Dose correct',                                     std: 'Label; renal/hepatic adjust',                          core: true,  short: 'dose' },
  { key: 'allergy',    n: 5,  label: 'Allergy reconciled',                               std: 'Allergy reconciliation',                               core: true,  short: 'allergy' },
  { key: 'labs',       n: 6,  label: 'Supporting labs consistent with infection',        std: 'PCT / CRP / CBC-neutrophils / lactate · N/A if none',  core: false, short: 'supporting labs' },
  { key: 'route',      n: 7,  label: 'Route appropriate / IV→PO',                        std: 'IDSA-SHEA IV→PO',                                      core: false, short: 'IV→PO/route' },
  { key: 'deesc',      n: 8,  label: 'De-escalation at 48–72h',                          std: 'Antibiotic time-out',                                  core: false, short: 'de-escalation' },
  { key: 'duration',   n: 9,  label: 'Duration within range',                            std: 'Syndrome guideline',                                   core: false, short: 'duration' },
  { key: 'aware_ok',   n: 10, label: 'AWaRe appropriate',                                std: 'WHO AWaRe',                                            core: false, short: 'AWaRe' },
  { key: 'redundancy', n: 11, label: 'No redundancy / interaction',                      std: 'Pharmacist review',                                    core: false, short: 'redundancy' }
];
const CORE_CRIT = CRIT.filter(c => c.core);
const MINOR_CRIT = CRIT.filter(c => !c.core);
const CORE_KEYS = CORE_CRIT.map(c => c.key);
const MINOR_KEYS = MINOR_CRIT.map(c => c.key);

// Optional lab value fields — documentation only, they do not gate the verdict.
const LAB_FIELDS = [
  { key: 'pctVal',     label: 'Procalcitonin', unit: 'ng/mL',    ph: 'e.g. 4.2 or <0.25' },
  { key: 'crpVal',     label: 'CRP',           unit: 'mg/L',     ph: 'e.g. 180' },
  { key: 'wbcVal',     label: 'WBC',           unit: '×10⁹/L',   ph: 'e.g. 17.5' },
  { key: 'neutVal',    label: 'Neutrophils',   unit: '% or ANC', ph: 'e.g. 88% / ANC 15.2' },
  { key: 'lactateVal', label: 'Lactate',       unit: 'mmol/L',   ph: 'e.g. 2.1' }
];

const VCOLORS = {
  'Appropriate':                    { bg: 'var(--color-accent-2-100)', color: 'var(--color-accent-2-800)' },
  'Appropriate with optimisation':  { bg: 'var(--color-accent-2-100)', color: 'var(--color-accent-700)' },
  'Inappropriate — review':         { bg: 'var(--color-accent-200)',   color: 'var(--color-accent-800)' },
  'Escalation / unsafe':            { bg: 'var(--color-neutral-900)',  color: 'var(--color-accent-300)' },
  'Incomplete':                     { bg: 'var(--color-neutral-200)',  color: 'var(--color-neutral-700)' }
};

/* ═══════════════ scoring — evaluated top to bottom, first match wins ═══════════════ */

function verdict(e) {
  if (!e.agent) return '';
  if (e.safety === 'Yes') return 'Escalation / unsafe';
  const minorNo = MINOR_KEYS.filter(k => e[k] === 'No').length;
  if (CORE_KEYS.some(k => e[k] === 'No') || minorNo >= 3) return 'Inappropriate — review';
  if (CORE_KEYS.some(k => !e[k]) || !e.safety) return 'Incomplete';
  if (minorNo >= 1) return 'Appropriate with optimisation';
  return 'Appropriate';
}

function whyFail(e, v) {
  if (v === 'Escalation / unsafe') return 'Critical safety breach flagged.';
  if (v.indexOf('Inappropriate') === 0) {
    const core = CORE_CRIT.filter(c => e[c.key] === 'No').map(c => c.short);
    if (core.length) return 'Core fail: ' + core.join(', ') + '.';
    return '3 or more minor domains failed.';
  }
  if (v === 'Appropriate with optimisation') {
    const m = MINOR_CRIT.filter(c => e[c.key] === 'No').map(c => c.short);
    return 'Optimise: ' + m.join(', ') + '.';
  }
  if (v === 'Appropriate') {
    const unscored = MINOR_KEYS.filter(k => !e[k]).length;
    if (unscored) return 'Core domains met — ' + unscored + ' minor domain' + (unscored > 1 ? 's' : '') + ' not yet scored.';
    return 'Guideline-concordant — no action needed.';
  }
  return 'Score the core domains and safety flag.';
}

function coreFailedLabels(e) { return CORE_CRIT.filter(c => e[c.key] === 'No').map(c => c.label); }
function minorFailedCount(e) { return MINOR_KEYS.filter(k => e[k] === 'No').length; }

function awareClassFor(a) {
  if (a === 'Access') return 'tag-accent-2';
  if (a === 'Reserve') return 'tag-accent';
  return 'tag-neutral';
}

function calcDDD(agent, doseG) {
  const r = REFMAP[agent];
  if (!r || doseG === '' || doseG == null || isNaN(doseG) || !r.ddd) return '';
  return Math.round((doseG / r.ddd) * 10) / 10;
}

function blankForm() {
  const f = {
    date: new Date().toISOString().slice(0, 10),
    pid: '', ward: '', presc: '', agent: '', synd: '', sev: '',
    safety: '', deElig: '', deDone: '', ivElig: '', ivDone: '',
    intMade: '', intAcc: '', dot: '', doseG: '', notes: ''
  };
  CRIT.forEach(c => { f[c.key] = ''; });
  LAB_FIELDS.forEach(l => { f[l.key] = ''; });
  return f;
}

/* ═══════════════ CSV schema — rich, human-readable ═══════════════ */

// [internal key, spreadsheet column header]. Round-trips on import.
const EXPORT_FIELDS = [
  ['date', 'Review date'], ['pid', 'Patient code'], ['ward', 'Ward/Unit'], ['presc', 'Prescriber'],
  ['agent', 'Antibiotic'], ['aware', 'AWaRe class'], ['synd', 'Syndrome/Indication'], ['sev', 'Severity'],
  ['indication', 'Indication documented'], ['concordant', 'Guideline-concordant agent'],
  ['culture', 'Cultures sent before therapy'], ['labs', 'Supporting labs consistent with infection'],
  ['dose', 'Dose correct'], ['allergy', 'Allergy reconciled'], ['route', 'Route appropriate / IV-to-PO'],
  ['deesc', 'De-escalation at 48-72h'], ['duration', 'Duration within range'],
  ['aware_ok', 'AWaRe appropriate'], ['redundancy', 'No redundancy / interaction'],
  ['safety', 'Critical safety breach'],
  ['pctVal', 'Procalcitonin (ng/mL)'], ['crpVal', 'CRP (mg/L)'], ['wbcVal', 'WBC (x10^9/L)'],
  ['neutVal', 'Neutrophils (% or ANC)'], ['lactateVal', 'Lactate (mmol/L)'],
  ['deElig', 'De-escalation eligible'], ['deDone', 'De-escalation done'],
  ['ivElig', 'IV-to-PO eligible'], ['ivDone', 'IV-to-PO done'],
  ['intMade', 'Intervention made'], ['intAcc', 'Intervention accepted'],
  ['dot', 'DOT (days of therapy)'], ['doseG', 'Total dose given (g)'], ['ddd', 'DDD (WHO)'],
  ['verdict', 'Verdict'], ['notes', 'Notes']
];
// Computed columns appended to each export row (recomputed on import).
const DERIVED_FIELDS = [
  ['_reason', 'Verdict reason'],
  ['_coreFailed', 'Core domains failed'],
  ['_minorFailed', 'Minor domains failed (count)']
];
const IMPORT_MAP = {};
EXPORT_FIELDS.forEach(([k, h]) => { IMPORT_MAP[h.toLowerCase()] = k; IMPORT_MAP[k.toLowerCase()] = k; });

/* ═══════════════ helpers ═══════════════ */

function escHtml(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function dash(v) { return (v === '' || v == null) ? '—' : escHtml(v); }
function newId() { return String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7); }

/* ═══════════════ persistence (opt-in, device-local only) ═══════════════ */

const LS = { consent: 'debugrx.consent', entries: 'debugrx.entries', dash: 'debugrx.dash' };

function loadStored() {
  try {
    const consent = localStorage.getItem(LS.consent);
    let entries = [], dashCfg = { period: '', ptdays: '', beddays: '' };
    if (consent === 'save') {
      const e = localStorage.getItem(LS.entries);
      const d = localStorage.getItem(LS.dash);
      if (e) entries = JSON.parse(e);
      if (d) dashCfg = Object.assign(dashCfg, JSON.parse(d));
      if (!Array.isArray(entries)) entries = [];
    }
    return { consent, entries, dashCfg };
  } catch (err) {
    return { consent: null, entries: [], dashCfg: { period: '', ptdays: '', beddays: '' } };
  }
}

function persist() {
  if (state.consent !== 'save') return;
  try {
    localStorage.setItem(LS.entries, JSON.stringify(state.entries));
    localStorage.setItem(LS.dash, JSON.stringify(state.dash));
  } catch (err) { /* storage full or blocked — data stays in memory */ }
}

function setConsent(mode) {
  state.consent = mode;
  try {
    localStorage.setItem(LS.consent, mode);
    if (mode === 'save') {
      persist();
    } else {
      localStorage.removeItem(LS.entries);
      localStorage.removeItem(LS.dash);
    }
  } catch (err) { /* private browsing etc. — behave as session-only */ }
  updateStorageTag();
  document.getElementById('banner-root').innerHTML = '';
}

/* ═══════════════ state ═══════════════ */

const stored = loadStored();
const state = {
  view: 'review',
  form: blankForm(),
  entries: stored.entries,
  dash: stored.dashCfg,
  dashFilter: null,
  dialog: null,          // {type:'detail',entry} | {type:'clear'} | {type:'storage'}
  consent: stored.consent, // 'save' | 'session' | null (not yet chosen → session)
  lastVerdict: ''
};

/* ═══════════════ svg fragments ═══════════════ */

const ICONS = {
  check: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
  sliders: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>',
  warn: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  octagon: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16h.01"/><path d="M12 8v4"/><path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86Z"/></svg>',
  dashed: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" stroke-dasharray="4 3"/></svg>',
  sparkle: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 4.5L6 9l4.1 1.5L12 15l1.9-4.5L18 9l-4.1-1.5Z"/><path d="M5 3v4"/><path d="M19 17v4"/></svg>',
  filter: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
  x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  chevron: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  shield: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>'
};

function verdictIcon(v) {
  if (v === 'Appropriate') return ICONS.check;
  if (v === 'Appropriate with optimisation') return ICONS.sliders;
  if (v.indexOf('Inappropriate') === 0) return ICONS.warn;
  if (v.indexOf('Escalation') === 0) return ICONS.octagon;
  return ICONS.dashed;
}

/* ═══════════════ review view ═══════════════ */

function critRowHtml(c) {
  return '<div class="crit-row">' +
    '<div><span class="crit-num">' + c.n + '</span><span class="crit-label">' + escHtml(c.label) + '</span>' +
    '<small class="crit-std">' + escHtml(c.std) + '</small></div>' +
    '<div class="seg3" role="group" aria-label="' + escHtml(c.label) + '">' +
      '<button type="button" data-action="seg" data-key="' + c.key + '" data-val="Yes" aria-pressed="false">Yes</button>' +
      '<button type="button" data-action="seg" data-key="' + c.key + '" data-val="No" aria-pressed="false">No</button>' +
      '<button type="button" data-action="seg" data-key="' + c.key + '" data-val="N/A" aria-pressed="false">N/A</button>' +
    '</div></div>';
}

function labInputsHtml(f) {
  return LAB_FIELDS.map(l =>
    '<div class="field"><label>' + escHtml(l.label) + ' <span>' + escHtml(l.unit) + '</span></label>' +
    '<input class="input" type="text" placeholder="' + escHtml(l.ph) + '" data-field="' + l.key + '" value="' + escHtml(f[l.key]) + '"></div>'
  ).join('');
}

function reviewHtml() {
  const f = state.form;
  const agentOpts = ['<option value="">— select —</option>']
    .concat(REF.map(r => '<option value="' + escHtml(r[0]) + '"' + (f.agent === r[0] ? ' selected' : '') + '>' + escHtml(r[0]) + '</option>'))
    .join('');
  const sevOpts = ['', 'Mild', 'Moderate', 'Severe'].map(o =>
    '<option value="' + o + '"' + (f.sev === o ? ' selected' : '') + '>' + (o || '—') + '</option>').join('');
  const ynOpts = (val) => ['', 'Yes', 'No'].map(o =>
    '<option value="' + o + '"' + (val === o ? ' selected' : '') + '>' + o + '</option>').join('');
  const intAccOpts = ['', 'Yes', 'No', 'Pending'].map(o =>
    '<option value="' + o + '"' + (f.intAcc === o ? ' selected' : '') + '>' + o + '</option>').join('');

  return '' +
  '<div class="review-grid">' +
    '<div class="card elev-sm form-card">' +
      '<div class="form-head"><h3 style="margin:0">New review</h3><small>step-by-step scoring</small></div>' +
      '<div class="form-grid">' +
        '<div class="field"><label>Review date</label><input class="input" type="date" data-field="date" value="' + escHtml(f.date) + '"></div>' +
        '<div class="field"><label>Patient ID <span>non-identifying code</span></label><input class="input" type="text" placeholder="e.g. BED-12 / case-04" data-field="pid" value="' + escHtml(f.pid) + '"></div>' +
        '<div class="field"><label>Ward / unit</label><input class="input" type="text" placeholder="e.g. ICU" data-field="ward" value="' + escHtml(f.ward) + '"></div>' +
        '<div class="field"><label>Prescriber <span>optional</span></label><input class="input" type="text" placeholder="initials" data-field="presc" value="' + escHtml(f.presc) + '"></div>' +
        '<div class="field"><label>Antibiotic</label><select class="input" data-field="agent">' + agentOpts + '</select></div>' +
        '<div class="field"><label>AWaRe class <span>auto</span></label><div style="padding-top:6px"><span id="aware-tag" class="tag tag-neutral" style="font-weight:700;font-family:var(--font-heading)">—</span></div></div>' +
        '<div class="field"><label>Syndrome / indication</label><input class="input" type="text" placeholder="e.g. pyelonephritis" data-field="synd" value="' + escHtml(f.synd) + '"></div>' +
        '<div class="field"><label>Severity</label><select class="input" data-field="sev">' + sevOpts + '</select></div>' +
      '</div>' +

      '<div class="stewardship-head">Supporting labs <span style="font-weight:400;opacity:.6;font-size:12px">optional values — they document the &ldquo;supporting labs&rdquo; minor domain below</span></div>' +
      '<div class="stewardship-grid">' + labInputsHtml(f) + '</div>' +

      '<div class="tier-head"><span class="tag tag-core">CORE</span><b>Core domains — any &ldquo;No&rdquo; makes the order Inappropriate</b></div>' +
      '<div>' + CORE_CRIT.map(critRowHtml).join('') + '</div>' +

      '<div class="tier-head minor"><span class="tag tag-neutral">MINOR</span><b>Minor domains — 1–2 &ldquo;No&rdquo; = optimise; 3+ = review</b></div>' +
      '<div>' + MINOR_CRIT.map(critRowHtml).join('') + '</div>' +

      '<div class="safety-box">' +
        '<div class="safety-copy"><b>Critical safety breach?</b><small>allergy mismatch · major interaction · unapproved Reserve agent</small></div>' +
        '<div class="seg3 lg" role="group" aria-label="Critical safety breach">' +
          '<button type="button" data-action="seg" data-key="safety" data-val="No" aria-pressed="false">No</button>' +
          '<button type="button" data-action="seg" data-key="safety" data-val="Yes" aria-pressed="false">Yes</button>' +
        '</div>' +
      '</div>' +

      '<div class="stewardship-head">Stewardship actions &amp; consumption</div>' +
      '<div class="stewardship-grid">' +
        '<div class="field"><label>De-escalation eligible?</label><select class="input" data-field="deElig">' + ynOpts(f.deElig) + '</select></div>' +
        '<div class="field"><label>De-escalation done?</label><select class="input" data-field="deDone">' + ynOpts(f.deDone) + '</select></div>' +
        '<div class="field"><label>IV→PO eligible?</label><select class="input" data-field="ivElig">' + ynOpts(f.ivElig) + '</select></div>' +
        '<div class="field"><label>IV→PO done?</label><select class="input" data-field="ivDone">' + ynOpts(f.ivDone) + '</select></div>' +
        '<div class="field"><label>Intervention made?</label><select class="input" data-field="intMade">' + ynOpts(f.intMade) + '</select></div>' +
        '<div class="field"><label>Intervention accepted?</label><select class="input" data-field="intAcc">' + intAccOpts + '</select></div>' +
        '<div class="field"><label>DOT — days of therapy</label><input class="input" type="number" min="0" step="1" placeholder="e.g. 5" data-field="dot" value="' + escHtml(f.dot) + '"></div>' +
        '<div class="field"><label>Total dose given (g) <span>for DDD</span></label><input class="input" type="number" min="0" step="0.01" placeholder="grams" data-field="doseG" value="' + escHtml(f.doseG) + '"></div>' +
      '</div>' +
      '<div class="field" style="margin-top:var(--space-2)"><label>Notes</label><textarea class="input" rows="2" placeholder="rationale, culture result, plan…" data-field="notes">' + escHtml(f.notes) + '</textarea></div>' +
    '</div>' +

    '<div class="sticky-col">' +
      '<div class="card elev-md verdict-card" id="verdict-card"></div>' +
      '<button type="button" class="btn btn-primary btn-block" style="margin-top:0;font-size:14px;padding:11px" data-action="add-entry">Add to register</button>' +
      '<p class="session-note" id="session-note"></p>' +
    '</div>' +
  '</div>' +

  '<div class="card elev-sm register-card"><div id="register-inner"></div></div>' +

  logicHtml();
}

function logicHtml() {
  const rows = CRIT.map(c =>
    '<tr><td>' + c.n + '</td><td>' + escHtml(c.label) + '</td><td>' + (c.core ? 'Core' : 'Minor') + '</td><td>' + escHtml(c.std) + '</td></tr>'
  ).join('');
  return '' +
  '<details class="card elev-sm logic-card">' +
    '<summary>' + ICONS.chevron + ' How the scoring works — the locked logic</summary>' +
    '<div class="logic-body">' +
      '<p>Each order is scored <b>Yes / No / N/A</b> against eleven domains, each tied to a published standard. Because the standard is pre-agreed, a &ldquo;No&rdquo; is a statement about guideline concordance, not about the prescriber — which keeps the data defensible and the pharmacist–physician conversation collaborative.</p>' +
      '<p>Cultures are a core domain. The single combined <b>supporting-labs</b> domain — procalcitonin, CRP, the CBC white-cell / neutrophil picture, and lactate where relevant — is a <b>minor</b> domain: biomarkers are decision-support <i>adjuncts</i>, so an unsupportive lab picture flags the order for optimisation rather than failing it outright. Record the individual values in the <b>Supporting labs</b> fields; the domain itself is your holistic Yes/No/N-A call on whether the labs, <i>on balance</i>, support a bacterial infection. Score <b>N/A</b> when none were obtained, and never let a single normal marker override strong clinical suspicion — flag &ldquo;No&rdquo; only when the overall lab picture argues against bacterial infection.</p>' +
      '<table class="table"><tr><th>#</th><th>Domain</th><th>Tier</th><th>Reference</th></tr>' + rows + '</table>' +
      '<p class="logic-mono">Verdict, evaluated top to bottom — first match wins:</p>' +
      '<table class="table" style="margin-bottom:14px">' +
        '<tr><th>Verdict</th><th>Rule</th></tr>' +
        '<tr><td>Escalation / unsafe</td><td>Critical safety breach flagged</td></tr>' +
        '<tr><td>Inappropriate — review</td><td>Any core domain = No, or ≥3 minor domains = No</td></tr>' +
        '<tr><td>Appropriate with optimisation</td><td>All core Yes/N-A, and 1–2 minor = No</td></tr>' +
        '<tr><td>Appropriate</td><td>All core Yes/N-A and no minor = No (unscored minors are flagged on the verdict card)</td></tr>' +
        '<tr><td>Incomplete</td><td>A core domain or the safety flag is blank — a definite core &ldquo;No&rdquo; or safety breach is decisive even if other domains are still blank</td></tr>' +
      '</table>' +
      '<p style="font-size:12.5px;opacity:.6;margin:0">Criteria synthesised from CDC Core Elements, IDSA/SHEA, ATS/IDSA CAP, IDSA cUTI, ACG acute pancreatitis, WHO AWaRe, and procalcitonin-guided stewardship literature. Adapt the agent list and concordance rules to your own formulary and antibiogram.</p>' +
    '</div>' +
  '</details>';
}

/* — targeted updates inside the review view — */

function paintSegs() {
  document.querySelectorAll('[data-action="seg"]').forEach(btn => {
    const sel = state.form[btn.dataset.key] === btn.dataset.val;
    btn.classList.toggle('sel-yes', sel && btn.dataset.val === 'Yes');
    btn.classList.toggle('sel-no', sel && btn.dataset.val === 'No');
    btn.classList.toggle('sel-na', sel && btn.dataset.val === 'N/A');
    btn.setAttribute('aria-pressed', sel ? 'true' : 'false');
  });
}

function updateAwareTag() {
  const el = document.getElementById('aware-tag');
  if (!el) return;
  const r = REFMAP[state.form.agent];
  const label = r ? r.aware : '—';
  el.className = 'tag ' + awareClassFor(label);
  el.style.fontWeight = '700';
  el.style.fontFamily = 'var(--font-heading)';
  el.textContent = label;
}

function updateVerdict() {
  const card = document.getElementById('verdict-card');
  if (!card) return;
  const f = state.form;
  const v = verdict(f);
  const vc = VCOLORS[v] || VCOLORS['Incomplete'];
  const r = REFMAP[f.agent];
  const awareLabel = r ? r.aware : '—';
  const minorNo = MINOR_KEYS.filter(k => f[k] === 'No').length;
  const ddd = calcDDD(f.agent, f.doseG === '' ? '' : parseFloat(f.doseG));
  card.style.background = vc.bg;
  card.style.color = vc.color;
  card.innerHTML =
    '<div class="verdict-kicker">Live verdict</div>' +
    '<div class="verdict-main">' +
      '<div class="verdict-icon">' + verdictIcon(v) + '</div>' +
      '<div class="verdict-result-label">Result</div>' +
      '<div class="verdict-text">' + escHtml(v || 'Awaiting input') + '</div>' +
      '<div class="verdict-why">' + escHtml(v ? whyFail(f, v) : 'Pick an antibiotic and score the core domains.') + '</div>' +
    '</div>' +
    '<div class="verdict-stats">' +
      '<div><b>' + escHtml(awareLabel) + '</b><span>AWaRe</span></div>' +
      '<div><b>' + minorNo + '</b><span>minor &ldquo;No&rdquo;</span></div>' +
      '<div><b>' + (ddd === '' ? '—' : ddd) + '</b><span>DDD</span></div>' +
    '</div>';
  if (v !== state.lastVerdict) {
    card.classList.remove('vpulse');
    void card.offsetWidth;
    card.classList.add('vpulse');
    state.lastVerdict = v;
  }
}

/* — register — */

function filteredEntries() {
  const flt = state.dashFilter;
  if (!flt) return state.entries;
  return state.entries.filter(e => flt.kind === 'verdict' ? e.verdict === flt.value : e.aware === flt.value);
}

function renderRegister() {
  const el = document.getElementById('register-inner');
  if (!el) return;
  const entries = state.entries;
  const filtered = filteredEntries();
  const flt = state.dashFilter;
  const filterLabel = flt ? (flt.kind === 'verdict' ? flt.value : flt.value + ' (AWaRe)') : '';

  let head =
    '<div class="register-head"><h3>Register</h3>' +
    '<span class="register-count">' + (entries.length ? ('· ' + entries.length + ' order' + (entries.length > 1 ? 's' : '') + (flt ? ' · ' + filtered.length + ' shown' : '')) : '') + '</span>' +
    (flt ? '<span class="filter-chip">' + ICONS.filter + escHtml(filterLabel) +
      '<button type="button" data-action="clear-filter" title="Clear filter">' + ICONS.x + '</button></span>' : '') +
    '<span class="register-hint">click a row for details</span></div>';

  let body;
  if (entries.length === 0) {
    body = '<div class="empty-onboarding">' + ICONS.sparkle +
      '<div class="empty-title">No orders yet</div>' +
      '<p>Score an antibiotic order above and add it to the register — or load four worked examples to see the dashboard fill in.</p>' +
      '<button type="button" class="btn btn-primary" data-action="load-examples">Load examples</button></div>';
  } else if (filtered.length === 0) {
    body = '<div class="empty-filtered">No entries match this filter. <a href="#" data-action="clear-filter">Clear it</a> to see everything.</div>';
  } else {
    const rows = filtered.slice().reverse().map(e => {
      const evc = VCOLORS[e.verdict] || VCOLORS['Incomplete'];
      return '<tr data-action="row-open" data-id="' + escHtml(e.id) + '" tabindex="0" aria-label="Open details for ' + escHtml(e.agent) + (e.pid ? ', ' + escHtml(e.pid) : '') + '">' +
        '<td>' + dash(e.date) + '</td><td>' + dash(e.pid) + '</td><td>' + dash(e.ward) + '</td>' +
        '<td>' + escHtml(e.agent) + '</td><td><span class="tag ' + awareClassFor(e.aware) + '">' + dash(e.aware) + '</span></td>' +
        '<td>' + dash(e.synd) + '</td>' +
        '<td><span class="tag" style="background:' + evc.bg + ';color:' + evc.color + ';font-weight:700">' + dash(e.verdict) + '</span></td>' +
        '<td>' + dash(e.dot) + '</td><td>' + dash(e.ddd) + '</td>' +
        '<td><button type="button" class="row-del" data-action="row-del" data-id="' + escHtml(e.id) + '" title="Delete" aria-label="Delete entry ' + escHtml(e.pid || e.agent) + '">' + ICONS.trash + '</button></td>' +
      '</tr>';
    }).join('');
    body = '<div class="register-table-wrap"><table class="table register-table">' +
      '<thead><tr><th>Date</th><th>ID</th><th>Ward</th><th>Antibiotic</th><th>AWaRe</th><th>Syndrome</th><th>Verdict</th><th>DOT</th><th>DDD</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }
  el.innerHTML = head + body;
}

/* ═══════════════ dashboard view ═══════════════ */

function computeStats() {
  const entries = state.entries;
  const n = entries.length;
  const cnt = v => entries.filter(e => e.verdict === v).length;
  const nApp = cnt('Appropriate'), nOpt = cnt('Appropriate with optimisation');
  const nIna = entries.filter(e => e.verdict && e.verdict.indexOf('Inappropriate') === 0).length;
  const nEsc = entries.filter(e => e.verdict && e.verdict.indexOf('Escalation') === 0).length;
  const nInc = cnt('Incomplete');
  const scored = n - nInc;
  const awc = c => entries.filter(e => e.aware === c).length;
  const yesc = k => entries.filter(e => e[k] === 'Yes').length;
  const pct = (num, den) => den > 0 ? (num / den) : null;
  const totDot = entries.reduce((a, e) => a + (isFinite(parseFloat(e.dot)) ? parseFloat(e.dot) : 0), 0);
  const totDdd = entries.reduce((a, e) => a + (isFinite(parseFloat(e.ddd)) ? parseFloat(e.ddd) : 0), 0);
  const ptd = parseFloat(state.dash.ptdays) || 0;
  const bdd = parseFloat(state.dash.beddays) || 0;
  return {
    n, nApp, nOpt, nIna, nEsc, nInc, scored,
    acc: awc('Access'), wat: awc('Watch'), res: awc('Reserve'),
    appStrict: pct(nApp, scored), appIncl: pct(nApp + nOpt, scored), accPct: pct(awc('Access'), n),
    deRate: pct(entries.filter(e => e.deElig === 'Yes' && e.deDone === 'Yes').length, yesc('deElig')),
    ivRate: pct(entries.filter(e => e.ivElig === 'Yes' && e.ivDone === 'Yes').length, yesc('ivElig')),
    intRate: pct(entries.filter(e => e.intMade === 'Yes' && e.intAcc === 'Yes').length, yesc('intMade')),
    dot1000: ptd > 0 ? (totDot / ptd * 1000) : null,
    ddd100: bdd > 0 ? (totDdd / bdd * 100) : null
  };
}

const fmtPct = x => x === null ? '—' : (x * 100).toFixed(1) + '%';

function kpiGridHtml() {
  const st = computeStats();
  const kpis = [
    { value: st.n, label: 'Orders reviewed' },
    { value: fmtPct(st.appStrict), label: 'Appropriateness (strict)', bg: 'var(--color-accent-2-100)', color: 'var(--color-accent-2-800)' },
    { value: fmtPct(st.appIncl), label: 'Appropriate incl. optimisation' },
    { value: st.nEsc, label: 'Escalation / unsafe', bg: st.nEsc > 0 ? 'var(--color-neutral-900)' : null, color: st.nEsc > 0 ? 'var(--color-accent-300)' : null },
    { value: fmtPct(st.accPct), label: 'Access %' },
    { value: fmtPct(st.deRate), label: 'De-escalation rate' },
    { value: fmtPct(st.ivRate), label: 'IV→PO conversion' },
    { value: fmtPct(st.intRate), label: 'Intervention acceptance' },
    { value: st.dot1000 === null ? '—' : st.dot1000.toFixed(1), label: 'DOT / 1000 pt-days' },
    { value: st.ddd100 === null ? '—' : st.ddd100.toFixed(1), label: 'DDD / 100 bed-days' }
  ];
  return kpis.map(k =>
    '<div class="card elev-sm" style="background:' + (k.bg || 'var(--color-neutral-100)') + '">' +
      '<div class="kpi-value" style="color:' + (k.color || 'var(--color-text)') + '">' + k.value + '</div>' +
      '<div class="kpi-label">' + k.label + '</div>' +
    '</div>').join('');
}

function barsHtml(data, n) {
  const max = Math.max(1, ...data.map(d => d.count));
  return data.map(d => {
    const pctOfAll = n > 0 ? Math.round(d.count / n * 1000) / 10 : 0;
    const tip = d.count + ' order' + (d.count === 1 ? '' : 's') + ' · ' + pctOfAll + '%';
    return '<div class="bar-row' + (d.count > 0 ? ' has-tip' : '') + '">' +
      '<div class="bar-grid" data-action="bar" data-kind="' + d.kind + '" data-value="' + escHtml(d.value) + '" data-count="' + d.count + '"' +
        (d.count > 0 ? ' role="button" tabindex="0" aria-label="Filter register by ' + escHtml(d.label) + ' — ' + tip + '"' : '') + '>' +
        '<span>' + escHtml(d.label) + '</span>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + (d.count / max * 100) + '%;background:' + d.color + '"></div></div>' +
        '<span class="bar-count">' + d.count + '</span>' +
      '</div>' +
      '<div class="bar-tip">' + tip + '</div>' +
    '</div>';
  }).join('');
}

function dashHtml() {
  const st = computeStats();
  const verdictBars = barsHtml([
    { label: 'Appropriate', count: st.nApp, color: 'var(--color-accent-2-600)', kind: 'verdict', value: 'Appropriate' },
    { label: 'w/ optimisation', count: st.nOpt, color: 'var(--color-accent-2-400)', kind: 'verdict', value: 'Appropriate with optimisation' },
    { label: 'Inappropriate', count: st.nIna, color: 'var(--color-accent-600)', kind: 'verdict', value: 'Inappropriate — review' },
    { label: 'Escalation', count: st.nEsc, color: 'var(--color-accent-900)', kind: 'verdict', value: 'Escalation / unsafe' },
    { label: 'Incomplete', count: st.nInc, color: 'var(--color-neutral-500)', kind: 'verdict', value: 'Incomplete' }
  ], st.n);
  const awareBars = barsHtml([
    { label: 'Access', count: st.acc, color: 'var(--color-accent-2-600)', kind: 'aware', value: 'Access' },
    { label: 'Watch', count: st.wat, color: 'var(--color-neutral-500)', kind: 'aware', value: 'Watch' },
    { label: 'Reserve', count: st.res, color: 'var(--color-accent-700)', kind: 'aware', value: 'Reserve' }
  ], st.n);

  return '' +
  '<div class="card elev-sm dash-inputs">' +
    '<div class="field"><label>Reporting period</label><input class="input" type="text" placeholder="e.g. June 2026" data-dash="period" value="' + escHtml(state.dash.period) + '"></div>' +
    '<div class="field"><label>Patient-days <span>for DOT/1000</span></label><input class="input" type="number" min="0" data-dash="ptdays" value="' + escHtml(state.dash.ptdays) + '"></div>' +
    '<div class="field"><label>Bed-days <span>for DDD/100</span></label><input class="input" type="number" min="0" data-dash="beddays" value="' + escHtml(state.dash.beddays) + '"></div>' +
  '</div>' +
  '<div class="kpi-grid" id="kpi-grid">' + kpiGridHtml() + '</div>' +
  '<div class="chart-grid">' +
    '<div class="card elev-sm chart-card"><h4>Verdict distribution <span>click a bar to filter the register</span></h4>' + verdictBars + '</div>' +
    '<div class="card elev-sm chart-card"><h4>AWaRe distribution <span>target ≥60% Access</span></h4>' + awareBars + '</div>' +
  '</div>';
}

/* ═══════════════ dialogs ═══════════════ */

let dialogReturnFocus = null;

function renderDialog() {
  const root = document.getElementById('dialog-root');
  const d = state.dialog;
  if (!d) {
    root.innerHTML = '';
    if (dialogReturnFocus && document.contains(dialogReturnFocus)) dialogReturnFocus.focus();
    dialogReturnFocus = null;
    return;
  }
  dialogReturnFocus = document.activeElement;
  let inner = '';

  if (d.type === 'detail') {
    const e = d.entry;
    const evc = VCOLORS[e.verdict] || VCOLORS['Incomplete'];
    const labVals = LAB_FIELDS.map(l => l.label + ' ' + dash(e[l.key])).join(' · ');
    inner =
      '<div class="dialog-title" id="dialog-title">' + escHtml(e.agent) + '</div>' +
      '<div class="dialog-body">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
          '<span class="tag" style="background:' + evc.bg + ';color:' + evc.color + ';font-weight:700">' + dash(e.verdict) + '</span>' +
          '<span class="tag ' + awareClassFor(e.aware) + '">' + dash(e.aware) + '</span>' +
        '</div>' +
        '<p style="margin:4px 0"><b>Date</b> ' + dash(e.date) + ' &nbsp;·&nbsp; <b>Ward</b> ' + dash(e.ward) + ' &nbsp;·&nbsp; <b>Patient</b> ' + dash(e.pid) + '</p>' +
        '<p style="margin:4px 0"><b>Syndrome</b> ' + dash(e.synd) + ' &nbsp;·&nbsp; <b>Severity</b> ' + dash(e.sev) + '</p>' +
        '<p style="margin:4px 0"><b>Cultures sent</b> ' + dash(e.culture) + ' &nbsp;·&nbsp; <b>Supporting labs</b> ' + dash(e.labs) + '</p>' +
        '<p style="margin:4px 0"><b>Lab values</b> ' + labVals + '</p>' +
        '<p style="margin:4px 0"><b>DOT</b> ' + dash(e.dot) + ' &nbsp;·&nbsp; <b>DDD</b> ' + dash(e.ddd) + '</p>' +
        '<p style="margin:4px 0"><b>De-escalation</b> eligible ' + dash(e.deElig) + ' / done ' + dash(e.deDone) + ' &nbsp;·&nbsp; <b>IV→PO</b> eligible ' + dash(e.ivElig) + ' / done ' + dash(e.ivDone) + '</p>' +
        '<p style="margin:4px 0"><b>Intervention</b> made ' + dash(e.intMade) + ' / accepted ' + dash(e.intAcc) + '</p>' +
        (e.notes && String(e.notes).trim() ? '<p style="margin:10px 0 0;padding:10px;background:var(--color-neutral-100);border-radius:8px">' + escHtml(e.notes) + '</p>' : '') +
      '</div>' +
      '<div class="dialog-actions"><button type="button" class="btn btn-secondary" data-action="dialog-close">Close</button></div>';

  } else if (d.type === 'clear') {
    inner =
      '<div class="dialog-title">Delete all entries?</div>' +
      '<div class="dialog-body">This removes all ' + state.entries.length + ' rows from the register' +
      (state.consent === 'save' ? ' and from this device’s local storage' : '') +
      '. Export a CSV first if you want a copy — this can’t be undone.</div>' +
      '<div class="dialog-actions">' +
        '<button type="button" class="btn btn-secondary" data-action="dialog-close">Cancel</button>' +
        '<button type="button" class="btn btn-primary" style="background:var(--color-accent-800)" data-action="confirm-clear">Delete all</button>' +
      '</div>';

  } else if (d.type === 'storage') {
    const saving = state.consent === 'save';
    inner =
      '<div class="dialog-title">Where should your data live?</div>' +
      '<div class="dialog-body">' +
        '<p style="margin:0 0 10px">DebugRx never sends data to a server — the only choice is whether entries are also saved to <b>this device’s</b> browser storage so they survive a refresh.</p>' +
        '<p style="margin:0 0 10px">Current mode: <b>' + (saving ? 'Saving on this device' : 'Session only — discarded on close') + '</b></p>' +
        (saving ? '<p style="margin:0;font-size:12.5px;opacity:.75">Switching to session-only immediately deletes the saved copy from this device. Your current session keeps its data until the tab closes.</p>'
                : '<p style="margin:0;font-size:12.5px;opacity:.75">Saving keeps entries on this device only. Anyone with access to this browser profile could see them — avoid identifiable patient data either way.</p>') +
      '</div>' +
      '<div class="dialog-actions">' +
        '<button type="button" class="btn btn-secondary" data-action="' + (saving ? 'set-session' : 'dialog-close') + '">' + (saving ? 'Switch to session only' : 'Keep session only') + '</button>' +
        '<button type="button" class="btn btn-primary" data-action="' + (saving ? 'dialog-close' : 'set-save') + '">' + (saving ? 'Keep saving' : 'Save on this device') + '</button>' +
      '</div>';
  }

  root.innerHTML =
    '<div class="dialog-backdrop" data-action="dialog-close">' +
      '<div class="dialog elev-lg" data-action="noop" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1">' + inner + '</div>' +
    '</div>';
  root.querySelector('.dialog').focus();
}

/* ═══════════════ consent banner + storage tag ═══════════════ */

function renderBanner() {
  const root = document.getElementById('banner-root');
  if (state.consent === 'save' || state.consent === 'session') { root.innerHTML = ''; return; }
  root.innerHTML =
    '<div class="card elev-lg consent-banner">' +
      '<div class="consent-title">Keep your entries on this device?</div>' +
      '<p>DebugRx runs entirely in your browser — <b>nothing is ever sent to a server</b>. Choose whether entries should be saved to this device’s local storage (so they survive a refresh) or kept only for this session. Until you choose, nothing is stored. Avoid entering patient-identifying information either way.</p>' +
      '<div class="consent-actions">' +
        '<button type="button" class="btn btn-secondary" data-action="consent-session">Session only — discard on close</button>' +
        '<button type="button" class="btn btn-primary" data-action="consent-save">Save on this device</button>' +
      '</div>' +
    '</div>';
}

function updateStorageTag() {
  const tag = document.getElementById('storage-tag');
  if (tag) {
    const saving = state.consent === 'save';
    tag.classList.toggle('saving', saving);
    tag.innerHTML = ICONS.shield + (saving ? 'Saving on this device' : 'Session only');
  }
  const note = document.getElementById('session-note');
  if (note) {
    note.textContent = state.consent === 'save'
      ? 'Entries are saved on this device only — Export CSV for a portable backup.'
      : 'Data stays in this session and is discarded on close — Export CSV to save your work.';
  }
}

/* ═══════════════ actions ═══════════════ */

function addEntry() {
  const f = state.form;
  if (!f.agent) { alert('Pick an antibiotic first.'); return; }
  const e = Object.assign({}, f);
  e.aware = REFMAP[e.agent] ? REFMAP[e.agent].aware : '';
  e.dot = f.dot === '' ? '' : parseFloat(f.dot);
  e.doseG = f.doseG === '' ? '' : parseFloat(f.doseG);
  e.ddd = calcDDD(e.agent, e.doseG);
  e.verdict = verdict(e);
  e.id = newId();
  state.entries.push(e);
  state.form = blankForm();
  state.lastVerdict = '';
  persist();
  renderMain();
}

function removeEntry(id) {
  state.entries = state.entries.filter(e => String(e.id) !== String(id));
  persist();
  renderRegister();
}

function loadExamples() {
  const Y = 'Yes', N = 'No';
  const base = { date: '2026-06-01', ward: '', presc: '', sev: '', deElig: '', deDone: '', ivElig: '', ivDone: '', intMade: '', intAcc: '', notes: '', safety: N };
  CRIT.forEach(c => { base[c.key] = Y; });
  LAB_FIELDS.forEach(l => { base[l.key] = ''; });
  const mk = o => {
    const e = Object.assign({}, base, o);
    e.aware = REFMAP[e.agent].aware;
    e.ddd = calcDDD(e.agent, e.doseG);
    e.verdict = verdict(e);
    e.id = newId();
    return e;
  };
  const ex = [
    mk({ pid: 'case-01', ward: 'Surgical', agent: 'Cefazolin', synd: 'Skin / soft-tissue', sev: 'Mild', dot: 3, doseG: 9, ivElig: Y, ivDone: Y,
         pctVal: 'N/A', crpVal: '48', wbcVal: '13.1', neutVal: '82%', notes: 'PCT not obtained; CBC/CRP consistent with infection.' }),
    mk({ pid: 'case-02', ward: 'ICU', agent: 'Meropenem', synd: 'Pyelonephritis (sepsis)', sev: 'Severe', deesc: N, dot: 6, doseG: 18, deElig: Y, deDone: N, intMade: Y, intAcc: 'Pending',
         pctVal: '4.2', crpVal: '180', wbcVal: '17.5', neutVal: 'ANC 15.2', lactateVal: '2.1', notes: 'Labs strongly support sepsis; de-escalation pending culture.' }),
    mk({ pid: 'case-03', ward: 'Medical', agent: 'Levofloxacin', synd: 'Pyelonephritis', sev: 'Moderate', concordant: N, dot: 7, doseG: 3.5, deElig: Y, deDone: Y, ivElig: Y, ivDone: N, intMade: Y, intAcc: Y,
         pctVal: '0.6', crpVal: '70', wbcVal: '11.2', neutVal: '78%' }),
    mk({ pid: 'case-04', ward: 'Ortho', agent: 'Vancomycin', synd: 'Septic arthritis', sev: 'Severe', safety: Y, dot: 3, doseG: 6, intMade: Y, intAcc: Y,
         pctVal: '8.0', crpVal: '220', wbcVal: '19.0', lactateVal: '3.4' })
  ];
  state.entries = state.entries.concat(ex);
  // suggest denominators for the demo, but never overwrite values the user typed
  state.dash = Object.assign({}, state.dash, {
    ptdays: state.dash.ptdays || 30,
    beddays: state.dash.beddays || 30
  });
  state.view = 'dash';
  persist();
  paintTabs();
  renderMain();
}

/* — CSV — */

function buildCSV(entries) {
  const cell = v => {
    v = (v == null ? '' : String(v));
    // neutralise spreadsheet formula injection (=, +, -, @, tab, CR at cell start);
    // the leading apostrophe is stripped again on import so data round-trips
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const header = EXPORT_FIELDS.map(f => f[1]).concat(DERIVED_FIELDS.map(f => f[1]));
  const lines = [header.map(cell).join(',')];
  entries.forEach(e => {
    const base = EXPORT_FIELDS.map(f => cell(e[f[0]]));
    const derived = [
      cell(e.verdict ? whyFail(e, e.verdict) : ''),
      cell(coreFailedLabels(e).join('; ')),
      cell(minorFailedCount(e))
    ];
    lines.push(base.concat(derived).join(','));
  });
  return '﻿' + lines.join('\r\n'); // leading BOM so Excel reads UTF-8
}

function exportCSV() {
  if (!state.entries.length) { alert('Nothing to export yet.'); return; }
  const blob = new Blob([buildCSV(state.entries)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'DebugRx_register_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);   // some browsers require the link in the DOM to trigger the download
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); out.push(row); row = []; cur = '';
      } else cur += c;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out.filter(r => r.length > 1 || r[0] !== '');
}

function importCSVFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const rows = parseCSV(rd.result);
      if (!rows.length) { alert('That file appears to be empty.'); return; }
      const hdr = rows.shift().map(h => (IMPORT_MAP[String(h).trim().toLowerCase()] || null));
      if (!hdr.some(k => k)) { alert('No recognisable columns found. Make sure the CSV was exported from DebugRx.'); return; }
      const add = rows.map(r => {
        const o = {};
        hdr.forEach((key, i) => {
          if (!key) return;
          let v = r[i] == null ? '' : r[i];
          if (/^'[=+\-@\t\r]/.test(v)) v = v.slice(1); // undo export's formula-injection guard
          o[key] = v;
        });
        CRIT.forEach(c => { if (o[c.key] == null) o[c.key] = ''; });
        LAB_FIELDS.forEach(l => { if (o[l.key] == null) o[l.key] = ''; });
        ['dot', 'doseG', 'ddd'].forEach(k => {
          o[k] = (o[k] === '' || o[k] == null) ? '' : parseFloat(o[k]);
          if (isNaN(o[k])) o[k] = '';
        });
        // recompute everything derivable, so rows edited in a spreadsheet
        // can never carry a stale verdict, AWaRe class or DDD into the KPIs
        if (REFMAP[o.agent]) o.aware = REFMAP[o.agent].aware;
        const ddd = calcDDD(o.agent, o.doseG);
        if (ddd !== '') o.ddd = ddd;
        o.verdict = verdict(o);
        o.id = newId();
        return o;
      });
      if (!add.length) { alert('No data rows found in that CSV — only a header.'); return; }
      state.entries = state.entries.concat(add);
      persist();
      renderMain();
      alert('Imported ' + add.length + ' row' + (add.length > 1 ? 's' : '') + '. Verdicts, AWaRe classes and DDDs were recomputed from the scored domains.');
    } catch (err) {
      alert('Could not read that CSV. Make sure it was exported from DebugRx.');
    }
  };
  rd.onerror = () => alert('Could not read that file — it may be locked or unreadable.');
  rd.readAsText(file);
}

/* ═══════════════ render root ═══════════════ */

function paintTabs() {
  document.getElementById('tab-review').classList.toggle('active', state.view === 'review');
  document.getElementById('tab-dash').classList.toggle('active', state.view === 'dash');
}

function renderMain() {
  const main = document.getElementById('main');
  if (state.view === 'review') {
    main.innerHTML = reviewHtml();
    paintSegs();
    updateAwareTag();
    updateVerdict();
    renderRegister();
    updateStorageTag();
  } else {
    main.innerHTML = dashHtml();
  }
}

/* ═══════════════ events ═══════════════ */

document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;

  if (a === 'go-review') { state.view = 'review'; paintTabs(); renderMain(); }
  else if (a === 'go-dash') { state.view = 'dash'; paintTabs(); renderMain(); }
  else if (a === 'seg') {
    const k = t.dataset.key, v = t.dataset.val;
    state.form[k] = state.form[k] === v ? '' : v;
    paintSegs();
    updateVerdict();
  }
  else if (a === 'add-entry') addEntry();
  else if (a === 'load-examples') loadExamples();
  else if (a === 'import') document.getElementById('file-input').click();
  else if (a === 'export') exportCSV();
  else if (a === 'clear-all') { if (state.entries.length) { state.dialog = { type: 'clear' }; renderDialog(); } }
  else if (a === 'confirm-clear') {
    state.entries = []; state.dashFilter = null; state.dialog = null;
    persist(); renderDialog(); renderMain();
  }
  else if (a === 'row-open') {
    const e = state.entries.find(x => String(x.id) === String(t.dataset.id));
    if (e) { state.dialog = { type: 'detail', entry: e }; renderDialog(); }
  }
  else if (a === 'row-del') { removeEntry(t.dataset.id); }
  else if (a === 'clear-filter') { ev.preventDefault(); state.dashFilter = null; renderRegister(); }
  else if (a === 'bar') {
    if (parseInt(t.dataset.count, 10) > 0) {
      state.dashFilter = { kind: t.dataset.kind, value: t.dataset.value };
      state.view = 'review';
      paintTabs();
      renderMain();
    }
  }
  else if (a === 'dialog-close') { state.dialog = null; renderDialog(); }
  else if (a === 'noop') { /* swallow clicks inside the dialog */ }
  else if (a === 'storage-open') { state.dialog = { type: 'storage' }; renderDialog(); }
  else if (a === 'set-save' || a === 'consent-save') { setConsent('save'); state.dialog = null; renderDialog(); }
  else if (a === 'set-session' || a === 'consent-session') { setConsent('session'); state.dialog = null; renderDialog(); }
});

document.addEventListener('input', ev => {
  const f = ev.target.dataset.field;
  if (f !== undefined) {
    state.form[f] = ev.target.value;
    if (f === 'agent') updateAwareTag();
    updateVerdict();
    return;
  }
  const d = ev.target.dataset.dash;
  if (d !== undefined) {
    state.dash[d] = ev.target.value;
    persist();
    const grid = document.getElementById('kpi-grid');
    if (grid) grid.innerHTML = kpiGridHtml();
  }
});

document.getElementById('file-input').addEventListener('change', ev => {
  const file = ev.target.files[0];
  if (file) importCSVFile(file);
  ev.target.value = '';
});

document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && state.dialog) { state.dialog = null; renderDialog(); return; }

  // keep Tab inside an open dialog
  if (ev.key === 'Tab' && state.dialog) {
    const focusables = document.querySelectorAll('.dialog button, .dialog a[href], .dialog input, .dialog select, .dialog textarea');
    if (focusables.length) {
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (ev.shiftKey && (document.activeElement === first || document.activeElement.classList.contains('dialog'))) {
        ev.preventDefault(); last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault(); first.focus();
      }
    }
    return;
  }

  // Enter/Space activate keyboard-focusable rows and chart bars
  if (ev.key === 'Enter' || ev.key === ' ') {
    const t = ev.target.closest && ev.target.closest('[data-action="row-open"], [data-action="bar"]');
    if (t && t === ev.target) { ev.preventDefault(); t.click(); }
  }
});

/* ═══════════════ boot ═══════════════ */

paintTabs();
renderMain();
renderBanner();
updateStorageTag();
