import './style.css';
import { qwertyFromCode } from '@autohan0/engine/keymap';
import type { Engine, EngineEvent, EngineResult, Lang, LearnedEntry } from '@autohan0/engine';

type EngineModule = typeof import('@autohan0/engine');

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const editor = $('editor');
const badge = $('mode');
const modeLabel = $('mode-label');
const layoutSelect = $<HTMLSelectElement>('layout');
const traceBox = $('trace');
const hint = $('hint');
const timing = $('timing');
const learnedList = $('learned-list');
const learnedCount = $('learned-count');

const LEARNED_KEY = 'autohan0.learned';
const LAYOUT_KEY = 'autohan0.layout';
const HINT_TEXT = hint.innerHTML;

let mod: EngineModule | null = null;
let engine: Engine | null = null;
let result: EngineResult | null = null;
let initMs = 0;
let keyCount = 0;
let keyMs = 0;
let replayTimer: number | null = null;

interface Chip {
  label: string;
  sub?: string;
  kind: 'en' | 'ko' | 'ctl';
}
const trace: Chip[] = [];

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode etc. */
  }
}

function loadLearned(): LearnedEntry[] {
  try {
    const v = JSON.parse(storageGet(LEARNED_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function init(): Promise<void> {
  hint.textContent = '단어 목록을 불러오는 중…';
  mod = await import('@autohan0/engine');
  const saved = storageGet(LAYOUT_KEY);
  if (saved && mod.availableLayouts().some((l) => l.id === saved)) layoutSelect.value = saved;
  const t0 = performance.now();
  engine = new mod.Engine({ mode: 'en', layout: layoutSelect.value, learned: loadLearned() });
  initMs = performance.now() - t0;
  hint.innerHTML = HINT_TEXT;
  result = engine.process({ type: 'reset' });
  render();
  renderLearned();
  renderTiming();
}

// ---- input ---------------------------------------------------------------

function eventFromKeyboard(e: KeyboardEvent): { ev: EngineEvent; chip: Chip } | null {
  if (e.code === 'Lang1' || e.key === 'HangulMode' || e.key === 'Lang1' || (e.code === 'Space' && e.shiftKey)) {
    return { ev: { type: 'toggle' }, chip: { label: '한/영', kind: 'ctl' } };
  }
  switch (e.code) {
    case 'Space':
      return { ev: { type: 'space' }, chip: { label: '␣', kind: 'ctl' } };
    case 'Enter':
    case 'NumpadEnter':
      return { ev: { type: 'enter' }, chip: { label: '⏎', kind: 'ctl' } };
    case 'Backspace':
      return { ev: { type: 'backspace' }, chip: { label: '⌫', kind: 'ctl' } };
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown':
    case 'Home':
    case 'End':
      return { ev: { type: 'commit' }, chip: { label: '커서 이동', kind: 'ctl' } };
  }
  let shift = e.shiftKey;
  // Caps Lock flips letters only, like a US QWERTY layout.
  if (/^Key[A-Z]$/.test(e.code) && e.getModifierState && e.getModifierState('CapsLock')) shift = !shift;
  let ch = qwertyFromCode(e.code, shift);
  // Some virtual keyboards / automation send no physical code: fall back to the
  // character itself when it is printable ASCII (OS input source = ABC).
  if (!ch && !e.code && e.key.length === 1 && e.key >= '!' && e.key <= '~') ch = e.key;
  if (!ch) return null;
  return { ev: { type: 'key', ch }, chip: { label: ch, kind: 'en' } };
}

function apply(ev: EngineEvent, chip: Chip | null): void {
  if (!engine || !mod) return;
  const before = engine.getMode();
  const t0 = performance.now();
  result = engine.process(ev, performance.now());
  const dt = performance.now() - t0;
  if (ev.type === 'key') {
    keyCount++;
    keyMs += dt;
  }
  if (chip) {
    if (ev.type === 'key') {
      const v = mod.getLayout(engine.layoutId).value(ev.ch);
      chip.sub = mod.toCompat(v);
      chip.kind = result.mode === 'ko' ? 'ko' : 'en';
    }
    trace.push(chip);
    if (trace.length > 28) trace.splice(0, trace.length - 28);
  }
  render(before !== result.mode);
  if (ev.type === 'toggle') renderLearned();
  renderTiming();
}

editor.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) {
    e.preventDefault();
    hint.classList.add('warn');
    hint.textContent = '한글 입력기가 켜져 있어요. OS 입력 소스를 영어(ABC)로 바꿔 주세요.';
    return;
  }
  if (e.metaKey || e.ctrlKey || (e.altKey && e.code !== 'AltRight')) return;
  if (e.code === 'Escape') {
    editor.blur();
    return;
  }
  const m = eventFromKeyboard(e);
  if (!m) return;
  e.preventDefault();
  cancelReplay();
  if (hint.classList.contains('warn')) {
    hint.classList.remove('warn');
    hint.innerHTML = HINT_TEXT;
  }
  apply(m.ev, m.chip);
});

// A click moves the caret in a real editor: freeze what is there.
editor.addEventListener('mousedown', () => {
  if (engine && result && result.text) apply({ type: 'commit' }, null);
});

$('toggle').addEventListener('click', () => {
  apply({ type: 'toggle' }, { label: '한/영', kind: 'ctl' });
  editor.focus();
});

$('clear').addEventListener('click', () => {
  cancelReplay();
  trace.length = 0;
  apply({ type: 'reset' }, null);
  editor.focus();
});

layoutSelect.addEventListener('change', () => {
  if (!engine) return;
  storageSet(LAYOUT_KEY, layoutSelect.value);
  result = engine.setLayout(layoutSelect.value);
  trace.push({ label: layoutSelect.selectedOptions[0].textContent || layoutSelect.value, kind: 'ctl' });
  render();
  editor.focus();
});

// Example buttons replay key sequences through the engine.
for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('.ex'))) {
  btn.addEventListener('click', () => {
    if (!engine) return;
    cancelReplay();
    trace.length = 0;
    apply({ type: 'reset' }, null);
    result = engine.setMode((btn.dataset.mode as Lang) || 'en');
    render(true);
    const keys = Array.from(btn.dataset.keys || '');
    let i = 0;
    editor.focus();
    replayTimer = window.setInterval(() => {
      if (i >= keys.length) {
        cancelReplay();
        return;
      }
      const ch = keys[i++];
      if (ch === ' ') apply({ type: 'space' }, { label: '␣', kind: 'ctl' });
      else apply({ type: 'key', ch }, { label: ch, kind: 'en' });
    }, 140);
  });
}

function cancelReplay(): void {
  if (replayTimer !== null) {
    clearInterval(replayTimer);
    replayTimer = null;
  }
}

// ---- output --------------------------------------------------------------

function render(modeChanged = false): void {
  if (!result) return;
  const r = result;
  const frag = document.createDocumentFragment();
  const cps = Array.from(r.text);
  const frozen = cps.slice(0, r.committedLength).join('');
  if (frozen) {
    const s = document.createElement('span');
    s.className = 'frozen';
    s.textContent = frozen;
    frag.appendChild(s);
  }
  for (const w of r.words) {
    const s = document.createElement('span');
    s.className = 'w' + (w.held ? ' held' : w.changed ? ' changed' : w.locked ? ' locked' : '');
    s.textContent = w.text;
    if (w.held) s.title = '보류: 다음 단어를 보고 정해요';
    else if (w.changed) s.title = `자동으로 고침 (친 키: ${w.keys})`;
    frag.appendChild(s);
    if (w.sep) frag.appendChild(document.createTextNode(w.sep));
  }
  if (!r.text && document.activeElement !== editor) {
    const p = document.createElement('span');
    p.className = 'placeholder';
    p.textContent = '여기를 누르고 쳐 보세요…';
    frag.appendChild(p);
  }
  const caret = document.createElement('span');
  caret.className = 'caret';
  frag.appendChild(caret);
  editor.replaceChildren(frag);
  editor.setAttribute('aria-label', `입력칸: ${r.text || '비어 있음'}`);

  badge.textContent = r.mode === 'ko' ? '가' : 'A';
  modeLabel.textContent = r.mode === 'ko' ? '한글 상태' : '영어 상태';
  if (modeChanged) {
    badge.classList.add('flip');
    window.setTimeout(() => badge.classList.remove('flip'), 140);
  }

  traceBox.replaceChildren(
    ...trace.map((c) => {
      const el = document.createElement('span');
      el.className = `chip ${c.kind}`;
      el.textContent = c.label;
      if (c.sub && c.sub !== c.label) {
        const sm = document.createElement('small');
        sm.textContent = c.sub;
        el.appendChild(sm);
      }
      return el;
    }),
  );
}

function renderTiming(): void {
  const parts = [`준비 ${initMs.toFixed(0)}ms`];
  // Browsers coarsen performance.now(), so only the running average is meaningful.
  if (keyCount) parts.push(`키당 판단 평균 ${((keyMs / keyCount) * 1000).toFixed(0)}µs (${keyCount}키)`);
  timing.textContent = parts.join(' · ');
}

function renderLearned(): void {
  if (!engine) return;
  const items = engine.learnedWords();
  storageSet(LEARNED_KEY, JSON.stringify(items));
  learnedCount.textContent = String(items.length);
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '아직 없어요.';
    learnedList.replaceChildren(li);
    return;
  }
  learnedList.replaceChildren(
    ...items.map((e) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      const code = document.createElement('code');
      code.textContent = e.text;
      label.append(code, ` ${e.mode === 'en' ? '영어 상태' : '한글 상태'}에서 그대로 둠`);
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '삭제';
      del.addEventListener('click', () => {
        engine?.forgetLearned(e.keys, e.mode);
        renderLearned();
      });
      li.append(label, del);
      return li;
    }),
  );
}

editor.addEventListener('focus', () => render());
editor.addEventListener('blur', () => render());

void init();
