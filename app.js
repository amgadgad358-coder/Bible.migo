let bibleData = null;
let currentTestament = 'old';
let currentBook = null;
let currentChapter = 1;
let favorites = JSON.parse(localStorage.getItem('bible_favorites') || '[]');
let fontScale = Math.max(10, Math.min(200, parseInt(localStorage.getItem('bible_font_scale') || '100', 10)));
let readingFontScale = Math.max(10, Math.min(200, parseInt(localStorage.getItem('reading_font_scale') || '100', 10)));
let appFontFamily = localStorage.getItem('app_font_family') || 'Cairo';
let tileScale = Math.max(0.75, Math.min(1.15, parseFloat(localStorage.getItem('app_tile_scale') || '1')));
if (!Number.isFinite(readingFontScale)) readingFontScale = 100;
if (!['Cairo', 'Amiri'].includes(appFontFamily)) appFontFamily = 'Cairo';
if (!Number.isFinite(tileScale)) tileScale = 1;
let isDark = localStorage.getItem('bible_dark') === 'true';

let isSpeaking = false;
let currentAudio = null;
let currentVerseIndex = 0;
let totalSpeechTime = 0;
let elapsedSpeechTime = 0;
let speechTimer = null;
let wordsList = [];
let totalWords = 0;
let allVersesText = [];
let isDragging = false;

function showScreen(screenId, fromHistory=false) {
  const target = document.getElementById(screenId);
  if (!target) return;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  target.classList.add('active');
  if (!fromHistory) {
    try {
      if (!history.state || history.state.screen !== screenId) {
        history.pushState({ appScreen: true, screen: screenId }, '', '#'+screenId);
      }
    } catch (e) {}
  }
  window.scrollTo(0, 0);
}

(function initAppBackNavigation(){
  if (!history.state || !history.state.appScreen) {
    try { history.replaceState({ appScreen: true, screen: 'home-screen' }, '', location.pathname + location.search); } catch(e) {}
  }
  window.addEventListener('popstate', function(event){
    const screen = event.state && event.state.appScreen && event.state.screen;
    if (screen && document.getElementById(screen)) {
      showScreen(screen, true);
    } else {
      showScreen('home-screen', true);
      try { history.pushState({ appScreen: true, screen: 'home-screen' }, '', '#home-screen'); } catch(e) {}
    }
  });
})();

function goHome() {
  stopSpeaking();
  showScreen('home-screen');
}

function showSearch() {
  showScreen('search-screen');
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  if (results) results.innerHTML = '';
  if (input) {
    input.focus();
  }
}

function openBibleMenu() {
  showScreen('bible-menu-screen');
}

const COPTIC_API = 'https://api.coptic.io/api';

const agpeyaPrayers = [
  {id:'matins', icon:'🌅', title:'صلاة باكر', subtitle:'صلاة الساعة الأولى', pages:20},
  {id:'third', icon:'☀️', title:'صلاة الساعة الثالثة', subtitle:'صلاة الساعة الثالثة', pages:12},
  {id:'sixth', icon:'🌤️', title:'صلاة الساعة السادسة', subtitle:'صلاة الساعة السادسة', pages:12},
  {id:'ninth', icon:'🌇', title:'صلاة الساعة التاسعة', subtitle:'صلاة الساعة التاسعة', pages:12},
  {id:'vespers', icon:'🌆', title:'صلاة الغروب', subtitle:'صلاة الساعة الحادية عشرة', pages:10},
  {id:'compline', icon:'🌙', title:'صلاة النوم', subtitle:'صلاة الساعة الثانية عشرة', pages:13},
  {id:'midnight', icon:'🌌', title:'صلاة نصف الليل', subtitle:'تسبحة نصف الليل', pages:35},
  {id:'sattar', icon:'🕊️', title:'صلاة الستار', subtitle:'صلاة الستار', pages:21}
];

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function stripHtml(value) {
  const div = document.createElement('div');
  div.innerHTML = String(value ?? '');
  return div.textContent || div.innerText || '';
}

function looksArabic(text) {
  return /[\u0600-\u06FF]/.test(String(text || ''));
}

function formatAnyText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return stripHtml(value).trim();
  if (Array.isArray(value)) return value.map(formatAnyText).filter(Boolean).join('\n\n');
  if (typeof value === 'object') {
    const preferred = ['ar','arabic','text_ar','arabicText','title_ar','description_ar','content_ar','name_ar'];
    for (const key of preferred) {
      if (value[key]) {
        const t = formatAnyText(value[key]);
        if (t && looksArabic(t)) return t;
      }
    }
    const keys = Object.keys(value);
    const pieces = [];
    for (const key of keys) {
      if (['id','date','gregorian_date','coptic_date','language','slug','url'].includes(key)) continue;
      const t = formatAnyText(value[key]);
      if (t && !pieces.includes(t)) pieces.push(t);
    }
    return pieces.join('\n\n');
  }
  return '';
}

async function fetchJson(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {cache:'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error('فشل الاتصال');
}

function showOnlineError(containerId, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="online-error"><div class="online-error-icon">📡</div><h3>تعذر تحميل المحتوى</h3><p>${escapeHtml(message)}</p><button type="button" onclick="location.reload()">إعادة المحاولة</button></div>`;
}

function openAgpeya() {
  showScreen('agpeya-screen');
  const list = document.getElementById('agpeya-list');
  if (!list) return;
  list.innerHTML = agpeyaPrayers.map((p, i) => `
    <button class="prayer-card" type="button" onclick="openPrayer('${p.id}')">
      <span class="prayer-index">${String(i + 1).padStart(2, '0')}</span>
      <span class="prayer-icon">${p.icon}</span>
      <span class="prayer-info"><strong>${p.title}</strong><small>${p.subtitle}</small></span>
      <span class="prayer-arrow">‹</span>
    </button>
  `).join('');
}

async function fetchText(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {cache:'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error('فشل الاتصال');
}

function htmlToReadableText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  ['script','style','noscript','nav','header','footer','form'].forEach(sel => doc.querySelectorAll(sel).forEach(x => x.remove()));
  return (doc.body?.innerText || doc.body?.textContent || '').replace(/\u00a0/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}

function cleanArabicLines(text) {
  return String(text || '').split('\n').map(x => x.trim()).filter(x => x && !/^(محتويات|المحتوى|فهرس|إظهار|إخفاء|English|العربية|نسخ|حفظ|بحث)$/i.test(x));
}

function normalizePrayerText(text) {
  return String(text || '')
    .replace(/\r/g,'\n')
    .replace(/[\u200e\u200f\u202a-\u202e]/g,'')
    .replace(/\n{3,}/g,'\n\n')
    .split('\n')
    .map(x => x.trim())
    .filter(x => x)
    .join('\n');
}

function splitLocalPrayerSections(text, prayer) {
  const lines = normalizePrayerText(text).split('\n').map(x => x.trim()).filter(Boolean);
  const sections = [];
  let current = null;
  const headingPatterns = [
    /^مقدمة كل ساعة:?$/,
    /^الصلاة الربانية$/,
    /^صلاة الشكر$/,
    /^المزمور الخمسون$/,
    /^بدء الصلاة$/,
    /^بدء قانون الإيمان$/,
    /^قانون الإيمان المقدس الأرثوذكسي$/,
    /^قدوس قدوس قدوس$/,
    /^التحليل(?: الكبير)?(?: لنصف الليل)?$/,
    /^طلبة تصلى (?:آخر|أخر) كل ساعة$/,
    /^القطع$/,
    /^فصل من إنجيل/, 
    /^من إنجيل/, 
    /^(?:\(?\d+\)?\s*)?المزمور /,
    /^مز\s*\d+\s*:/,
    /^المزمور /,
    /^\(إنجيل /,
    /^الخدمة (الأولى|الثانية|الثالثة)$/,
    /^الصلاة كاملة$/
  ];
  const isHeading = line => headingPatterns.some(r => r.test(line)) ||
    (line.length < 55 && /^(صلاة|مقدمة|بدء|قانون|التحليل|البركة|القطع|الخدمة|فصل)/.test(line) && !/[،؛,:.!؟]$/.test(line));

  for (const line of lines) {
    if (isHeading(line)) {
      if (current && current.text.trim()) sections.push(current);
      current = {title: line.replace(/:$/,''), text:''};
    } else if (current) {
      current.text += (current.text ? '\n' : '') + line;
    } else {
      current = {title: prayer.title, text:line};
    }
  }
  if (current && current.text.trim()) sections.push(current);

  const grouped = [];
  for (const sec of sections) {
    const isPsalm = (/المزمور/.test(sec.title) || /^مز\s*\d+\s*:/.test(sec.title)) && !/الخمسون/.test(sec.title);
    if (isPsalm) {
      const last = grouped[grouped.length - 1];
      if (last && last.title === 'المزامير') last.text += '\n\n' + sec.title + '\n' + sec.text;
      else grouped.push({title:'المزامير', text:sec.title + '\n' + sec.text});
    } else {
      grouped.push(sec);
    }
  }
  const cleaned = grouped.filter(x => x.text && x.text.trim());
  if (cleaned.length) return cleaned;
  return [{title:prayer.title, text:normalizePrayerText(text)}];
}

function splitPsalms(text) {
  const lines = normalizePrayerText(text).split('\n').map(x => x.trim()).filter(Boolean);
  const out = [];
  let current = null;
  const heading = /^(?:\(\s*\d+\s*\)\s*)?(?:المزمور\s+(.+)|مز\s*(\d+)\s*:\s*(.*))$/;
  for (const line of lines) {
    const m = line.match(heading);
    if (m && line.length < 100) {
      if (current && current.text.trim()) out.push(current);
      let title = line.replace(/^\(\s*\d+\s*\)\s*/, '');
      if (/^مز\s*\d+\s*:/.test(title)) title = title.replace(/^مز\s*(\d+)\s*:\s*(.*)$/, 'المزمور $1: $2');
      current = { title, text: '' };
    } else if (current) {
      current.text += (current.text ? '\n' : '') + line;
    }
  }
  if (current && current.text.trim()) out.push(current);
  return out;
}

function getPsalmDisplayName(psalm) {
  return (psalm && psalm.title ? psalm.title : 'المزمور').replace(/\s+/g, ' ').trim();
}

function getPsalmPickerParts(psalm, index) {
  const title = getPsalmDisplayName(psalm);
  const match = title.match(/^(?:المزمور\s*)?(\d+)\s*[:：-]?\s*(.*)$/);
  if (match) return { number: match[1], name: (match[2] || '').trim() || `المزمور ${match[1]}` };
  return { number: String(index + 1), name: title.replace(/^المزمور\s*/, '').trim() || `المزمور ${index + 1}` };
}

function buildTextPicker(kind, items, selectedIndex, title) {
  const id = kind === 'psalm' ? 'psalm' : (kind === 'online-dox' ? 'online-dox' : (kind === 'gregorian' ? 'gregorian' : 'dox'));
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;
  return `
    <div class="psalm-picker-box refined-text-picker">
      <label>${escapeHtml(title)}</label>
      <button type="button" class="text-picker-trigger" onclick="openTextPicker('${id}')" aria-haspopup="dialog">
        <span class="text-picker-trigger-copy"><small>النص المحدد</small><strong id="${id}-selected-label">${escapeHtml(selected ? (selected.title || `${title} 1`) : `اختر ${title}`)}</strong></span>
        <span class="text-picker-trigger-icon">⌄</span>
      </button>
      <div class="text-picker-overlay" id="${id}-picker-overlay" onclick="closeTextPicker(event,'${id}')" aria-hidden="true">
        <section class="text-picker-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
          <div class="text-picker-head"><strong>اختر ${escapeHtml(title)}</strong><button type="button" onclick="closeTextPicker(null,'${id}')" aria-label="إغلاق">×</button></div>
          <div class="text-picker-list">
            ${items.map((item,i)=>{const ps=getPsalmPickerParts(item,i);const itemIndex=kind==='online-dox'?__onlineDoxologies.findIndex(x=>x.url===item.url):i;const active=kind==='online-dox'?itemIndex===window.__selectedOnlineDoxology:i===selectedIndex;return `<button type="button" data-index="${itemIndex}" class="text-picker-option ${active?'active':''}" onclick="chooseTextItem('${id}',${itemIndex})"><span class="text-picker-number">${escapeHtml(ps.number)}</span><span class="text-picker-option-copy"><strong>${kind==='psalm'?escapeHtml(ps.name):escapeHtml(item.title || `${title} ${i+1}`)}</strong></span><span class="text-picker-check">${active?'✓':''}</span></button>`;}).join('')}
          </div>
        </section>
      </div>
    </div>`;
}

function openTextPicker(kind) {
  const overlay=document.getElementById(`${kind}-picker-overlay`);
  if(!overlay) return;
  overlay.classList.add('show'); overlay.setAttribute('aria-hidden','false');
  document.body.classList.add('text-picker-open');
}
function closeTextPicker(event,kind) {
  if(event && event.target && event.target.id!==`${kind}-picker-overlay`) return;
  const overlay=document.getElementById(`${kind}-picker-overlay`);
  if(overlay){overlay.classList.remove('show');overlay.setAttribute('aria-hidden','true');}
  if(!document.querySelector('.text-picker-overlay.show')) document.body.classList.remove('text-picker-open');
}
function chooseTextItem(kind,index) {
  if(kind==='online-dox') {
    window.__selectedOnlineDoxology=index;
    showOnlineDoxology(index);
    const item=(window.__currentOnlineDoxologies||[])[index];
    const label=document.getElementById('online-dox-selected-label');
    if(label && item) label.textContent=item.title || `ذكصولوجية ${index+1}`;
    document.querySelectorAll('#online-dox-picker-overlay .text-picker-option').forEach(el=>{const active=Number(el.dataset.index)===index;el.classList.toggle('active',active);const check=el.querySelector('.text-picker-check');if(check)check.textContent=active?'✓':'';});
  } else if(kind==='gregorian') {
    selectedGregorianPart=index;
    selectedGregorianLanguage='arabic';
    renderGregorianParts();
    if(selectedGregorianPart>=0 && !gregorianParts[selectedGregorianPart].text) loadSelectedGregorianPart(false);
  } else if(kind==='psalm') {
    showPsalm(index);
    const item=(window.__currentPsalms||[])[index];
    const label=document.getElementById('psalm-selected-label');
    if(label && item) label.textContent=getPsalmDisplayName(item);
    const list=document.querySelectorAll('#psalm-picker-overlay .text-picker-option');
    list.forEach((el,i)=>{el.classList.toggle('active',i===index);el.querySelector('.text-picker-check').textContent=i===index?'✓':'';});
  } else {
    window.__selectedDoxology=index;
    const item=(window.__currentDoxologies||[])[index];
    const label=document.getElementById('dox-selected-label');
    if(label && item) label.textContent=item.title || `ذكصولوجية ${index+1}`;
    renderSelectedDoxology(index);
    const list=document.querySelectorAll('#dox-picker-overlay .text-picker-option');
    list.forEach((el,i)=>{el.classList.toggle('active',i===index);el.querySelector('.text-picker-check').textContent=i===index?'✓':'';});
  }
  closeTextPicker(null,kind);
}

function renderPsalmPart(part) {
  const view = document.getElementById('prayer-part-view');
  if (!view) return;
  const psalms = splitPsalms(part.text);
  window.__currentPsalms = psalms;
  window.__selectedPsalm = 0;
  view.classList.remove('prayer-part-empty');
  if (!psalms.length) {
    view.innerHTML = `<div class="prayer-section-title">المزامير</div><div class="prayer-section-body">لا توجد مزامير منظمة في هذا الجزء.</div>`;
    return;
  }
  view.innerHTML = `<div class="prayer-section-title">المزامير</div>${buildTextPicker('psalm',psalms,0,'المزمور')}<div id="selected-psalm-view" class="selected-psalm-view"></div>`;
  showPsalm(0);
}

function showPsalm(index) {
  const psalms = window.__currentPsalms || [];
  const item = psalms[index];
  if (!item) return;
  window.__selectedPsalm = index;
  const view = document.getElementById('selected-psalm-view');
  if (!view) return;
  view.innerHTML = `<div class="prayer-section-title">${escapeHtml(getPsalmDisplayName(item))}</div><div class="prayer-section-body">${escapeHtml(item.text).replace(/\n/g,'<br>')}</div>`;
}

function renderLocalPrayerPart(part) {
  const view = document.getElementById('prayer-part-view');
  if (!view) return;
  if (part && part.title === 'المزامير') {
    renderPsalmPart(part);
    return;
  }
  window.__currentPsalms = [];
  window.__selectedPsalm = -1;
  view.classList.remove('prayer-part-empty');
  const body = escapeHtml(part.text).replace(/\n/g,'<br>');
  view.innerHTML = `<div class="prayer-section-title">${escapeHtml(part.title)}</div><div class="prayer-section-body">${body}</div>`;
}

function renderLocalPrayer(prayer) {
  const root = document.getElementById('prayer-content');
  if (!root) return;
  const raw = (window.AGPEYA_TEXT && window.AGPEYA_TEXT[prayer.id]) ? window.AGPEYA_TEXT[prayer.id] : '';
  const parts = raw.trim() ? splitLocalPrayerSections(raw, prayer) : [{title: prayer.title, text: 'تعذر العثور على نص هذه الصلاة داخل التطبيق.'}];
  root.innerHTML = `
    <div class="prayer-card-large online-prayer-card local-prayer-card">
      <div class="prayer-big-icon">${prayer.icon}</div>
      <h2>${escapeHtml(prayer.title)}</h2>
      <p class="local-prayer-note">النص محفوظ داخل التطبيق ويعمل بدون إنترنت.</p>
      <button type="button" class="prayer-selector-btn" onclick="togglePrayerPicker()" aria-expanded="false">
        <span id="selected-prayer-label">${escapeHtml(parts[0]?.title || "أول جزء")}</span>
        <span class="prayer-selector-arrow">⌄</span>
      </button>
      <div id="prayer-part-view" class="prayer-part-view prayer-part-empty"></div>
    </div>
    <div id="prayer-picker-overlay" class="prayer-picker-overlay" onclick="closePrayerPicker(event)" aria-hidden="true">
      <div class="prayer-picker" role="dialog" aria-modal="true" aria-label="اختيار جزء الصلاة" onclick="event.stopPropagation()">
        <div class="prayer-picker-head">
          <strong>اختر جزء الصلاة</strong>
          <button type="button" onclick="togglePrayerPicker()" aria-label="إغلاق">×</button>
        </div>
        <div class="prayer-choice-list" role="listbox">
          ${parts.map((s,i) => `<button type="button" class="prayer-choice" role="option" onclick="showPrayerPart(${i})">${escapeHtml(s.title)}</button>`).join('')}
        </div>
      </div>
    </div>`;
  window.__currentPrayer = prayer;
  window.__currentPrayerParts = parts;
  window.__selectedPrayerPart = -1;
  if (parts.length) showPrayerPart(0);
}
function togglePrayerPicker() {
  const overlay = document.getElementById('prayer-picker-overlay');
  const button = document.querySelector('.prayer-selector-btn');
  if (!overlay) return;
  const opening = !overlay.classList.contains('show');
  overlay.classList.toggle('show', opening);
  overlay.setAttribute('aria-hidden', opening ? 'false' : 'true');
  if (button) button.setAttribute('aria-expanded', opening ? 'true' : 'false');
  document.body.classList.toggle('prayer-picker-open', opening);
}

function closePrayerPicker(event) {
  if (event && event.target && event.target.id !== 'prayer-picker-overlay') return;
  const overlay = document.getElementById('prayer-picker-overlay');
  const button = document.querySelector('.prayer-selector-btn');
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  if (button) button.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('prayer-picker-open');
}

function showPrayerPart(index, smooth=true) {
  const items = window.__currentPrayerParts || [];
  const item = items[index];
  if (!item) return;
  const label = document.getElementById('selected-prayer-label');
  if (label) label.textContent = item.title;
  window.__selectedPrayerPart = index;
  renderLocalPrayerPart(item);
  closePrayerPicker();
  const view = document.getElementById('prayer-part-view');
  if (smooth && view) view.scrollIntoView({behavior:'smooth',block:'start'});
}

function openPrayer(id) {
  const prayer = agpeyaPrayers.find(p => p.id === id) || agpeyaPrayers[0];
  document.getElementById('prayer-title').textContent = prayer.title;
  showScreen('prayer-screen');
  renderLocalPrayer(prayer);
}

function copticTodayLabel(dateISO) {
  const d = new Date(dateISO + 'T12:00:00');
  const sep11 = new Date(d.getFullYear(), 8, 11, 12);
  if (d >= sep11 && d < new Date(d.getFullYear(), 9, 10, 12)) {
    const day = Math.floor((d - sep11) / 86400000) + 1;
    const copticYear = d.getFullYear() - 283;
    return `${day} توت ${copticYear} للشهداء`;
  }
  return '';
}

async function openKatameros() {
  showScreen('katameros-screen');
  const date = todayISO();
  const copticLabel = copticTodayLabel(date);
  const dateEl = document.getElementById('katameros-date');
  const root = document.getElementById('katameros-content');
  if (dateEl) dateEl.textContent = copticLabel || 'قراءات اليوم';
  if (root) root.innerHTML = '<div class="loading-card">جاري تحميل القطمارس بالعربية…</div>';
  renderKatExtras('all');

  const [year, month, day] = date.split('-');
  const source = `https://r.jina.ai/https://readings.elmaqar.org/readings/index.php?Itemid=2&option=com_reading&iday=${day}&imonth=${month}&iyear=${year}`;

  try {
    const html = await fetchText([source]);
    const ok = renderElmaqarKatameros(html);
    if (!ok) throw new Error('لم يتم العثور على قراءات القطمارس في الصفحة');
  } catch (e) {
    console.warn('Katameros load failed', e);
    showOnlineError('katameros-content', 'تعذر تحميل القطمارس الآن. تأكد من الإنترنت ثم اضغط إعادة المحاولة.');
  }
}

function renderElmaqarKatameros(html) {
  const raw = htmlToReadableText(html)
    .replace(/\r/g, '\n')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/\u00a0/g, ' ');
  const lines = raw.split('\n').map(x => x.trim()).filter(Boolean);

  const aliases = {
    'مزمور العشية':'مزمور العشية','مزمور عشية':'مزمور العشية',
    'إنجيل العشية':'إنجيل العشية','انجيل العشية':'إنجيل العشية','إنجيل عشية':'إنجيل العشية','انجيل عشية':'إنجيل العشية',
    'مزمور باكر':'مزمور باكر','مزمو باكر':'مزمور باكر','مزمور باكر':'مزمور باكر',
    'إنجيل باكر':'إنجيل باكر','انجيل باكر':'إنجيل باكر',
    'مزمور القداس':'مزمور القداس','إنجيل القداس':'إنجيل القداس','انجيل القداس':'إنجيل القداس',
    'البولس':'البولس','الكاثوليكون':'الكاثوليكون','أعمال الرسل':'الإبركسيس','الإبركسيس':'الإبركسيس','الابركسيس':'الإبركسيس'
  };
  const order = ['مقدمة العشية','مزمور العشية','إنجيل العشية','مقدمة باكر','مزمور باكر','إنجيل باكر','البولس','الكاثوليكون','الإبركسيس','مقدمة القداس','مزمور القداس','إنجيل القداس'];
  const parts = [];
  let service = '';
  let current = null;
  let inSynaxarium = false;

  const push = () => {
    if (!current) return;
    const text = current.text.trim();
    if (text.length > 1) parts.push({title: current.title, text});
    current = null;
  };
  const introFor = s => s === 'vespers' ? 'مقدمة العشية' : s === 'matins' ? 'مقدمة باكر' : 'مقدمة القداس';
  const setSection = line => {
    if (line === 'العشية') return 'vespers';
    if (line === 'باكر') return 'matins';
    if (line === 'قراءات القداس' || line === 'القداس' || line === 'القداس الإلهي') return 'liturgy';
    return '';
  };
  const titleFor = line => {
    if (aliases[line]) return aliases[line];
    if (line === 'مزمور' || line === 'المزمور') return service === 'vespers' ? 'مزمور العشية' : service === 'matins' ? 'مزمور باكر' : 'مزمور القداس';
    if (line === 'إنجيل' || line === 'الإنجيل') return service === 'vespers' ? 'إنجيل العشية' : service === 'matins' ? 'إنجيل باكر' : 'إنجيل القداس';
    return '';
  };

  for (const line0 of lines) {
    const line = line0.replace(/^#+\s*/, '').trim();
    if (!line) continue;

    if (/^(السنكسار|سنكسار|السنكسار اليومي|سنكسار اليومي)$/.test(line)) {
      push();
      inSynaxarium = true;
      continue;
    }
    if (inSynaxarium) {
      if (/^(القداس الإلهي|القداس|قراءات القداس)$/.test(line)) {
        inSynaxarium = false;
        service = 'liturgy';
        current = {title:'مقدمة القداس', text:''};
      }
      continue;
    }

    const section = setSection(line);
    if (section) {
      push();
      service = section;
      current = {title:introFor(service), text:''};
      continue;
    }

    const title = titleFor(line);
    if (title) {
      push();
      current = {title, text:''};
      continue;
    }

    if (/^(View in Arabic text|القراءات اليومية|Prev\. day|Next day|اختيار|السابق|التالي|أعلى الصفحة|Acknowledgement|Readings - AR|Readings - EN)$/i.test(line)) continue;
    if (/^\*+$/.test(line)) continue;
    if (/^قراءات\s+/.test(line) && !/القداس/.test(line)) continue;

    if (current) current.text += (current.text ? '\n' : '') + line;
  }
  push();

  const seen = new Set();
  const clean = parts.filter(p => {
    if (!p.text || seen.has(p.title)) return false;
    seen.add(p.title);
    return true;
  });

  const finalParts = order.map(t => clean.find(p => p.title === t)).filter(Boolean);
  if (!finalParts.some(p => p.title === 'مزمور العشية') ||
      !finalParts.some(p => p.title === 'إنجيل العشية') ||
      !finalParts.some(p => p.title === 'مزمور القداس') ||
      !finalParts.some(p => p.title === 'إنجيل القداس')) return false;

  renderKatamerosParts(finalParts);
  return true;
}

function normalizeReadingLabel(t) {
  return String(t || '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g,'')
    .replace(/\s+/g,' ')
    .trim()
    .replace(/^مزمور\s+$/,'مزمور')
    .replace(/^مزمر\b/,'مزمور')
    .replace(/^الابركسيس$/,'الإبركسيس');
}

function katamerosStructuredParts(lines) {
  const clean = lines.map(x => normalizeReadingLabel(x)).filter(Boolean);
  const labels = [
    'العشية','باكر','القداس','القداس الإلهي',
    'مزمور','المزمور','إنجيل','الإنجيل',
    'مزمور العشية','إنجيل العشية','مزمور باكر','إنجيل باكر',
    'مقدمة العشية','مقدمة باكر','مقدمة القداس','مقدمة و مزمور','مقدمة و إنجيل',
    'البولس','الكاثوليكون','الإبركسيس','الابركسيس','مزمور القداس','إنجيل القداس'
  ];
  const isLabel = t => labels.includes(t) || /^(مقدمة|مزمور|الإنجيل|إنجيل|البولس|الكاثوليكون|الإبركسيس|الابركسيس)/.test(t);
  const parts=[];
  let current=null;
  const push=()=>{ if(current && current.text.trim().length>1) parts.push(current); current=null; };
  const titleMap = {
    'مزمور العشية':'مزمور العشية','مزمور عشية':'مزمور العشية','إنجيل العشية':'إنجيل العشية','إنجيل عشية':'إنجيل العشية','انجيل عشية':'إنجيل العشية','الإنجيل العشية':'إنجيل العشية',
    'مزمور باكر':'مزمور باكر','إنجيل باكر':'إنجيل باكر','انجيل باكر':'إنجيل باكر','الإنجيل باكر':'إنجيل باكر',
    'مزمور القداس':'مزمور القداس','إنجيل القداس':'إنجيل القداس',
    'البولس':'البولس','الكاثوليكون':'الكاثوليكون','الإبركسيس':'الإبركسيس','الابركسيس':'الإبركسيس',
    'مقدمة العشية':'مقدمة العشية','مقدمة باكر':'مقدمة باكر','مقدمة القداس':'مقدمة القداس'
  };
  let section='';
  let ignoreAfterSynaxarium=false;
  for (let i=0;i<clean.length;i++) {
    const line=clean[i];
    if (/^(السنكسار|سنكسار|السنكسار اليومي|سنكسار اليومي)$/.test(line)) {
      push();
      section='';
      ignoreAfterSynaxarium=true;
      continue;
    }
    if (ignoreAfterSynaxarium) continue;
    if (line==='العشية') { push(); section='vespers'; continue; }
    if (line==='باكر') { push(); section='matins'; continue; }
    if (line==='القداس' || line==='القداس الإلهي') { push(); section='liturgy'; continue; }

    let title=titleMap[line];
    if (!title && section==='vespers' && (line==='مزمور'||line==='المزمور')) title='مزمور العشية';
    if (!title && section==='vespers' && (line==='إنجيل'||line==='الإنجيل')) title='إنجيل العشية';
    if (!title && section==='matins' && (line==='مزمور'||line==='المزمور')) title='مزمور باكر';
    if (!title && section==='matins' && (line==='إنجيل'||line==='الإنجيل')) title='إنجيل باكر';
    if (!title && section==='liturgy' && (line==='مزمور'||line==='المزمور')) title='مزمور القداس';
    if (!title && section==='liturgy' && (line==='إنجيل'||line==='الإنجيل')) title='إنجيل القداس';

    if (title) {
      push();
      current={title,text:''};
      continue;
    }

    if (!current && section) {
      const introTitle = section==='vespers'?'مقدمة العشية':section==='matins'?'مقدمة باكر':'مقدمة القداس';
      current={title:introTitle,text:''};
    }
    if (current) current.text += (current.text?'\n':'') + line;
  }
  push();

  if (!parts.some(p=>p.title==='البولس') && !parts.some(p=>p.title==='الكاثوليكون') && !parts.some(p=>p.title==='الإبركسيس')) {
    let current2=null;
    for (const line of clean) {
      const hit=['البولس','الكاثوليكون','الإبركسيس','الابركسيس','مزمور القداس','إنجيل القداس'].find(x=>line===x);
      if (hit) { if(current2&&current2.text.trim()) parts.push(current2); current2={title:titleMap[hit]||hit,text:''}; }
      else if(current2) current2.text += (current2.text?'\n':'')+line;
    }
    if(current2&&current2.text.trim()) parts.push(current2);
  }

  const seen=new Set();
  return parts.filter(p=>p.text && looksArabic(p.text)).filter(p=>{
    const key=p.title+'|'+p.text.slice(0,120);
    if(seen.has(key)) return false; seen.add(key); return true;
  });
}

function katamerosLegacyParts(lines) {
  const clean=lines.map(x=>String(x||'').replace(/\s+/g,' ').trim()).filter(Boolean);
  const aliases={
    'مزمور العشية':'مزمور العشية','مزمور عشية':'مزمور العشية','إنجيل العشية':'إنجيل العشية','إنجيل عشية':'إنجيل العشية','انجيل عشية':'إنجيل العشية','الإنجيل العشية':'إنجيل العشية',
    'مزمور باكر':'مزمور باكر','إنجيل باكر':'إنجيل باكر','انجيل باكر':'إنجيل باكر','الإنجيل باكر':'إنجيل باكر',
    'البولس':'البولس','الكاثوليكون':'الكاثوليكون','الإبركسيس':'الإبركسيس','الابركسيس':'الإبركسيس',
    'مزمور القداس':'مزمور القداس','إنجيل القداس':'إنجيل القداس'
  };
  const titles=Object.keys(aliases);
  const out=[]; let current=null;
  let ignoreAfterSynaxarium=false;
  for(const line of clean){
    if (/^(السنكسار|سنكسار|السنكسار اليومي|سنكسار اليومي)$/.test(line)) {
      if(current&&current.text.trim()) out.push(current);
      current=null;
      ignoreAfterSynaxarium=true;
      continue;
    }
    if (ignoreAfterSynaxarium) continue;
    const hit=titles.find(x=>line===x);
    if(hit){ if(current&&current.text.trim()) out.push(current); current={title:aliases[hit],text:''}; }
    else if(current && !/^(القطمارس|قراءات اليوم|نسخ القراءة|نسخ الكل|English|العربية|التاريخ|المناسبة)$/i.test(line)) current.text+=(current.text?'\n':'')+line;
  }
  if(current&&current.text.trim()) out.push(current);
  return out.filter(p=>p.text.length>1&&looksArabic(p.text));
}

function renderKatamerosParts(parts) {
  const root = document.getElementById('katameros-content');
  if (!root || !parts.length) return false;

  const order=['مقدمة العشية','مزمور العشية','إنجيل العشية','مقدمة باكر','مزمور باكر','إنجيل باكر','البولس','الكاثوليكون','الإبركسيس','مقدمة القداس','مزمور القداس','إنجيل القداس'];
  const rank = title => {
    const i=order.indexOf(title);
    return i<0 ? 999 : i;
  };

  const items=[];
  const seenTitles=new Set();
  parts.map(p=>({...p}))
    .sort((a,b)=>rank(a.title)-rank(b.title))
    .forEach(p=>{
      if (!p.text || !looksArabic(p.text)) return;
      if (seenTitles.has(p.title)) return;
      seenTitles.add(p.title);
      items.push(p);
    });

  if (!items.length) return false;

  const codeCategories = [
    {title:'أرباع الناقوس واطس', codeCategory:'naqoos_watos'},
    {title:'أرباع الناقوس آدام', codeCategory:'naqoos_adam'},
    {title:'الذكصولوجيات', codeCategory:'doxologies'}
  ];
  items.push(...codeCategories);

  root.innerHTML=`
    <div class="daily-selector-wrap">
      <button type="button" class="daily-selector-btn" onclick="toggleDailyPicker('katameros')" aria-expanded="false">
        <span id="katameros-selected-label">${escapeHtml(items[0].title)}</span>
        <span class="prayer-selector-arrow">⌄</span>
      </button>
    </div>
    <div id="katameros-part-view" class="daily-selected-view"></div>
    <div id="katameros-picker" class="daily-picker-overlay" onclick="closeDailyPicker('katameros',event)" aria-hidden="true">
      <div class="daily-picker" onclick="event.stopPropagation()">
        <div class="daily-picker-head">
          <strong>اختر قراءة القطمارس</strong>
          <button type="button" onclick="toggleDailyPicker('katameros')">×</button>
        </div>
        <div class="daily-choice-list">
          ${items.map((p,i)=>`<button type="button" class="daily-choice" onclick="showKatamerosPart(${i})"><span>${escapeHtml(p.title)}</span></button>`).join('')}
        </div>
      </div>
    </div>`;

  window.__katamerosParts=items;
  window.__selectedKatamerosPart=0;
  window.__katamerosCollection=null;
  showKatamerosPart(0,false);
  return true;
}

function showKatamerosPart(index,smooth=true) {
  const parts=window.__katamerosParts||[];
  if(!parts[index]) return;
  window.__selectedKatamerosPart=index;
  const item=parts[index];
  if(item.collection){
    renderKatamerosCollection(item.collection,item.title);
    closeDailyPicker('katameros');
    return;
  }
  if(item.codeCategory){
    renderKatamerosCodeCategory(item.codeCategory,item.title);
    closeDailyPicker('katameros');
    return;
  }
  if(item.hymnCategory){
    renderKatamerosHymnEditor(item.hymnCategory,item.title);
    closeDailyPicker('katameros');
    return;
  }
  const label=document.getElementById('katameros-selected-label');
  const view=document.getElementById('katameros-part-view');
  if(label) label.textContent=item.title;
  if(view) view.innerHTML=`<section class="reading-card"><div class="reading-label">${escapeHtml(item.title)}</div><div class="reading-text">${escapeHtml(item.text).replace(/\n/g,'<br><br>')}</div></section>`;
  window.__katamerosCollection=null;
  closeDailyPicker('katameros');
  if(smooth && view) view.scrollIntoView({behavior:'smooth',block:'start'});
}

function renderKatamerosCodeCategory(category,title) {
  const label=document.getElementById('katameros-selected-label');
  const view=document.getElementById('katameros-part-view');
  if(label) label.textContent=title;
  const entries=(window.KATAMEROS_CODE_TEXTS && window.KATAMEROS_CODE_TEXTS[category]) || [];
  if(!view) return;
  if(category==='doxologies'){
    window.__currentDoxologies=[];
    window.__selectedDoxology=0;
    view.innerHTML=`
      <section class="reading-card doxology-library">
        <div class="reading-label">الذكصولوجيات</div>
        <div class="online-doxology-head"><strong>اختر الذكصولوجية</strong><span id="dox-online-count">جارٍ تحميل القائمة…</span></div>
        <input id="dox-online-search" class="dox-online-search" type="search" placeholder="ابحث باسم الذكصولوجية" oninput="filterOnlineDoxologies(this.value)" aria-label="البحث في أسماء الذكصولوجيات">
        <div id="dox-online-status" class="dox-online-status" role="status">جارٍ تحميل أسماء الذكصولوجيات…</div>
        <div id="dox-online-list" class="dox-online-list"></div>
        <article id="dox-online-reading" class="dox-online-reading" hidden></article>
      </section>`;
    loadOnlineDoxologies();
  } else {
    view.innerHTML=entries.length ? entries.map((entry,index)=>
      `<section class="reading-card"><div class="reading-label">${escapeHtml(entry.title || (title+' '+(index+1)))}</div><div class="reading-text">${escapeHtml(entry.text || '').replace(/\n/g,'<br><br>')}</div></section>`
    ).join('') : `<section class="reading-card"><div class="reading-label">${escapeHtml(title)}</div><div class="reading-text">لا توجد نصوص مضافة لهذا القسم بعد. أضف النصوص داخل ملف <b>katameros_code_texts.js</b> ثم افتح التطبيق من جديد.</div></section>`;
  }
  window.__katamerosCollection=null;
  if(view) view.scrollIntoView({behavior:'smooth',block:'start'});
}

let __onlineDoxologies=[];
window.__selectedOnlineDoxology=0;
window.__currentOnlineDoxologies=[];
const DOX_CACHE_KEY='tariq_school_doxologies_v5';
const DOX_SOURCE_CATEGORIES=[
  'Osbo3ElAlam.php','Tasbe7a.php','5amasin.php','ElSomElKebir.php',
  'Odas.php','Monasbat.php','MiladGhotas.php','Raf3B5or.php',
  'SomElRosol.php','SomEl3adra.php','Nayroz.php','Keyahk.php'
].map(path=>'https://madraset-elshamamsa.com/al7an/'+path);
async function doxFetchPage(url){
  const normalized=url.replace(/^https:\/\//i,'');
  const reader='https://r.jina.ai/http://'+normalized;
  const response=await fetch(reader,{headers:{'Accept':'text/plain'}});
  if(!response.ok) throw new Error('تعذر الاتصال بمصدر النص ('+response.status+')');
  return await response.text();
}
function parseDoxologyLinks(markdown, fallbackCategory='ذكصولوجيات أخرى'){
  const text=String(markdown||'').replace(/\r/g,'');
  const found=new Map();
  const lines=text.split('\n');
  let category=fallbackCategory, title='';
  const isDoxTitle=t=>/(ذكصولوجية|ذوكصولوجية|ذكسولوجية|ذوكصولوجيا|دكسولوجية|دكسولوجيا)/u.test(t);
  const add=(t,u,c)=>{
    t=String(t||'').replace(/[*_`]/g,'').replace(/\s+/g,' ').trim();
    if(!t||!u||!isDoxTitle(t))return;
    let url=u.startsWith('/')?'https://madraset-elshamamsa.com'+u:u;
    url=url.split('#')[0];
    if(!/^https:\/\/madraset-elshamamsa\.com\/al7an\//i.test(url))return;
    if(!found.has(url))found.set(url,{title:t.replace(/^\d+\s*[-–.]\s*/,''),url,category:c||fallbackCategory});
  };
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();
    const cat=line.match(/^#{4,6}\s*#?\s*(.+)$/);
    if(cat && !/^ذ[يك]كو/u.test(cat[1])) category=cat[1].replace(/[*_]/g,'').trim();
    const heading=line.match(/^####\s+(.+?)\s*$/);
    if(heading){title=heading[1].replace(/[*_`]/g,'').trim();continue;}
    const detail=line.match(/\[(?:التفاصيل|تفاصيل|اقرأ المزيد)\]\((https?:\/\/[^)]+|\/[^)]+)\)/i);
    if(detail && title){
      let c=category;
      if(/كيهك/u.test(title))c='كيهك';
      else if(/تسبحة/u.test(title))c='التسبحة';
      else if(/رفع بخور/u.test(title))c='رفع بخور باكر وعشية';
      add(title,detail[1],c);title='';
    }
  }
  // بعض صفحات المكتبة تضع العنوان والرابط في سطر واحد.
  const re=/\[([^\]]*(?:ذكصولوجية|ذوكصولوجية|ذكسولوجية|دكسولوجية)[^\]]*)\]\((https?:\/\/madraset-elshamamsa\.com\/[^)]+|\/[^)]+)\)/giu;
  let m;while((m=re.exec(text))!==null)add(m[1],m[2],category);
  // بعض الصفحات تعرض روابط التفاصيل بصيغة Markdown غير موحدة.
  const loose=/####\s+([^\n]+)\n[\s\S]{0,500}?\((https?:\/\/madraset-elshamamsa\.com\/al7an\/[^)]+)\)/giu;
  while((m=loose.exec(text))!==null)add(m[1],m[2],category);
  return [...found.values()];
}
function getDoxPaginationUrls(markdown, baseUrl){
  const urls=new Set();
  const re=/\]\((https?:\/\/madraset-elshamamsa\.com\/al7an\/[^)]+(?:[?&]page=\d+)[^)]*)\)/giu;
  let m;while((m=re.exec(String(markdown||'')))!==null)urls.add(m[1]);
  // دعم روابط الصفحات النسبية.
  const rel=/\]\((\/al7an\/[^)]+(?:[?&]page=\d+)[^)]*)\)/giu;
  while((m=rel.exec(String(markdown||'')))!==null)urls.add('https://madraset-elshamamsa.com'+m[1]);
  return [...urls];
}
async function loadOnlineDoxologies(force=false){
  const status=document.getElementById('dox-online-status');
  if(!status)return;
  let cached=null;try{cached=!force?JSON.parse(localStorage.getItem(DOX_CACHE_KEY)||'null'):null;}catch(e){cached=null;}
  if(Array.isArray(cached)&&cached.length){__onlineDoxologies=cached;renderOnlineDoxologyList(cached);}
  status.textContent='جارٍ حصر جميع أقسام مكتبة مدرسة الشمامسة…';
  try{
    const seeds=[...DOX_SOURCE_CATEGORIES,'https://madraset-elshamamsa.com/al7an/33.php','https://madraset-elshamamsa.com/al7an/index.php'];
    const queue=[...new Set(seeds)],visited=new Set(),combined=new Map();
    // اتبع صفحات النتائج التالية التي يعلن عنها المصدر، بدلاً من الاكتفاء بأول 20 نتيجة.
    while(queue.length && visited.size<80){
      const batch=queue.splice(0,8).filter(url=>!visited.has(url));
      if(!batch.length)continue;
      const pages=await Promise.all(batch.map(async url=>({url,text:await doxFetchPage(url).catch(()=> '')})));
      for(const page of pages){
        visited.add(page.url);
        const fallback=DOX_SOURCE_CATEGORIES.find(url=>page.url.startsWith(url.split('?')[0]))?.split('/').pop()?.replace('.php','')||'ذكصولوجيات أخرى';
        parseDoxologyLinks(page.text,fallback).forEach(item=>combined.set(item.url,item));
        getDoxPaginationUrls(page.text,page.url).forEach(url=>{if(!visited.has(url)&&!queue.includes(url))queue.push(url);});
      }
    }
    const names=[...combined.values()].sort((a,b)=>a.category.localeCompare(b.category,'ar')||a.title.localeCompare(b.title,'ar'));
    if(names.length<10)throw new Error('لم يكتمل حصر أقسام المكتبة؛ تم العثور على '+names.length+' فقط');
    __onlineDoxologies=names.map(x=>({ ...x, languages:{}, text:'' }));
    window.__currentOnlineDoxologies=__onlineDoxologies;
    window.__selectedOnlineDoxology=0;
    try{localStorage.setItem(DOX_CACHE_KEY,JSON.stringify(__onlineDoxologies));}catch(e){}
    renderOnlineDoxologyList(__onlineDoxologies);
    status.textContent=`تم حصر ${names.length} ذكصولوجية من جميع أقسام مكتبة مدرسة الشمامسة وصفحاتها المتاحة.`;
  }catch(error){
    if(__onlineDoxologies.length){status.textContent=`تعذر تحديث الفهرس الآن. المعروض ${__onlineDoxologies.length} اسمًا محفوظًا؛ تحقق من الاتصال ثم أعد المحاولة.`;}
    else {status.innerHTML='تعذر الاتصال بمدرسة الشمامسة. <button type="button" class="dox-retry-btn" onclick="loadOnlineDoxologies(true)">إعادة المحاولة</button>'+(error&&error.message?'<small>'+escapeHtml(error.message)+'</small>':'');}
  }
}
function renderOnlineDoxologyList(items){
  const list=document.getElementById('dox-online-list'),count=document.getElementById('dox-online-count');if(!list)return;
  if(count)count.textContent=`${__onlineDoxologies.length} ذكصولوجية`;
  window.__currentOnlineDoxologies=__onlineDoxologies;
  let selected=Math.max(0,Math.min(window.__selectedOnlineDoxology||0,__onlineDoxologies.length-1));
  let current=items.findIndex(x=>x.url===__onlineDoxologies[selected]?.url);
  if(current<0 && items.length){selected=__onlineDoxologies.findIndex(x=>x.url===items[0].url);window.__selectedOnlineDoxology=Math.max(0,selected);current=0;}
  const picker=buildTextPicker('online-dox',items,Math.max(0,current),'الذكصولوجية');
  list.innerHTML=picker;
  if(current>=0)window.__selectedOnlineDoxology=__onlineDoxologies.findIndex(x=>x.url===items[current].url);
  const reader=document.getElementById('dox-online-reading');
  if(reader && !reader.hidden && __onlineDoxologies.length)showOnlineDoxology(window.__selectedOnlineDoxology);
}
function filterOnlineDoxologies(query){
  const term=(query||'').trim().toLowerCase();
  const matches=__onlineDoxologies.filter(x=>x.title.toLowerCase().includes(term)||String(x.category||'').toLowerCase().includes(term));
  renderOnlineDoxologyList(matches);
}
function extractDoxologyLanguages(markdown,title){
  const text=String(markdown||'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'');
  const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
  const start=lines.findIndex(x=>/كلام اللحن/.test(x));
  const end=lines.findIndex((x,i)=>i>(start<0?0:start)&&/عن اللحن/.test(x));
  const body=lines.slice(start>=0?start+1:0,end>=0?end:lines.length);
  const clean=body.filter(x=>!/^#{1,6}\s/.test(x)&&!/^\[?(?:Back|اختار اللغة|عربي|قبطي|قبطي معرّب|قبطي معرب)\]?$/u.test(x)&&!/^https?:\/\//i.test(x)&&!/^\[.*\]\(https?:\/\//.test(x)&&!/^\d+s\s+\d+s$/i.test(x));
  const out={arabic:[],coptic:[],arabized:[]};
  // مدرسة الشمامسة تعرض كل مقطع في ثلاث سطور متتابعة: عربي، قبطي بحروف عربية، ثم قبطي معرّب بحروف لاتينية.
  for(let i=0;i<clean.length;){
    const a=clean[i++];
    if(!a) continue;
    const b=clean[i]||'';
    const c=clean[i+1]||'';
    if(b&&c&&/[\u0600-\u06FF]/u.test(a)&&/[\u0600-\u06FF]/u.test(b)&&/[A-Za-z`]/.test(c)){
      out.arabic.push(a);out.coptic.push(b);out.arabized.push(c);i+=2;
    }
  }
  return {arabic:out.arabic.join('\n\n'),coptic:out.coptic.join('\n\n'),arabized:out.arabized.join('\n\n')};
}
async function showOnlineDoxology(index){
  const item=__onlineDoxologies[index],target=document.getElementById('dox-online-reading');
  if(!item||!target)return;
  target.hidden=false;
  target.innerHTML=`<div class="dox-online-nav"><button type="button" onclick="navigateOnlineDoxology(-1)">→ السابقة</button><button type="button" onclick="navigateOnlineDoxology(1)">التالية ←</button></div><h3>${escapeHtml(item.title)}</h3><div class="dox-online-text">جارٍ جلب النص الأصلي…</div>`;
  target.scrollIntoView({behavior:'smooth',block:'start'});
  try{
    if(!item.languages||!Object.keys(item.languages).length){
      const markdown=await doxFetchPage(item.url);
      item.languages=extractDoxologyLanguages(markdown,item.title);
      if(!Object.values(item.languages).some(t=>t&&t.length>10)) throw new Error('لم تظهر النصوص');
      try{localStorage.setItem(DOX_CACHE_KEY,JSON.stringify(__onlineDoxologies));}catch(e){}
    }
    const allLanguages=[['arabic','عربي'],['coptic','قبطي'],['arabized','قبطي معرّب']];
    const available=allLanguages.filter(([k])=>item.languages[k]&&item.languages[k].trim().length>5);
    const selected=available.length?available[0][0]:'arabic';
    const controls=allLanguages.map(([k,label])=>`<button type="button" class="dox-language-btn ${k===selected?'active':''}" data-lang="${k}" ${item.languages[k]?'':'disabled title="هذه اللغة غير متاحة في صفحة هذا اللحن"'}>${label}</button>`).join('');
    const initial=item.languages[selected]||'النص بهذه اللغة غير متاح لهذا اللحن في المصدر.';
    target.innerHTML=`<div class="dox-online-nav"><button type="button" onclick="navigateOnlineDoxology(-1)">→ السابقة</button><button type="button" onclick="navigateOnlineDoxology(1)">التالية ←</button></div><h3>${escapeHtml(item.title)}</h3><div class="dox-language-picker" role="group" aria-label="اختيار لغة الذكصولوجية">${controls}</div><div class="dox-online-text lang-${selected}" id="dox-language-text" data-lang="${selected}">${escapeHtml(initial).replace(/\n/g,'<br>')}</div><small>المصدر: <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">مدرسة الشمامسة</a></small>`;
    target.querySelectorAll('.dox-language-btn:not(:disabled)').forEach(btn=>btn.addEventListener('click',()=>{
      target.querySelectorAll('.dox-language-btn').forEach(b=>b.classList.toggle('active',b===btn));
      const value=item.languages[btn.dataset.lang]||'النص بهذه اللغة غير متاح لهذا اللحن في المصدر.';
      const textNode=target.querySelector('#dox-language-text');
      textNode.innerHTML=escapeHtml(value).replace(/\n/g,'<br>');
      textNode.className='dox-online-text lang-'+btn.dataset.lang;textNode.dataset.lang=btn.dataset.lang;textNode.dir=btn.dataset.lang==='arabic'?'rtl':'auto';
    }));
  }catch(error){
    target.innerHTML=`<div class="dox-online-nav"><button type="button" onclick="navigateOnlineDoxology(-1)">→ السابقة</button><button type="button" onclick="navigateOnlineDoxology(1)">التالية ←</button></div><h3>${escapeHtml(item.title)}</h3><div class="dox-online-text">تعذر جلب النصوص من مدرسة الشمامسة الآن. حاول مرة أخرى عند توفر الإنترنت.</div><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">فتح اللحن في الموقع الأصلي</a>`;
  }
}
function navigateOnlineDoxology(direction){
  if(!__onlineDoxologies.length)return;
  const next=Math.max(0,Math.min(__onlineDoxologies.length-1,(window.__selectedOnlineDoxology||0)+direction));
  if(next===window.__selectedOnlineDoxology)return;
  window.__selectedOnlineDoxology=next;
  const item=__onlineDoxologies[next];
  const label=document.getElementById('online-dox-selected-label');
  if(label&&item)label.textContent=item.title;
  document.querySelectorAll('#online-dox-picker-overlay .text-picker-option').forEach(el=>{const active=Number(el.dataset.index)===next;el.classList.toggle('active',active);const check=el.querySelector('.text-picker-check');if(check)check.textContent=active?'✓':'';});
  showOnlineDoxology(next);
}

function renderSelectedDoxology(index) {
  const item=(window.__currentDoxologies||[])[index];
  const target=document.getElementById('dox-item-view');
  if(target) target.innerHTML=item ? `<div class="prayer-section-title">${escapeHtml(item.title || 'ذكصولوجية')}</div><div class="prayer-section-body">${escapeHtml(item.text || '').replace(/\n/g,'<br><br>')}</div>` : '';
}

function toggleDailyPicker(type) {
  const id=type==='katameros'?'katameros-picker':type==='feasts'?'feasts-picker':'synaxarium-picker';
  const overlay=document.getElementById(id);
  if(!overlay) return;
  const open=!overlay.classList.contains('show');
  overlay.classList.toggle('show',open);
  overlay.setAttribute('aria-hidden',String(!open));
  document.body.classList.toggle('daily-picker-open',open);
}
function closeDailyPicker(type,event) {
  if(event&&event.target!==event.currentTarget) return;
  const id=type==='katameros'?'katameros-picker':type==='feasts'?'feasts-picker':'synaxarium-picker';
  const overlay=document.getElementById(id);
  if(overlay){overlay.classList.remove('show');overlay.setAttribute('aria-hidden','true');}
  document.body.classList.remove('daily-picker-open');
}

function renderKatamerosArabicHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  ['script','style','noscript','nav','header','footer','form'].forEach(sel =>
    doc.querySelectorAll(sel).forEach(x => x.remove())
  );
  const root = doc.querySelector('main') || doc.querySelector('article') || doc.body;
  if (!root) return false;

  const raw = (root.innerText || root.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '');
  const lines = raw.split(/\n+/).map(x => x
    .replace(/^[#*\-•]+\s*/,'')
    .replace(/\*\*(.*?)\*\*/g,'$1')
    .replace(/__(.*?)__/g,'$1')
    .replace(/\[(.*?)\]\([^)]*\)/g,'$1')
    .replace(/\s+/g,' ')
    .trim()
  ).filter(Boolean);
  const normalizedLines = lines.flatMap(x => {
    let line = x.replace(/^مزمور\s+عشية$/, 'مزمور العشية')
      .replace(/^(إنجيل|انجيل)\s+عشية$/, 'إنجيل العشية')
      .replace(/^(إنجيل|انجيل)\s+باكر$/, 'إنجيل باكر')
      .replace(/^(مزمور|مزمر)\s+باكر$/, 'مزمور باكر')
      .replace(/^مقدمة\s+(إنجيل|انجيل)\s+(العشية|عشية)$/, 'مقدمة العشية');
    line = line.replace(/\s+(القداس(?:\s+الإلهي)?)(?=\s|$)/g, '\n$1')
      .replace(/(إنجيل عشية|مزمور عشية|إنجيل العشية|مزمور العشية|إنجيل باكر|مزمور باكر|إنجيل القداس|مزمور القداس|السنكسار اليومي|السنكسار|سنكسار اليومي|سنكسار)\s*[:：-]?/g, '\n$1\n')
      .replace(/\n+/g, '\n');
    return line.split(/\n+/).map(y => y.trim()).filter(Boolean);
  });

  const aliases = {
    'مزمور العشية':'مزمور العشية', 'مزمور عشية':'مزمور العشية', 'مزمر عشية':'مزمور العشية', 'الإنجيل العشية':'إنجيل العشية', 'إنجيل العشية':'إنجيل العشية', 'إنجيل عشية':'إنجيل العشية', 'انجيل عشية':'إنجيل العشية',
    'مقدمة انجيل عشية':'مقدمة العشية', 'مقدمة إنجيل عشية':'مقدمة العشية', 'مقدمة الإنجيل عشية':'مقدمة العشية', 'مقدمة إنجيل العشية':'مقدمة العشية', 'مقدمة عشية':'مقدمة العشية',
    'مزمور باكر':'مزمور باكر', 'مزمور باكر':'مزمور باكر', 'إنجيل باكر':'إنجيل باكر', 'انجيل باكر':'إنجيل باكر', 'الإنجيل باكر':'إنجيل باكر',
    'مزمور القداس':'مزمور القداس', 'إنجيل القداس':'إنجيل القداس', 'انجيل القداس':'إنجيل القداس', 'الإنجيل القداس':'إنجيل القداس',
    'البولس':'البولس', 'الكاثوليكون':'الكاثوليكون',
    'الإبركسيس':'الإبركسيس', 'الابركسيس':'الإبركسيس'
  };
  const parts = [];
  let service = '';
  let current = null;
  const serviceName = s => {
    if (s === 'العشية') return 'vespers';
    if (s === 'باكر') return 'matins';
    if (s === 'القداس' || s === 'القداس الإلهي' || s === 'قراءات القداس') return 'liturgy';
    return service;
  };
  const titleFor = (name) => {
    if (name === 'مزمور' || name === 'المزمور' || name === 'مزمور عشية') return service === 'vespers' ? 'مزمور العشية' : service === 'matins' ? 'مزمور باكر' : 'مزمور القداس';
    if (name === 'إنجيل' || name === 'الإنجيل' || name === 'إنجيل عشية' || name === 'انجيل عشية') return service === 'vespers' ? 'إنجيل العشية' : service === 'matins' ? 'إنجيل باكر' : 'إنجيل القداس';
    return aliases[name] || name;
  };
  const isHeading = line => {
    if (aliases[line] || ['العشية','باكر','القداس','القداس الإلهي','قراءات القداس','مزمور','المزمور','مزمور عشية','إنجيل','الإنجيل','إنجيل عشية','انجيل عشية'].includes(line)) return true;
    return false;
  };
  const pushCurrent = () => {
    if (!current || current.text.trim().length < 2 || !looksArabic(current.text)) { current = null; return; }
    const lines2 = current.text.split('\n').map(x => x.trim()).filter(Boolean);
    if (/^(مزمور|إنجيل)/.test(current.title) && lines2.length >= 2) {
      const refIndex = lines2.findIndex((x,i) => i > 0 && /(?:^|\s)(?:[1-3]\s*)?[\p{L}]+\s*\(?\d+\s*[:：]\s*\d+/u.test(x));
      if (refIndex > 0) {
        const intro = lines2.slice(0, refIndex).join('\n');
        const body = lines2.slice(refIndex).join('\n');
        if (intro) {
          const introTitle = current.title === 'مزمور العشية' ? 'مقدمة العشية' :
            current.title === 'مزمور باكر' ? 'مقدمة باكر' :
            current.title === 'مزمور القداس' ? 'مقدمة القداس' :
            current.title === 'إنجيل العشية' ? 'مقدمة العشية' :
            current.title === 'إنجيل باكر' ? 'مقدمة باكر' : 'مقدمة القداس';
          parts.push({title:introTitle, text:intro});
        }
        current.text = body;
      }
    }
    if (current.text.trim()) parts.push({title:current.title, text:current.text.trim()});
    current = null;
  };

  let inSynaxarium=false;
  for (const line of normalizedLines) {
    if (/^(السنكسار|سنكسار|السنكسار اليومي|سنكسار اليومي)$/.test(line)) {
      pushCurrent();
      service='';
      inSynaxarium=true;
      continue;
    }
    if (inSynaxarium) {
      if (line === 'القداس' || line === 'القداس الإلهي' || line === 'قراءات القداس') {
        inSynaxarium=false;
        pushCurrent();
        service = 'liturgy';
        continue;
      }
      continue;
    }
    if (line === 'العشية' || line === 'باكر' || line === 'القداس' || line === 'القداس الإلهي' || line === 'قراءات القداس') {
      pushCurrent();
      service = serviceName(line);
      continue;
    }
    if (isHeading(line)) {
      pushCurrent();
      current = {title:titleFor(line), text:''};
      continue;
    }
    const inline = line.match(/^(مقدمة انجيل عشية|مقدمة إنجيل عشية|مقدمة الإنجيل عشية|مقدمة إنجيل العشية|مقدمة عشية|مزمور العشية|مزمور عشية|مزمر عشية|إنجيل العشية|إنجيل عشية|انجيل عشية|مزمور باكر|مزمر باكر|إنجيل باكر|انجيل باكر|البولس|الكاثوليكون|الإبركسيس|الابركسيس|مزمور القداس|إنجيل القداس|انجيل القداس)\s*[:：-]?\s*(.*)$/);
    if (inline) {
      pushCurrent();
      current = {title:aliases[inline[1]] || inline[1], text:inline[2] || ''};
      continue;
    }
    if (current) {
      if (/^(نسخ القراءة|نسخ الكل|مصدر القراءة|العربية|English|القطمارس|قراءات اليوم|التاريخ|المناسبة)$/i.test(line)) continue;
      current.text += (current.text ? '\n' : '') + line;
    }
  }
  pushCurrent();

  const seen = new Set();
  const clean = parts.filter(p => {
    const text = String(p.text || '').trim();
    const title = String(p.title || '').trim();
    if (!text || text.length < 2 || !title || seen.has(title)) return false;
    seen.add(title);
    return true;
  });

  const hasVespers = clean.some(p => /عشية/.test(p.title));
  if (!hasVespers) {
    const fallback = katamerosStructuredParts(normalizedLines);
    if (fallback.some(p => /عشية/.test(p.title))) return renderKatamerosParts(fallback);
  }
  if (!clean.length) {
    const fallback = katamerosStructuredParts(normalizedLines);
    if (fallback.length) return renderKatamerosParts(fallback);
    return false;
  }
  return renderKatamerosParts(clean);
}


const katamerosDoxologies = [
  {title:'ذيكسولوچية الملائكة',text:'السلام للملائكة، السلام للسمائيين، السلام للرؤساء، السلام للسلاطين، السلام للقوات، السلام للربوات، السلام للأجناد، السلام للكراسي، السلام للشيروبيم، السلام للسيرافيم.'},
  {title:'ذيكسولوچية العذراء مريم',text:'السلام لك يا مريم، السلام للحمامة الحسنة، التي ولدت لنا الله الكلمة. السلام لك يا مريم، أم القدوس، أم الله، والدة الإله، شفيعة جنس البشر.'},
  {title:'ذيكسولوچية الملاك ميخائيل',text:'السلام لميخائيل رئيس الملائكة العظيم، السلام لمن يقف أمام العرش، السلام للذي يخدم أمام الرب، السلام لرئيس جند السمائيين.'},
  {title:'ذيكسولوچية الملاك غبريال',text:'السلام لغبريال رئيس الملائكة العظيم، السلام للذي بشّر مريم العذراء، السلام لمن يحمل البشارة المفرحة.'},
  {title:'ذيكسولوچية يوحنا المعمدان',text:'السلام ليوحنا السابق العظيم، السلام للكاهن نسيب عمانوئيل، السلام لمن شهد للحق وأعد طريق الرب.'},
  {title:'ذيكسولوچية الرسل',text:'السلام للرسل الأطهار، تلاميذ مخلصنا يسوع المسيح، الذين بشروا المسكونة باسم الآب والابن والروح القدس.'},
  {title:'ذيكسولوچية الشهداء',text:'السلام للشهداء، الذين سفكوا دماءهم من أجل اسم المسيح، السلام للقديسين الذين أكملوا جهادهم ونالوا إكليل الحياة.'},
  {title:'ذيكسولوچية القديسين',text:'السلام لجميع قديسي الكنيسة، الذين أرضوا الرب بأعمالهم، السلام للآباء والمعلمين والرعاة وكل من حفظ الإيمان.'},
  {title:'ذيكسولوچية مار مرقس',text:'السلام لمار مرقس الرسول، الإنجيلي والشهيد، الذي كرز في أرض مصر باسم ربنا يسوع المسيح، السلام لك يا كاروز الديار المصرية.'},
  {title:'ذيكسولوچية الثالوث القدوس',text:'نسجد للآب والابن والروح القدس، الثالوث القدوس، إله واحد آمين. يا رب ارحم، يا رب ارحم، يا رب باركنا آمين.'},
  {title:'ذيكسولوچية الآباء',text:'السلام لآبائنا القديسين، رؤساء الكهنة، ولآبائنا الأساقفة والكهنة والشمامسة، ولجميع الذين خدموا الكنيسة بأمانة.'},
  {title:'ذيكسولوچية القيامة',text:'السلام للقيامة، التي بها أشرق لنا نور الحياة، السلام للمسيح القائم من بين الأموات، الذي وهبنا الخلاص والحياة الأبدية.'}
];

const katamerosBellQuarters = [
  {title:'ربع الثالوث القدوس',text:'تعالوا فلنسجد للثالوث القدوس، الذي هو الآب والابن والروح القدس، نحن الشعوب المسيحيين، لأن هذا هو إلهنا الحقيقي.'},
  {title:'ربع الكنيسة والعذراء',text:'السلام للكنيسة بيت الملائكة، السلام للعذراء التي ولدت مخلصنا، السلام لمريم أم الله، شفيعة جنس البشر.'},
  {title:'ربع المخلص',text:'لنا رجاء في القديسة مريم، الله يرحمنا بشفاعاتها، لنا رجاء في القديسين، الله يرحمنا بصلواتهم.'},
  {title:'ربع ميخائيل',text:'السلام لميخائيل رئيس الملائكة العظيم، السلام لرئيس جند السمائيين، شفيعنا أمام الرب، يطلب عنا الرحمة والغفران.'},
  {title:'ربع غبريال',text:'السلام لغبريال رئيس الملائكة العظيم، السلام للذي بشّر مريم العذراء، يطلب عنا أمام ربنا يسوع المسيح.'},
  {title:'ربع يوحنا',text:'السلام ليوحنا السابق العظيم، السلام للكاهن نسيب عمانوئيل، الذي شهد للمسيح وقال إنه هو حمل الله.'},
  {title:'ربع الأربعة حيوانات',text:'السلام للأربعة حيوانات غير المتجسدين، السلام للأربعة وعشرين قسيسًا، الذين يسبحون أمام العرش بلا فتور.'},
  {title:'ربع الرسل',text:'السلام للرسل الأطهار، تلاميذ مخلصنا يسوع المسيح، الذين بشروا المسكونة كلها، صلوا عنا يا ساداتنا الرسل.'},
  {title:'ربع الشهداء',text:'السلام للشهداء، الذين من أجل اسم المسيح احتملوا العذاب، صلوا عنا لكي ينعم لنا الرب بغفران خطايانا.'},
  {title:'ربع مار مرقس',text:'السلام لمار مرقس الرسول، الإنجيلي والشهيد، كاروز الديار المصرية، صل عنا لكي يغفر لنا الرب خطايانا.'},
  {title:'ربع الآباء',text:'السلام لآبائنا القديسين، رؤساء الكهنة، السلام للآباء الأساقفة والكهنة والشمامسة، اذكرونا أمام عرش الرب.'},
  {title:'ربع الختام',text:'لكي نسبحك مع أبيك الصالح والروح القدس، لأنك أتيت وخلصتنا، ارحمنا. المجد للآب والابن والروح القدس الآن وكل أوان وإلى دهر الدهور آمين.'}
];

function renderKatamerosCollection(collection, title) {
  const view=document.getElementById('katameros-part-view');
  const label=document.getElementById('katameros-selected-label');
  if(!view) return;
  window.__katamerosCollection=collection;
  window.__selectedKatamerosSub=0;
  if(label) label.textContent=title;
  view.innerHTML=`
    <section class="reading-card">
      <div class="reading-label">${escapeHtml(title)}</div>
      <div class="psalm-picker-box" style="margin-top:12px">
        <label for="katameros-collection-select">اختر ${escapeHtml(title)}</label>
        <select id="katameros-collection-select" class="psalm-select">
          ${collection.map((x,i)=>`<option value="${i}">${escapeHtml(x.title)}</option>`).join('')}
        </select>
      </div>
      <div id="katameros-collection-view" class="selected-psalm-view"></div>
    </section>`;
  const select=document.getElementById('katameros-collection-select');
  if(select) select.addEventListener('change',()=>showKatamerosCollectionItem(Number(select.value)));
  showKatamerosCollectionItem(0);
}

function showKatamerosCollectionItem(index) {
  const list=window.__katamerosCollection||[];
  const item=list[index];
  if(!item) return;
  window.__selectedKatamerosSub=index;
  const view=document.getElementById('katameros-collection-view');
  const select=document.getElementById('katameros-collection-select');
  if(select) select.value=String(index);
  if(view) view.innerHTML=`<div class="prayer-section-title">${escapeHtml(item.title)}</div><div class="prayer-section-body">${escapeHtml(item.text).replace(/\n/g,'<br><br>')}</div>`;
}

const readingNamesAr = {
  psalm:'المزمور', gospel:'الإنجيل', pauline:'البولس', catholicon:'الكاثوليكون', praxis:'الإبركسيس', acts:'الإبركسيس', liturgy:'القداس', matins:'باكر', vespers:'العشية', readings:'القراءات', epistle:'الرسالة'
};

function renderKatameros(data) {
  const root=document.getElementById('katameros-content');
  if (!root) return false;

  const order=['مقدمة العشية','مزمور العشية','إنجيل العشية','مقدمة باكر','مزمور باكر','إنجيل باكر','البولس','الكاثوليكون','الإبركسيس','مقدمة القداس','مزمور القداس','إنجيل القداس'];
  const parts=[];
  const usedTitles=new Set();
  const seenText=new Set();

  const cleanText = value => {
    const t = stripHtml(String(value ?? ''))
      .replace(/[\\r\\t]+/g,' ')
      .replace(/\\s{2,}/g,' ')
      .trim();
    return t;
  };

  const normalizeKey = key => String(key || '')
    .toLowerCase()
    .replace(/[\\s_\\-]+/g,'')
    .replace(/[إأآ]/g,'ا');

  function sectionOf(key, current='') {
    const k=normalizeKey(key);
    if (/vespers|evening|عشية|مساء|غروب/.test(k)) return 'vespers';
    if (/matins|morning|باكر|باکر/.test(k)) return 'matins';
    if (/liturgy|divineliturgy|mass|قداس/.test(k)) return 'liturgy';
    return current;
  }

  function titleOf(key, section='') {
    const k=normalizeKey(key);
    if (/pauline|paulineepistle|بولس/.test(k)) return 'البولس';
    if (/catholic|catholicon|catholiconepistle|كاثولي/.test(k)) return 'الكاثوليكون';
    if (/praxis|acts|ابركسيس/.test(k)) return 'الإبركسيس';
    if (/psalm|psalms|مزمور|مزمر/.test(k)) {
      return section==='vespers'?'مزمور العشية':section==='matins'?'مزمور باكر':section==='liturgy'?'مزمور القداس':'المزمور';
    }
    if (/gospel|انجيل|الانجيل/.test(k)) {
      return section==='vespers'?'إنجيل العشية':section==='matins'?'إنجيل باكر':section==='liturgy'?'إنجيل القداس':'الإنجيل';
    }
    return '';
  }

  function getArabicValue(obj) {
    if (obj == null) return '';
    if (typeof obj === 'string' || typeof obj === 'number') {
      const t=cleanText(obj);
      return looksArabic(t)?t:'';
    }
    if (Array.isArray(obj)) return obj.map(getArabicValue).filter(Boolean).join('\n\n');
    if (typeof obj !== 'object') return '';
    for (const k of ['ar','arabic','textAr','arabicText','contentAr','text_ar','content_ar','fullText','text','content','verses']) {
      if (obj[k] != null) {
        const t=getArabicValue(obj[k]);
        if (t) return t;
      }
    }
    return '';
  }

  function add(title,text) {
    text=cleanText(text);
    if (!title || !text || !looksArabic(text)) return;
    const key=title+'|'+text.slice(0,300);
    if (seenText.has(key)) return;
    seenText.add(key);
    if (usedTitles.has(title)) {
      const existing=parts.find(p=>p.title===title);
      if (existing && !existing.text.includes(text)) existing.text += '\n\n' + text;
      return;
    }
    usedTitles.add(title);
    parts.push({title,text});
  }

  function walk(value, key='', section='', parentTitle='') {
    if (value == null) return;
    const nextSection=sectionOf(key,section);
    const title=titleOf(key,nextSection) || parentTitle;

    if (typeof value === 'string' || typeof value === 'number') {
      const t=cleanText(value);
      if (title && looksArabic(t)) add(title,t);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(v=>walk(v,key,nextSection,title));
      return;
    }
    if (typeof value !== 'object') return;

    if (title) {
      const direct=getArabicValue(value);
      if (direct && direct.length>20) add(title,direct);
    }

    for (const [k,v] of Object.entries(value)) {
      if (/^(id|date|gregorianDate|copticDate|language|slug|url|createdAt|updatedAt)$/i.test(k)) continue;
      walk(v,k,nextSection,title || '');
    }
  }

  walk(data);

  function scanFlat(value, section='') {
    if (Array.isArray(value)) { value.forEach(v=>scanFlat(v,section)); return; }
    if (!value || typeof value!=='object') return;
    const sec=sectionOf(value.section || value.service || value.category || '', section);
    const rawType=value.type || value.kind || value.name || value.title || value.readingType || '';
    const title=titleOf(rawType,sec);
    const text=getArabicValue(value);
    if (title && text) add(title,text);
    Object.entries(value).forEach(([k,v])=>{
      if (['text','content','verses','ar','arabic','arabicText','textAr','contentAr'].includes(k)) return;
      scanFlat(v,sectionOf(k,sec));
    });
  }
  scanFlat(data);

  const finalParts=order.map(title=>parts.find(p=>p.title===title)).filter(Boolean);
  renderKatamerosParts(finalParts);
  return finalParts.length > 0;
}

function openKholagy(){
  showScreen('kholagy-menu-screen');
}

const GREGORIAN_SOURCE_INDEX = 'https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/Arab-Copts-Mass-Book-003-index-Al-Koddas-Al-Ghreghory.html';
const GREGORIAN_CACHE_KEY = 'tareeq_nour_liturgy_text_v12';
const GREGORIAN_EDIT_KEY = 'tareeq_nour_gregorian_edits_v1';
let gregorianParts = [];
let selectedGregorianPart = -1;
let selectedGregorianLanguage = 'arabic';
let currentLiturgyType = 'gregorian';
const BASILIAN_SOURCE_INDEX = 'https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/Arab-Copts-Mass-Book-002-index-El-Kodas-El-Basily.html';

function gregorianReaderUrl(url){ return 'https://r.jina.ai/' + url; }

async function fetchGregorianMarkdown(url){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 35000);
  try {
    const response = await fetch(gregorianReaderUrl(url), {
      method:'GET',
      headers:{'Accept':'text/plain'},
      signal:controller.signal,
      cache:'no-store'
    });
    if(!response.ok) throw new Error(`تعذر جلب النص (${response.status})`);
    const text = await response.text();
    if(!text || text.length < 80) throw new Error('المصدر لم يُرجع نصًا كافيًا.');
    return text;
  } finally { clearTimeout(timer); }
}

function decodeMarkdownText(value){
  return value.replace(/\\([\\`*_{}\[\]()#+.!|>-])/g,'$1')
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
}

function gregorianMarkdownToHtml(markdown){
  const lines = markdown.split(/\r?\n/);
  const html=[];
  let paragraph=[];
  const flush=()=>{ if(paragraph.length){ html.push(`<p>${paragraph.join('<br>')}</p>`); paragraph=[]; } };
  for(let raw of lines){
    let line=raw.trim();
    if(!line){ flush(); continue; }
    if(/^([-*_])\1\1+$/.test(line)) { flush(); continue; }
    if(/^\[[0-9]+\]:/.test(line) || /^\s*\|?\s*[-:| ]+\|\s*$/.test(line)) continue;
    line=line.replace(/!\[[^\]]*\]\([^)]*\)/g,'')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'$1')
      .replace(/〖[^〗]*†([^〗]*)〗/g,'$1')
      .replace(/\*\*(.*?)\*\*/g,'$1').replace(/\*(.*?)\*/g,'$1')
      .replace(/`([^`]+)`/g,'$1');
    line=decodeMarkdownText(line);
    if(/^#{1,6}\s/.test(line)){ flush(); html.push(`<h4>${line.replace(/^#{1,6}\s*/,'')}</h4>`); }
    else if(/^>\s?/.test(line)){ flush(); html.push(`<blockquote>${line.replace(/^>\s?/,'')}</blockquote>`); }
    else if(/^[-*+]\s/.test(line)){ flush(); html.push(`<p class="gregorian-list-line">• ${line.replace(/^[-*+]\s/,'')}</p>`); }
    else if(/^\d+\.\s/.test(line)){ flush(); html.push(`<p class="gregorian-list-line">${line}</p>`); }
    else paragraph.push(line);
  }
  flush();
  return html.join('');
}

function extractGregorianIndex(markdown,type="gregorian"){
  const found=[];
  const section = type === 'basilian' ? '2-St-Basil-Liturgy' : '3-St-Gregory-Liturgy';
  const source = String(markdown||'');
  // Accept the standard Markdown links returned by the reader and normalize
  // punctuation/HTML entities before validating the liturgy-specific folder.
  const patterns=[/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, /\[([^\]]+)\]\s*:\s*(https?:\/\/\S+)/g];
  for(const pattern of patterns){
    let match;
    while((match=pattern.exec(source))!==null){
      const title=decodeMarkdownText(match[1].replace(/^\d+[.)]?\s*/, '').trim());
      let url=match[2].replace(/[),.;]+$/,'').replace(/&amp;/g,'&');
      if(url.startsWith('/')) url='https://st-takla.org'+url;
      if(url.includes('st-takla.org') && url.includes('/'+section+'/') && !/index-|index_/i.test(url) && !found.some(x=>x.url===url)) found.push({title,url});
    }
  }
  return found;
}

function readGregorianCache(){
  try { return JSON.parse(localStorage.getItem(GREGORIAN_CACHE_KEY)||'{}'); }
  catch(_){ return {}; }
}
function saveGregorianCache(cache){
  try { localStorage.setItem(GREGORIAN_CACHE_KEY,JSON.stringify(cache)); } catch(_){}
}

function extractGregorianLanguages(markdown){
  // St-Takla's page layout is not fully regular: Arabic text may appear in the
  // final pipe-separated column OR on the following standalone line. Extract
  // Arabic independently from the table structure so a valid Arabic column
  // is not mistakenly reported as unavailable.
  const raw = String(markdown || '');
  const splitAt = raw.search(/تنسيق\s+مختلف/i);
  const main = splitAt >= 0 ? raw.slice(0, splitAt) : raw;
  const lines = main.split(/\r?\n/);
  const arabic=[], transliteration=[], coptic=[];
  const hasArabic = value => /[\u0600-\u06FF]/.test(value);
  const hasCoptic = value => /[\u2C80-\u2CFF]/.test(value);
  const clean = value => decodeMarkdownText(String(value||'')
    .replace(/\[[^\]]*\]\([^)]*\)/g,'')
    .replace(/\*\*/g,'').replace(/^>\s?/,'')
    .replace(/\s+/g,' ').trim());
  // Keep Arabic mode strictly Arabic: source rows can mix Arabic prayer,
  // Latin transliteration and English translation in the same extracted line.
  const cleanArabic = value => clean(value)
    // Keep Arabic text and meaningful Arabic punctuation only. Strip Latin
    // punctuation artifacts (dots, hyphens, semicolons, equals signs, etc.)
    // that leak from the source's transliteration column.
    .replace(/[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF0-9٠-٩\s،؟ـ]/g,' ')
    .replace(/\s+([،؟])/g,'$1')
    .replace(/([،؟]){2,}/g,'$1')
    .replace(/^[،؟]+|[،؟]+$/g,'')
    .replace(/\s+/g,' ').trim();
  const pushUnique = (arr,value) => {
    const v = arr === arabic ? cleanArabic(value) : clean(value);
    if(v && !arr.includes(v)) arr.push(v);
  };
  const roleOnly = /^(الكاهن|الشعب|الشماس|الشمامسة)\s*:?$/;
  const rolePrefix = /^(الكاهن|الشعب|الشماس|الشمامسة)\s*:?\s*/;
  const pushRole = role => { arabic.push(`[[ROLE:${role}]]`); };
  const splitRole = value => { const match=clean(value).match(/^(الكاهن|الشعب|الشماس|الشمامسة)\s*:?\s*(.*)$/); return match ? {role:match[1], text:(match[2]||'').trim()} : null; };

  // Remove website navigation, gallery/search controls, display settings and
  // footer appeals that can be included in the source page extraction. These
  // are site chrome, not part of the Gregorian liturgy.
  const isSiteChrome = value => /بحث\s*(?:الموقع|الكتاب\s*المقدس|الصور|في\s*الجاليري|الجاليري)|الجاليري|خيارات\s*(?:تغيير\s*الخلفية|تغيير\s*حجم\s*الخط|إخفاء\s*الصور)|تغيير\s*الخلفية|حجم\s*الخط|إخفاء\s*وإظهار\s*الصور|إظهار\s*الصور|إخفاء\s*الصور|إخفاء\s*الجداول|إظهار\s*الجداول|نرجو\s*الصلاة\s*من\s*أجل\s*خدمة\s*الموقع|خدمة\s*الموقع\s*والخدام|^\s*3?\s*0{2,3}\s*14\s*$/i.test(String(value||''));

  let previousRowHadTransliteration = false;
  for(const rawLine of lines){
    const line=rawLine.trim();
    if(!line || isSiteChrome(line) || /^#{1,6}\s/.test(line) || /^https?:\/\//i.test(line)) continue;
    if(/^(كتاب الخولاجي|القداس الغريغوري للقديس)/.test(line)) continue;
    if(/^(Priest|People|Deacon)\s*:?$/i.test(line)){ previousRowHadTransliteration=false; continue; }

    if(line.includes('|')){
      const parts=line.split('|').map(x=>x.trim()).filter(x=>!isSiteChrome(x));
      // The Arabic column is normally the last cell; accept any Arabic cell
      // to tolerate small source-format changes.
      const arabicCell=[...parts].reverse().find(cell=>hasArabic(cell));
      if(arabicCell){
        const roleData=splitRole(arabicCell);
        if(roleData){ pushRole(roleData.role); if(roleData.text) pushUnique(arabic,roleData.text); }
        else { const a=clean(arabicCell); if(a) pushUnique(arabic,a); }
      }

      // Coptic-script content, if the source ever provides it.
      for(const cell of parts){
        if(hasCoptic(cell)) pushUnique(coptic,cell.replace(/[|]/g,' '));
      }

      // The transliteration is generally the middle cell. Avoid taking
      // English explanatory text or role labels as Coptic transliteration.
      const middle=parts.length>=3 ? parts.slice(1,-1) : (parts.length===2 ? [parts[1]] : []);
      previousRowHadTransliteration=false;
      for(const candidate of middle){
        if(!candidate || hasArabic(candidate) || hasCoptic(candidate) || /^(Priest|People|Deacon)\s*:?$/i.test(candidate)) continue;
        if(/[A-Za-z`@;=]/.test(candidate)){ pushUnique(transliteration,candidate); previousRowHadTransliteration=true; }
      }
      continue;
    }

    // On many St-Takla pages the Arabic follows the table row on its own line.
    if(hasArabic(line)){
      const roleData=splitRole(line);
      if(roleData){ pushRole(roleData.role); if(roleData.text) pushUnique(arabic,roleData.text); }
      else { const a=clean(line); if(a && !roleOnly.test(a)) pushUnique(arabic,a); }
    }
    if(hasCoptic(line)) pushUnique(coptic,line);

    // In St-Takla's source, long Coptic transliteration phrases often wrap
    // onto their own lines after a table row. Short responses such as
    // 'Amyn.' are also standalone, so keep Latin lines that continue a
    // transliteration row instead of silently dropping them.
    if(!hasArabic(line) && !hasCoptic(line) && /[A-Za-z]/.test(line) &&
       (previousRowHadTransliteration || /[`@;=]/.test(line)) &&
       !/^(For |We |You |Take |This |Amen\b|Priest\b|People\b|Deacon\b)/i.test(line)){
      pushUnique(transliteration,line);
      previousRowHadTransliteration=true;
    } else if(hasArabic(line) || /^(For |We |You |Take |This |Amen\b)/i.test(line)){
      previousRowHadTransliteration=false;
    }
  }

  return {arabic:arabic.join('\n'), coptic:coptic.join('\n'), transliteration:transliteration.join('\n')};
}

function gregorianLanguageHtml(text, language){
  if(!text) return '';
  return text.split(/\n+/).map(line=>line.trim()).filter(Boolean)
    .map(line=>{
      const role=line.match(/^\[\[ROLE:(الكاهن|الشعب|الشماس|الشمامسة)\]\]$/);
      if(role) return `<div class=\"gregorian-role-divider\"><span>${escapeHtml(role[1])}</span></div>`;
      return `<p>${escapeHtml(line)}</p>`;
    }).join('');
}

function readGregorianEdits(){ try{return JSON.parse(localStorage.getItem(GREGORIAN_EDIT_KEY)||'{}');}catch(_){return {};} }
function gregorianEditId(part,language){ return `${part && part.url || 'unknown'}::${language}`; }
function saveGregorianEditedText(){
  const part=gregorianParts[selectedGregorianPart];
  const editor=document.getElementById('gregorian-text-editor');
  if(!part || !editor) return;
  const edits=readGregorianEdits(); edits[gregorianEditId(part,selectedGregorianLanguage)]=editor.value;
  try{localStorage.setItem(GREGORIAN_EDIT_KEY,JSON.stringify(edits));}catch(_){alert('تعذر حفظ التعديل على الجهاز.');return;}
  renderGregorianParts();
}
function downloadGregorianText(){
  const part=gregorianParts[selectedGregorianPart]; if(!part) return;
  const data=extractGregorianLanguages(part.text||'');
  const edits=readGregorianEdits();
  const value=Object.prototype.hasOwnProperty.call(edits,gregorianEditId(part,selectedGregorianLanguage))?edits[gregorianEditId(part,selectedGregorianLanguage)]:(data[selectedGregorianLanguage]||'');
  const blob=new Blob([value],{type:'text/plain;charset=utf-8'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`${part.title.replace(/[^\u0600-\u06FF\w-]+/g,'_')}_${selectedGregorianLanguage}.txt`; a.click(); URL.revokeObjectURL(url);
}
function renderGregorianParts(){
  const content=document.getElementById('liturgy-content');
  if(!content) return;
  const cached=gregorianParts.filter(p=>p.text).length;
  const selected=gregorianParts[selectedGregorianPart];
  const languageData=selected && selected.text ? extractGregorianLanguages(selected.text) : null;
  const availableArabic=!!(languageData && languageData.arabic);
  const languageLabels={arabic:'عربي',coptic:'قبطي',transliteration:'قبطي معرّب'};
  let prayerBody='';
  let chosenForEditor='';
  if(selected && selected.text){
    const edits=readGregorianEdits();
    const editId=gregorianEditId(selected,selectedGregorianLanguage);
    const chosen=Object.prototype.hasOwnProperty.call(edits,editId)?edits[editId]:(languageData[selectedGregorianLanguage]||'');
    chosenForEditor=chosen;
    if(!chosen){
      prayerBody=`<div class="gregorian-language-unavailable">${selectedGregorianLanguage==='arabic'?'النص العربي':'النص'} غير متوفر بشكل منفصل في صفحة المصدر لهذه الصلاة.</div>`;
    } else {
      prayerBody=`<div class="gregorian-part-body ${selectedGregorianLanguage==='arabic'?'gregorian-arabic-text':''} ${selectedGregorianLanguage==='transliteration'?'gregorian-translit-text':''}">${gregorianLanguageHtml(chosen,selectedGregorianLanguage)}</div>`;
    }
  }
  content.innerHTML=`
    <section class="liturgy-source-card gregorian-reader-card">
      <div class="liturgy-source-heading">✝️ ${currentLiturgyType==='basilian'?'القداس الباسيلي':'القداس الغريغوري'}</div>
      <p class="liturgy-source-note">اختر جزءًا من الفهرس لعرض النص العربي الكامل مباشرةً، وليس روابط نتائج بحث.</p>
      ${buildTextPicker('gregorian',gregorianParts,selectedGregorianPart,'الصلاة')}
      <div class="gregorian-progress" role="status">${cached} من ${gregorianParts.length} صلاة محفوظة على الجهاز</div>
      ${selected ? `<article class="gregorian-selected-prayer">
        <h3>${escapeHtml(selected.title)}</h3>
        ${selected.text ? prayerBody : `<div class="gregorian-part-message">${selected.error?escapeHtml(selected.error):'جاري جلب نص الصلاة…'}</div>`}
        <div class="gregorian-actions">
          <button type="button" class="gregorian-reload-btn" id="gregorian-edit-toggle">تعديل النص</button>
          <button type="button" class="gregorian-reload-btn" id="gregorian-download">حفظ كملف TXT</button>
          <button type="button" class="gregorian-reload-btn" onclick="loadSelectedGregorianPart(true)">إعادة تحميل المصدر</button>
        </div>
        <div class="gregorian-editor-wrap" id="gregorian-editor-wrap" hidden>
          <label for="gregorian-text-editor">حرّر النص، ثم اضغط حفظ التعديل</label>
          <textarea id="gregorian-text-editor" dir="auto" spellcheck="false">${escapeHtml(chosenForEditor)}</textarea>
          <button type="button" class="gregorian-reload-btn" id="gregorian-save-edit">حفظ التعديل</button>
          <p class="gregorian-editor-hint">التعديلات محفوظة على هذا الجهاز ويمكن تصديرها كملف نصي.</p>
        </div>
      </article>` : `<div class="gregorian-empty-selection">اختر صلاة من القائمة لعرض نصها فقط.</div>`}
      <div class="gregorian-source-credit">المصدر: كتاب الخولاجي المنشور على موقع الأنبا تكلا — نصوص الصلوات العربية الأصلية.</div>
    </section>`;

  const editToggle=document.getElementById('gregorian-edit-toggle');
  if(editToggle) editToggle.addEventListener('click',()=>{const box=document.getElementById('gregorian-editor-wrap');box.hidden=!box.hidden;});
  const saveEdit=document.getElementById('gregorian-save-edit'); if(saveEdit) saveEdit.addEventListener('click',saveGregorianEditedText);
  const downloadEdit=document.getElementById('gregorian-download'); if(downloadEdit) downloadEdit.addEventListener('click',downloadGregorianText);
  // Arabic-only mode for both liturgies for now.
}

async function loadSelectedGregorianPart(force=false){
  const part=gregorianParts[selectedGregorianPart];
  if(!part) return;
  const cache=readGregorianCache();
  if(!force && cache[part.url]){ part.text=cache[part.url]; part.error=''; renderGregorianParts(); return; }
  part.text=''; part.error=''; renderGregorianParts();
  try{
    const markdown=await fetchGregorianMarkdown(part.url);
    part.text=markdown;
    cache[part.url]=markdown;
    saveGregorianCache(cache);
  }catch(error){
    part.error=error && error.name==='AbortError'?'انتهت مهلة الاتصال. حاول مرة أخرى.':(error.message||'تعذر جلب نص الصلاة.');
  }
  renderGregorianParts();
}

async function openLiturgy(type){
  const gregorian = type === 'gregorian';
  const title = gregorian ? 'القداس الغريغوري' : 'القداس الباسيلي';
  currentLiturgyType = gregorian ? 'gregorian' : 'basilian';
  selectedGregorianLanguage='arabic';
  showScreen('liturgy-screen');
  const heading=document.getElementById('liturgy-title');
  const content=document.getElementById('liturgy-content');
  if(heading) heading.textContent=title;
  if(!content) return;
  const sourceIndex = gregorian ? GREGORIAN_SOURCE_INDEX : BASILIAN_SOURCE_INDEX;
  content.innerHTML=`<div class="loading-card">جاري تحميل نصوص ${title} العربية من كتاب الخولاجي على موقع الأنبا تكلا…</div>`;
  try{
    const indexMarkdown=await fetchGregorianMarkdown(sourceIndex);
    const links=extractGregorianIndex(indexMarkdown,currentLiturgyType);
    if(!links.length) throw new Error('لم أتمكن من قراءة فهرس الأجزاء من المصدر.');
    if(currentLiturgyType==='basilian'){
      // إضافات طلبها المستخدم بالاسم، مع ربط كل اختيار بصفحة نصه الفعلية.
      const extraBasilianParts=[
        ['أوشية الرحمة','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-041-Usheiet-El-Rahma.html'],
        ['أوشية القمامصة والقسوس','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-020-Ooshet-El-Abaa.html'],
        ['أوشية الآباء','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-020-Ooshet-El-Abaa.html'],
        ['أوشية السلامة','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-019-Ooshiat-Al-Salam.html'],
        ['طلبات نعم نسألك (من القداس الغريغوري)','https://madraset-elshamamsa.com/articles/Taqs/AwashyOdas.php'],
        ['سر حلول الروح القدس – ففيما نحن أيضًا','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-037-Fafeema-Nahno-Aidan.html'],
        ['رشومات الخبز','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-034-Reshomat-El-Khobz.html'],
        ['رشومات الكأس','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-035-Roshomat-Al-Ka2s.html'],
        ['وقام من بين الأموات','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-032-Aftonf-Evool.html'],
        ['تجسد وتأنس','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-031-Avetshy-Sareks-Oowoh.html'],
        ['اسبسمس','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-023-Onoof-Emmo-Maria.html'],
        ['الشاروبيم يسجدون لك','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-028-Ni-Cherubim.html'],
        ['أيها الرب إله القوات','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-029-Epchois-Evnooty.html'],
        ['الرب مع جميعكم – مستحق وعادل','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-027-Akseio-Ke-Thike2on.html'],
        ['بشفاعة والدة الإله','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-02-Deacons-Service/Khedmet-El-Shammas/Maradat-088-Beshafa3et-Waledat-Al-Ilah.html'],
        ['قبلوا بعضكم بعضًا','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-024-Kabelo-Ba3dakom-Ba3dan.html'],
        ['اسبسمس آدام – افرحي يا مريم','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-023-Onoof-Emmo-Maria.html'],
        ['صلاة الصلح الثانية – للقديس يوحنا','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-026-Salat-El-Sol7-St-John.html'],
        ['صلاة الصلح','https://st-takla.org/Lyrics-Spiritual-Songs/Words-of-Coptic-Alhan-Tasbeha-Kodas/Arabic-Coptic-Liturgy-Lyrics/2-St-Basil-Liturgy/St-Basilious-Mass-022-Salat-El-Solh.html']
      ];
      for(const [title,url] of extraBasilianParts){
        if(!links.some(item=>item.title===title)) links.push({title,url});
      }
    }
    const cache=readGregorianCache();
    gregorianParts=links.map(item=>({ ...item, text:cache[item.url]||'', error:'' }));
    selectedGregorianPart=-1;
    renderGregorianParts();
  }catch(error){
    content.innerHTML=`<div class="loading-card">تعذر جلب فهرس ${title} حاليًا.<br><br>${escapeHtml(error.message||'تحقق من اتصال الإنترنت ثم أعد المحاولة.')}<br><br><button type="button" onclick="openLiturgy('${currentLiturgyType}')">إعادة المحاولة</button></div>`;
  }
}

function openFeasts(){
  showScreen('feasts-screen');
  const entries=(window.KATAMEROS_CODE_TEXTS && window.KATAMEROS_CODE_TEXTS.feasts) || [];
  const list=document.getElementById('feasts-list');
  const view=document.getElementById('feasts-content');
  const count=document.getElementById('feasts-count');
  if(!list || !view) return;
  if(!entries.length){ list.innerHTML='<div class="feasts-empty">لا توجد أعياد مضافة حاليًا.</div>'; return; }
  const categoryOf=(item)=>item.category || (/عذراء/.test(item.title)?'أعياد السيدة العذراء':/يونان|لعازر|الشعانين|العهد|الجمعة العظيمة|سبت/.test(item.title)?'أسبوع الآلام والأعياد المتحركة':/نيروز|صليب|رسل|مارمرقس|ملاك|تذكار/.test(item.title)?'أعياد وتذكارات كنسية':'الأعياد السيدية');
  const groups={}; entries.forEach((item,index)=>(groups[categoryOf(item)] ||= []).push({...item,index}));
  if(count) count.textContent=`${entries.length} مناسبة`;
  list.innerHTML=`
    <div class="daily-selector-wrap">
      <button type="button" class="daily-selector-btn" onclick="toggleDailyPicker('feasts')" aria-expanded="false">
        <span id="feasts-selected-label">اختر العيد أو المناسبة</span><span class="prayer-selector-arrow">⌄</span>
      </button>
    </div>
    <div id="feasts-picker" class="daily-picker-overlay" onclick="closeDailyPicker('feasts',event)" aria-hidden="true">
      <div class="daily-picker" onclick="event.stopPropagation()">
        <div class="daily-picker-head"><strong>اختر العيد أو المناسبة</strong><button type="button" onclick="toggleDailyPicker('feasts')" aria-label="إغلاق">×</button></div>
        <input id="feasts-picker-search" class="feasts-picker-search" type="search" placeholder="ابحث عن عيد…" autocomplete="off">
        <div id="feasts-choice-list" class="daily-choice-list"></div>
      </div>
    </div>`;
  const renderChoices=(query='')=>{
    const q=query.trim().toLocaleLowerCase('ar');
    const target=document.getElementById('feasts-choice-list');
    const filteredGroups=Object.entries(groups).map(([name,items])=>[name,items.filter(x=>`${x.title||''} ${x.text||''}`.toLocaleLowerCase('ar').includes(q))]).filter(([,items])=>items.length);
    if(target) target.innerHTML=filteredGroups.length?filteredGroups.map(([name,items])=>`<div class="feasts-picker-group"><h3>${escapeHtml(name)}</h3>${items.map(x=>`<button type="button" class="daily-choice" onclick="chooseFeast(${x.index})">${escapeHtml(x.title||`مناسبة ${x.index+1}`)}</button>`).join('')}</div>`).join(''):'<div class="feasts-empty">لا توجد نتائج مطابقة.</div>';
  };
  document.getElementById('feasts-picker-search').addEventListener('input',e=>renderChoices(e.target.value));
  renderChoices();
  window.__feastEntries=entries;
  chooseFeast(0,false);
}
const FEAST_RITES_SOURCE = 'https://copticorthodox.church/الكنيسة/coptic-rites/';
const FEAST_SOURCE_ALIASES = [
  [/نيروز/, ['النيروز','رأس السنة القبطية']],
  [/صليب/, ['عيد الصليب','الأعياد السيدية']],
  [/كيهك|الميلاد|برامون الميلاد/, ['عيد الميلاد','صوم الميلاد','كيهك']],
  [/ختان/, ['عيد الختان']], [/غطاس|برامون عيد الغطاس/, ['عيد الغطاس']],
  [/قانا/, ['عرس قانا الجليل']], [/الهيكل/, ['دخول السيد المسيح إلى الهيكل']],
  [/يونان/, ['صوم يونان']], [/الصوم الكبير/, ['الصوم الكبير']],
  [/لعازر/, ['سبت لعازر']], [/شعانين/, ['أحد الشعانين']],
  [/خميس العهد/, ['خميس العهد']], [/سبت الفرح|سبت النور/, ['سبت الفرح','سبت النور']],
  [/بصخة|الآلام|الجمعة العظيمة/, ['أسبوع الآلام','الجمعة الكبيرة']],
  [/قيامة/, ['عيد القيامة']], [/صعود/, ['عيد الصعود']], [/عنصرة|الروح القدس/, ['عيد حلول الروح القدس','العنصرة']],
  [/أرض مصر/, ['دخول السيد المسيح مصر']], [/رسل/, ['صوم الرسل','عيد الرسل']],
  [/بشارة/, ['عيد البشارة']], [/العذراء/, ['صوم السيدة العذراء']],
  [/التجلي/, ['عيد التجلي']], [/29|التذكار الشهري/, ['اليوم الـ 29 من كل شهر قبطي']]
];
function feastPlainText(markdown){
  return String(markdown||'').split(/\r?\n/).map(line=>line.trim())
    .filter(line=>line && !/^\[[0-9]+\]:/.test(line) && !/^https?:\/\//i.test(line) && !/^\|?\s*[-:| ]+\|?$/.test(line))
    .map(line=>line.replace(/^#{1,6}\s*/,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'$1').replace(/\*\*(.*?)\*\*/g,'$1')
      .replace(/\*(.*?)\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\s+/g,' ').trim())
    .filter(line=>line && !/^(Contents|Table of Contents|بحث|القائمة الرئيسية)$/i.test(line));
}
function feastNormalize(s){return String(s||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/[ىي]/g,'ي').replace(/ال/g,' ').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[^\u0600-\u06FFa-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
function feastSection(lines, item){
  const aliases=FEAST_SOURCE_ALIASES.find(([re])=>re.test(item.title||''))?.[1]||[item.title];
  const normalized=lines.map(feastNormalize);
  let at=-1;
  for(const alias of aliases){const key=feastNormalize(alias); at=normalized.findIndex(x=>x===key || (key.length>3 && x.includes(key))); if(at>=0) break;}
  if(at<0){
    const words=feastNormalize(item.title).split(' ').filter(w=>w.length>3);
    at=normalized.findIndex(x=>words.some(w=>x.includes(w)));
  }
  if(at<0) return lines;
  let stop=Math.min(lines.length,at+45);
  for(let i=at+1;i<stop;i++) if(/^\d+\s*[-.)]/.test(lines[i])) {stop=i;break;}
  return lines.slice(at,stop);
}
async function loadFeastLibrary(index, item){
  const box=document.getElementById('feast-library-content'); if(!box) return;
  box.innerHTML='<div class="loading-card">جاري تحميل فهرس صلوات '+escapeHtml(item.title||'المناسبة')+'…</div>';
  const root='https://tasbeha.org/hymn_library/';
  const proxyUrls=u=>[ 'https://r.jina.ai/https://'+u.replace(/^https?:\/\//,''), 'https://r.jina.ai/http://'+u.replace(/^https?:\/\//,'') ];
  const fetchText=async(u)=>{
    let last;
    for(const endpoint of proxyUrls(u)){
      try{
        const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),22000);
        const response=await fetch(endpoint,{cache:'no-store',signal:controller.signal,headers:{'Accept':'text/plain'}});
        clearTimeout(timer);
        if(!response.ok) throw new Error('HTTP '+response.status);
        const body=await response.text();
        if(!body || body.length<40) throw new Error('المصدر أعاد صفحة فارغة');
        return body;
      }catch(e){last=e;}
    }
    throw last||new Error('تعذر الاتصال بمصدر النصوص');
  };
  const decode=s=>String(s||'').replace(/&amp;/g,'&').replace(/&#x2F;/gi,'/').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  const parseLinks=(body,base)=>{
    const out=[]; let m;
    const md=/\[([^\]]+)\]\(([^)]+)\)/g;
    while((m=md.exec(body))){
      const title=decode(m[1].replace(/\*\*/g,'').replace(/<[^>]+>/g,'')).trim();
      const raw=decode(m[2].replace(/^<|>$/g,'').trim());
      try{out.push({title,url:new URL(raw,base).href});}catch(_){}
    }
    const html=/href=["']([^"']*\/hymn_library\/(?:view|cat)\/\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while((m=html.exec(body))){try{out.push({title:decode(m[2].replace(/<[^>]+>/g,'').trim()),url:new URL(decode(m[1]),base).href});}catch(_){}}
    const urls=body.match(/https?:\/\/tasbeha\.org\/hymn_library\/(?:view|cat)\/\d+(?:\?[^\s)"<>]*)?/gi)||[];
    urls.forEach(url=>out.push({title:'',url}));
    return out.filter(x=>x.url);
  };
  const cleanTitle=s=>decode(String(s||'').replace(/\*\*/g,'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
  try{
    const home=await fetchText(root+'all-categories');
    const links=parseLinks(home,root+'all-categories').filter(x=>/\/hymn_library\/cat\/\d+/i.test(x.url));
    const title=String(item.title||'');
    const aliasEntry=FEAST_SOURCE_ALIASES.find(([re])=>re.test(title));
    const aliases=[title,...(aliasEntry?.[1]||[])].map(feastNormalize).filter(Boolean);
    let category=links.find(x=>aliases.some(k=>k.length>2 && feastNormalize(x.title).includes(k)));
    // Known, dedicated categories in Tasbeha's own catalogue.
    if(!category && /العذراء/.test(title)) category={title:'St. Mary',url:root+'cat/276'};
    if(!category) throw new Error('لم أجد فهرسًا مستقلًا موثقًا لهذه المناسبة في المصدر.');
    const catBody=await fetchText(category.url);
    let hymns=parseLinks(catBody,category.url).filter(h=>/\/hymn_library\/view\/\d+/i.test(h.url));
    // The reader sometimes emits the links as numbered references rather than Markdown links.
    if(!hymns.length){
      const refs=[...catBody.matchAll(/\[(\d+)\]\s*\[([^\]]+)\]\(([^)]+)\)/g)];
      hymns=refs.map(m=>({title:cleanTitle(m[2]),url:new URL(m[3],category.url).href})).filter(h=>/\/hymn_library\/view\/\d+/i.test(h.url));
    }
    const unique=[...new Map(hymns.map(h=>[h.url,{...h,title:cleanTitle(h.title)||('صلاة '+(hymns.indexOf(h)+1))}])).values()];
    if(!unique.length) throw new Error('وصلنا إلى فهرس المناسبة، لكن المصدر لم يُرجع روابط الصلوات. جرّب إعادة التحميل بعد قليل.');
    box.innerHTML=`<div class="feast-hymn-index"><h3>فهرس صلوات وألحان ${escapeHtml(item.title||'المناسبة')}</h3><div class="feast-hymn-list">${unique.map((h,i)=>`<button type="button" class="daily-choice feast-hymn-choice" data-hymn="${i}">${escapeHtml(h.title)}</button>`).join('')}</div><div id="feast-hymn-reading" class="feast-hymn-reading" aria-live="polite"></div><div class="feast-source-credit">المصدر: <a href="${category.url}" target="_blank" rel="noopener">مكتبة تسابيح – ${escapeHtml(category.title||'فهرس المناسبة')}</a></div></div>`;
    const buttons=box.querySelectorAll('[data-hymn]');
    buttons.forEach(btn=>btn.addEventListener('click',async()=>{
      const h=unique[Number(btn.dataset.hymn)], reader=box.querySelector('#feast-hymn-reading'); if(!h||!reader)return;
      buttons.forEach(b=>b.classList.toggle('active',b===btn));
      reader.innerHTML='<div class="loading-card">جاري تحميل كلمات الصلاة…</div>';
      try{
        const raw=await fetchText(h.url);
        const lines=feastPlainText(raw).filter(line=>!/^https?:\/\//i.test(line)&&!/^\[.*\]:/.test(line)&&!/^Last Updated:|^Added:|^You need to login/i.test(line));
        if(!lines.length) throw new Error('المصدر لم يوفر نصًا مقروءًا لهذه الصلاة.');
        reader.innerHTML=`<article class="reading-card"><h4>${escapeHtml(h.title)}</h4><div class="reading-text">${lines.map(line=>`<p>${escapeHtml(line)}</p>`).join('')}</div><div class="feast-source-credit"><a href="${h.url}" target="_blank" rel="noopener">فتح النص الأصلي</a></div></article>`;
      }catch(e){reader.innerHTML=`<div class="loading-card">تعذر تحميل كلمات الصلاة: ${escapeHtml(e.message||'خطأ في الاتصال')}</div>`;}
    }));
  }catch(error){
    box.innerHTML=`<div class="loading-card">${escapeHtml(error.message||'تعذر تحميل فهرس المناسبة')}<br><button type="button" class="daily-choice" onclick="loadFeastLibrary(${index},window.__feastEntries[${index}])">إعادة المحاولة</button><br>لم يتم استبدالها بصلوات غير مرتبطة.</div>`;
  }
}
function chooseFeast(index,close=true){
  const entries=window.__feastEntries||[];
  const item=entries[index]; if(!item) return;
  const label=document.getElementById('feasts-selected-label');
  const view=document.getElementById('feasts-content');
  if(label) label.textContent=item.title||`مناسبة ${index+1}`;
  if(view) view.innerHTML=`<section class="reading-card"><div class="feast-reading-kicker">✝ مناسبة كنسية</div><div class="reading-label">${escapeHtml(item.title||'')}</div><div class="reading-text">${escapeHtml(item.text||'').replace(/\n/g,'<br><br>')}</div><div id="feast-library-content" class="feast-library-content"></div><div class="feast-source-credit">المصدر الطقسي: موقع الكنيسة القبطية الأرثوذكسية</div></section>`;
  loadFeastLibrary(index,item);
  if(close) closeDailyPicker('feasts');
}
async function openSynaxarium() {
  showScreen('synaxarium-screen');
  const date=todayISO();
  document.getElementById('synaxarium-date').textContent=`سنكسار اليوم • ${date}`;
  document.getElementById('synaxarium-content').innerHTML='<div class="loading-card">جاري تحميل سنكسار اليوم بالعربية…</div>';
  const day=date.slice(8,10), month=date.slice(5,7), year=date.slice(0,4);
  const sources=[
    `https://r.jina.ai/https://www.elkanisa.com/coptic/synaxarium/${date}`,
    `https://www.elkanisa.com/coptic/synaxarium/${date}`,
    `https://r.jina.ai/https://copticorthodox.church/synaxarion/`,
    `https://copticorthodox.church/synaxarion/`,
    `https://r.jina.ai/https://www.copticchurch.net/synaxarium/all/ar`
  ];
  for(const url of sources){
    try{
      const html=await fetchText([url]);
      if(/copticorthodox\.church\/synaxarion\/$/.test(url) || /copticorthodox\.church\/synaxarion\/?$/.test(url)) {
        if(await renderSynaxariumIndexHtml(html,date)) return;
      } else if(renderSynaxariumArabicHtml(html,date)) return;
    } catch(e){ console.warn('Synaxarium source failed',url,e); }
  }
  try{
    const data=await fetchJson([`${COPTIC_API}/synaxarium/${date}?lang=ar`,`https://synaxarium-api.vercel.app/synaxarium?date_gregorian=${date}`]);
    renderSynaxarium(data);
  }catch(e){showOnlineError('synaxarium-content','تعذر تحميل سنكسار اليوم من المصادر المتاحة حالياً.');}
}

function renderSynaxariumChoices(parts) {
  const root=document.getElementById('synaxarium-content');
  const items=parts.filter(p=>p&&p.text&&p.text.trim()).map((p,i)=>({...p,id:`synax-${i}`}));
  if(!items.length) return false;
  if(items.length===1){
    root.innerHTML=`<article class="synaxarium-card synax-section"><div class="synax-section-title">${escapeHtml(items[0].title)}</div><div class="synax-section-body">${escapeHtml(items[0].text).replace(/\n/g,'<br><br>')}</div></article>`;
    window.__synaxParts=items; window.__selectedSynaxPart=0; return true;
  }
  root.innerHTML=`
    <div class="daily-selector-wrap">
      <button type="button" class="daily-selector-btn" onclick="toggleDailyPicker('synaxarium')" aria-expanded="false">
        <span id="synaxarium-selected-label">${escapeHtml(items[0].title)}</span><span>⌄</span>
      </button>
    </div>
    <div id="synaxarium-part-view" class="daily-selected-view"></div>
    <div id="synaxarium-picker" class="daily-picker-overlay" onclick="closeDailyPicker('synaxarium',event)" aria-hidden="true">
      <div class="daily-picker" onclick="event.stopPropagation()">
        <div class="daily-picker-head"><strong>اختر الذكرى</strong><button type="button" onclick="toggleDailyPicker('synaxarium')">×</button></div>
        <div class="daily-choice-list">${items.map((p,i)=>`<button type="button" class="daily-choice" onclick="showSynaxariumPart(${i})"><span>${escapeHtml(p.title)}</span></button>`).join('')}</div>
      </div>
    </div>`;
  window.__synaxParts=items; window.__selectedSynaxPart=0; showSynaxariumPart(0,false); return true;
}
function showSynaxariumPart(index,smooth=true){
  const parts=window.__synaxParts||[]; if(!parts[index]) return;
  window.__selectedSynaxPart=index;
  const label=document.getElementById('synaxarium-selected-label'), view=document.getElementById('synaxarium-part-view');
  if(label) label.textContent=parts[index].title;
  if(view) view.innerHTML=`<article class="synaxarium-card synax-section"><div class="synax-section-title">${escapeHtml(parts[index].title)}</div><div class="synax-section-body">${escapeHtml(parts[index].text).replace(/\n/g,'<br><br>')}</div></article>`;
  closeDailyPicker('synaxarium'); if(smooth&&view) view.scrollIntoView({behavior:'smooth',block:'start'});
}

async function renderSynaxariumIndexHtml(html,date){
  const doc=new DOMParser().parseFromString(html,'text/html');
  const links=Array.from(doc.querySelectorAll('a[href]'));
  const dateParts=date.split('-');
  const year=dateParts[0], month=dateParts[1], day=String(Number(dateParts[2]));
  const candidates=links.filter(a=>{
    const text=(a.innerText||a.textContent||'').replace(/\s+/g,' ').trim();
    const href=a.getAttribute('href')||'';
    return text.includes(year) && (text.includes(day+' ') || text.includes(' '+day)) && /synaxarion/i.test(href);
  });
  for(const a of candidates.slice(0,3)){
    let href=a.href || a.getAttribute('href');
    if(!href) continue;
    try{
      const proxied=/^https?:\/\//.test(href) ? `https://r.jina.ai/${href}` : `https://r.jina.ai/https://copticorthodox.church${href}`;
      const article=await fetchText([proxied,href]);
      if(renderSynaxariumArabicHtml(article,date)) return true;
    }catch(e){ console.warn('Synaxarium article link failed',e); }
  }
  return false;
}

function renderSynaxariumArabicHtml(html,date){
  const doc=new DOMParser().parseFromString(html,'text/html');
  ['script','style','noscript','nav','header','footer','form'].forEach(sel=>doc.querySelectorAll(sel).forEach(x=>x.remove()));
  const root=doc.querySelector('main')||doc.querySelector('article')||doc.body;
  const nodes=root.querySelectorAll('h1,h2,h3,h4,h5,p,li,blockquote');
  const sections=[]; let current=null;
  const skip=/^(السنكسار اليومي|مصدر السنكسار|English|العربية|بحث|اليوم السابق|اليوم التالي|مشاركة|نسخ|التاريخ|المناسبة)$/i;
  nodes.forEach(n=>{
    const t=(n.innerText||n.textContent||'').replace(/\s+/g,' ').trim();
    if(!t||!looksArabic(t)||skip.test(t)) return;
    const heading=/^h[1-5]$/i.test(n.tagName);
    if(heading&&t.length<220){if(current&&current.text.trim()) sections.push(current);current={title:t,text:''};}
    else if(current) current.text+=(current.text?'\n':'')+t;
  });
  if(current&&current.text.trim()) sections.push(current);
  let clean=sections.filter(s=>s.text.trim().length>1);
  if(!clean.length){
    const lines=(root.innerText||root.textContent||'').split(/\n+/).map(x=>x.trim()).filter(x=>x&&looksArabic(x)&&!skip.test(x));
    if(lines.length) clean=[{title:'تذكارات اليوم',text:lines.join('\n')}];
  }
  return renderSynaxariumChoices(clean);
}

function renderSynaxarium(data){
  const copticDate=data?.coptic_date||data?.copticDate||data?.copticDateString;
  const feasts=data?.feasts||data?.celebrations||data?.commemorations||data?.saints||[];
  let description=stripHtml(data?.description||data?.content||data?.text||data?.body||'').trim();
  const feastList=Array.isArray(feasts)?feasts:(feasts?[feasts]:[]);
  const parts=feastList.map((x,i)=>({title:formatAnyText(x)||`ذكرى ${i+1}`,text:formatAnyText(x)||''})).filter(x=>x.text);
  if(description&&!parts.length) parts.push({title:copticDate?formatAnyText(copticDate):'تذكارات اليوم',text:description});
  if(!parts.length) return showOnlineError('synaxarium-content','تعذر تحميل سنكسار اليوم من المصادر المتاحة حالياً.');
  renderSynaxariumChoices(parts);
}

async function loadBibleData() {
  try {
    const response = await fetch('data/bible.txt', { cache: 'no-cache' });
    if (response.ok) {
      const text = await response.text();
      bibleData = parseBibleText(text);
    } else {
      bibleData = [];
    }
  } catch (error) {
    bibleData = [];
    console.warn('تعذر تحميل النسخة المحلية:', error);
  }

  console.log('✅ تم تجهيز بيانات الكتاب. سيتم جلب نص الإصحاح من الإنترنت عند فتحه.');
  return true;
}

const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
function toArabicDigits(number) {
  return String(number).replace(/[0-9]/g, d => arabicDigits[d]);
}

function fromArabicDigits(value) {
  return String(value).replace(/[٠-٩]/g, d => String(arabicDigits.indexOf(d)));
}

function normalizeArabicText(text) {
  return String(text || '')
    .replace(/\uFEFF/g, '')
    .replace(/\u200B/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const BSS_BOOK_NAMES = {
  'GEN':'Gen','EXO':'Ex','LEV':'Lev','NUM':'Num','DEU':'Deut','JOS':'Josh','JDG':'Judg','RUT':'Ruth',
  '1SA':'1 Sam','2SA':'2 Sam','1KI':'1 Kgs','2KI':'2 Kgs','1CH':'1 Chr','2CH':'2 Chr','EZR':'Ezra','NEH':'Neh',
  'EST':'Esth','JOB':'Job','PSA':'Ps','PRO':'Prov','ECC':'Eccl','SNG':'Song','ISA':'Isa','JER':'Jer','LAM':'Lam',
  'EZK':'Ezek','DAN':'Dan','HOS':'Hos','JOL':'Joel','AMO':'Amos','OBA':'Obad','JON':'Jonah','MIC':'Mic','NAM':'Nah',
  'HAB':'Hab','ZEP':'Zeph','HAG':'Hag','ZEC':'Zech','MAL':'Mal','MAT':'Matt','MRK':'Mark','LUK':'Luke','JHN':'John',
  'ACT':'Acts','ROM':'Rom','1CO':'1 Cor','2CO':'2 Cor','GAL':'Gal','EPH':'Eph','PHP':'Phil','COL':'Col','1TH':'1 Thess',
  '2TH':'2 Thess','1TI':'1 Tim','2TI':'2 Tim','TIT':'Titus','PHM':'Phlm','HEB':'Heb','JAS':'Jas','1PE':'1 Pet','2PE':'2 Pet',
  '1JN':'1 John','2JN':'2 John','3JN':'3 John','JUD':'Jude','REV':'Rev'
};

function chapterCacheKey(bookName, chapterNum) {
  const code = (typeof bibleBookCodes !== 'undefined' && bibleBookCodes[bookName]) || bookName;
  return `bible_chapter_cache_v3_${code}_${Number(chapterNum)}`;
}

function readCachedChapter(bookName, chapterNum) {
  try {
    const cached = localStorage.getItem(chapterCacheKey(bookName, chapterNum));
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return parsed.filter(v => v && Number(v.number) > 0 && String(v.text || '').trim());
  } catch (e) {
    console.warn('تعذر قراءة الكاش:', e);
    return null;
  }
}

function saveCachedChapter(bookName, chapterNum, verses, source) {
  try {
    const clean = verses.map(v => ({ number: Number(v.number), text: normalizeArabicText(v.text) }));
    localStorage.setItem(chapterCacheKey(bookName, chapterNum), JSON.stringify(clean));
    localStorage.setItem(`bible_chapter_source_${(typeof bibleBookCodes !== 'undefined' && bibleBookCodes[bookName]) || bookName}_${Number(chapterNum)}`, source);
    localStorage.setItem('bible_last_generated', JSON.stringify({ bookName, chapterNum:Number(chapterNum), source, time:Date.now() }));
  } catch (e) {
    console.warn('تعذر حفظ الإصحاح محلياً:', e);
  }
}

function normalizeApiVerses(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(v => ({ number: Number(v.verse), text: normalizeArabicText(v.text) }))
    .filter(v => Number.isFinite(v.number) && v.number > 0 && v.text)
    .sort((a,b) => a.number - b.number);
}

async function fetchFromBibleSuperSearch(bookName, chapterNum) {
  const code = bibleBookCodes?.[bookName];
  const shortName = code ? BSS_BOOK_NAMES[code] : null;
  if (!shortName) throw new Error(`لا يوجد اسم API للسفر: ${bookName}`);

  const reference = `${shortName} ${Number(chapterNum)}`;
  const url = `https://bethie.api.biblesupersearch.com/api?bible=svd&reference=${encodeURIComponent(reference)}&data_format=minimal&page_all=true`;

  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    cache: 'no-store',
    headers: { 'Accept': 'application/json' }
  });
  if (!response.ok) throw new Error(`Bible SuperSearch HTTP ${response.status}`);

  const data = await response.json();
  if (data?.errors?.length) throw new Error(data.errors.join('، '));

  const verses = normalizeApiVerses(data?.results?.svd);
  if (!verses.length) throw new Error('المصدر الثاني لم يُرجع آيات');
  return verses;
}

async function fetchFromEBible(bookName, chapterNum) {
  const code = bibleBookCodes?.[bookName];
  if (!code) throw new Error(`لا يوجد رمز للسفر: ${bookName}`);

  const url = `https://ebible.org/arb-vd/${code}${String(chapterNum).padStart(2, '0')}.htm`;
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    mode: 'cors',
    headers: { 'Accept': 'text/html,application/xhtml+xml' }
  });
  if (!response.ok) throw new Error(`eBible HTTP ${response.status}`);

  const html = await response.text();
  if (!html || html.length < 100) throw new Error('صفحة eBible فارغة');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('main, article, #main') || doc.body;
  root.querySelectorAll('script,style,noscript,nav,header,footer,form,aside,.navbar,.menu').forEach(el => el.remove());

  let text = normalizeArabicText(root.textContent || '')
    .replace(/[٠-٩]/g, d => String(arabicDigits.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

  const matches = [];
  const re = /(?:^|\s)([0-9]{1,3})(?=\s)/g;
  let m;
  while ((m = re.exec(text))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 200) matches.push({number:n, index:m.index, end:re.lastIndex});
  }

  const ordered = [];
  let expected = 1;
  for (const item of matches) {
    if (item.number === expected) {
      ordered.push(item);
      expected++;
    }
  }
  if (!ordered.length) throw new Error('تعذر استخراج آيات eBible');

  const verses = [];
  for (let i=0; i<ordered.length; i++) {
    const start = ordered[i].end;
    const end = i+1 < ordered.length ? ordered[i+1].index : text.length;
    const verseText = normalizeArabicText(text.slice(start,end)).replace(/^[|•·\-–—]+\s*/, '');
    if (verseText) verses.push({number:ordered[i].number, text:verseText});
  }
  if (!verses.length) throw new Error('تعذر استخراج نص eBible');
  return verses;
}

async function fetchRemoteChapter(bookName, chapterNum) {
  const cached = readCachedChapter(bookName, chapterNum);
  if (cached?.length) {
    console.log(`📦 تم تحميل ${bookName} ${chapterNum} من الحفظ المحلي`);
    return cached;
  }

  const sources = [
    { name:'eBible', fn:() => fetchFromEBible(bookName, chapterNum) },
    { name:'Bible SuperSearch', fn:() => fetchFromBibleSuperSearch(bookName, chapterNum) }
  ];

  let lastError = null;
  for (const source of sources) {
    for (let attempt=1; attempt<=2; attempt++) {
      try {
        const verses = await source.fn();
        if (!verses?.length) throw new Error('النص فارغ');
        saveCachedChapter(bookName, chapterNum, verses, source.name);
        console.log(`🌐 تم توليد ${bookName} ${chapterNum} من ${source.name} وتم حفظه`);
        return verses;
      } catch (err) {
        lastError = err;
        console.warn(`فشل ${source.name} - محاولة ${attempt}:`, err);
        if (attempt < 2) await new Promise(r => setTimeout(r, 250 * attempt));
      }
    }
  }
  throw lastError || new Error('فشلت كل مصادر الإنترنت');
}

async function getChapterVerses(bookName, chapterNum) {
  try {
    const remoteVerses = await fetchRemoteChapter(bookName, chapterNum);

    if (!Array.isArray(bibleData)) bibleData = [];
    let targetBook = bibleData.find(b => b.name === bookName);
    if (!targetBook) {
      targetBook = { name: bookName, chapters: [] };
      bibleData.push(targetBook);
    }
    targetBook.chapters[chapterNum - 1] = remoteVerses;

    return remoteVerses;
  } catch (remoteError) {
    console.warn('فشل المصدر الإنترنتي، سيتم استخدام النسخة المحلية كاحتياط:', remoteError);

    const book = Array.isArray(bibleData)
      ? bibleData.find(b => b.name === bookName)
      : null;

    const localVerses = book?.chapters?.[chapterNum - 1];
    if (Array.isArray(localVerses) && localVerses.length) {
      return localVerses
        .join(' ')
        .split(/\s*(?=(?:[0-9٠-٩]+)\s*)/)
        .map(v => v.trim())
        .filter(Boolean)
        .map((v, i) => {
          const match = v.match(/^([0-9٠-٩]+)\s*(.*)$/);
          return {
            number: match ? Number(fromArabicDigits(match[1])) : i + 1,
            text: match ? match[2].trim() : v
          };
        });
    }

    throw remoteError;
  }
}

function parseBibleText(text) {
  const lines = String(text || '').replace(/\uFEFF/g, '').split(/\r?\n/);
  const books = [];
  let currentBook = null;
  let currentChapter = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#\s+/.test(line) && !/^##\s+/.test(line)) {
      const bookName = line.replace(/^#\s+/, '').trim();
      currentBook = { name: bookName, chapters: [] };
      books.push(currentBook);
      currentChapter = null;
      continue;
    }

    if (/^##\s+/.test(line)) {
      if (!currentBook) continue;
      currentChapter = [];
      currentBook.chapters.push(currentChapter);
      continue;
    }

    if (currentChapter) {
      currentChapter.push(line);
    }
  }

  return books;
}

let generatedBibleNavigation = {
  old: [],
  new: [],
  chapters: {}
};

function buildBibleNavigation() {
  const oldMeta = Array.isArray(oldTestament) ? oldTestament : [];
  const newMeta = Array.isArray(newTestament) ? newTestament : [];

  generatedBibleNavigation.old = oldMeta.map(book => ({
    name: book.name,
    chaptersCount: Number(book.chapters) || 0
  }));

  generatedBibleNavigation.new = newMeta.map(book => ({
    name: book.name,
    chaptersCount: Number(book.chapters) || 0
  }));

  [...generatedBibleNavigation.old, ...generatedBibleNavigation.new].forEach(book => {
    generatedBibleNavigation.chapters[book.name] =
      Array.from({ length: book.chaptersCount }, (_, i) => i + 1);
  });

  renderTestamentBooks('old');
  renderTestamentBooks('new');

  console.log('✅ تم توليد قوائم الأسفار والإصحاحات تلقائياً');
}

function renderTestamentBooks(type) {
  const list = document.getElementById('books-list');
  if (!list) return;

  const books = generatedBibleNavigation[type] || [];
  list.innerHTML = '';

  books.forEach((book, i) => {
    const div = document.createElement('div');
    div.className = 'book-item';
    div.innerHTML = `
      <div class="book-number">${i + 1}</div>
      <div class="book-name">${book.name}</div>
      <span>←</span>
    `;
    div.onclick = () => openBook(book.name, book.chaptersCount);
    list.appendChild(div);
  });
}

function openTestament(type) {
  currentTestament = type;

  const title = type === 'old' ? 'العهد القديم' : 'العهد الجديد';
  document.getElementById('books-title').textContent = title;

  renderTestamentBooks(type);
  showScreen('books-screen');
}

function backToBooks() {
  openTestament(currentTestament);
}

function openBook(bookName, chaptersCount) {
  currentBook = bookName;
  document.getElementById('chapters-title').textContent = bookName;

  const grid = document.getElementById('chapters-grid');
  grid.innerHTML = '';

  const chapters = generatedBibleNavigation.chapters[bookName]
    || Array.from({ length: chaptersCount || 0 }, (_, i) => i + 1);

  chapters.forEach(chapterNum => {
    const btn = document.createElement('div');
    btn.className = 'chapter-btn';
    btn.textContent = chapterNum;
    btn.onclick = () => openChapter(bookName, chapterNum);
    grid.appendChild(btn);
  });

  showScreen('chapters-screen');
}

function backToChapters() {
  const book = Array.isArray(bibleData) ? bibleData.find(b => b.name === currentBook) : null;
  const meta = generatedBibleNavigation.chapters[currentBook];
  openBook(currentBook, book ? book.chapters.length : (meta ? meta.length : 1));
}

async function openChapter(bookName, chapterNum) {
  stopSpeaking();
  currentBook = bookName;
  currentChapter = chapterNum;

  document.getElementById('reading-title').textContent = `${bookName} ${chapterNum}`;

  const container = document.getElementById('verses-container');
  container.innerHTML = `
    <div class="chapter-loading">
      <div class="loading-spinner"></div>
      <div>جارٍ تحميل نص الإصحاح من الإنترنت...</div>
    </div>
  `;
  container.style.fontSize = fontSize + 'px';
  showScreen('reading-screen');

  try {
    const rawVerses = await getChapterVerses(bookName, chapterNum);

    const verses = (rawVerses || [])
      .map((item, index) => {
        if (typeof item === 'string') {
          return { number: index + 1, text: item };
        }
        return {
          number: Number(item.number) || index + 1,
          text: String(item.text || '').trim()
        };
      })
      .filter(v => v.text);

    window.currentVerses = verses;

    if (!verses.length) {
      throw new Error('لم يتم العثور على نص الإصحاح');
    }

    container.innerHTML = '';

    verses.forEach((verse, i) => {
      const p = document.createElement('div');
      p.className = 'verse';
      p.dataset.index = i;

      const num = document.createElement('span');
      num.className = 'verse-num';
      num.textContent = toArabicDigits(verse.number);

      const text = document.createElement('span');
      text.className = 'verse-text';
      text.textContent = verse.text;

      p.appendChild(num);
      p.appendChild(text);

      p.onclick = () =>
        toggleVerseFavorite(
          verse.text,
          `${bookName} ${chapterNum}: ${verse.number}`
        );

      container.appendChild(p);
    });

    prepareAudioData(verses.map(v => v.text));
    resetAudioBar();
    updateFavIcon();

  } catch (error) {
    console.error('خطأ تحميل الإصحاح:', error);

    container.innerHTML = `
      <div class="chapter-error">
        <div class="error-icon">⚠️</div>
        <h3>تعذر تحميل الإصحاح</h3>
        <p>تأكد من اتصال الإنترنت ثم اضغط المحاولة مرة أخرى.</p>
        <button class="retry-chapter-btn"
          onclick="openChapter(${JSON.stringify(bookName)}, ${Number(chapterNum)})">
          🔄 المحاولة مرة أخرى
        </button>
      </div>
    `;
  }
}
function prepareAudioData(verses) {
  allVersesText = verses.map(v => v.trim()).filter(t => t.length > 0);
  const fullText = allVersesText.join(' . ');
  wordsList = fullText.split(/\s+/).filter(w => w.length > 0);
  totalWords = wordsList.length;

  totalSpeechTime = 0;
  elapsedSpeechTime = 0;

  updateAudioBar(0, 1, 'اضغط 🔊 لبدء التسجيل');
}

function resetAudioBar() {
  document.getElementById('audio-fill').style.width = '0%';
  document.getElementById('audio-thumb').style.right = '0%';
  document.getElementById('audio-time-current').textContent = '0:00';
  document.getElementById('audio-time-total').textContent = formatTime(totalSpeechTime);
  document.getElementById('audio-status').textContent = 'اضغط 🔊 لبدء التسجيل';
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateAudioBar(current, total, status) {
  if (total <= 0) total = 1;
  const pct = Math.min(100, (current / total) * 100);
  document.getElementById('audio-fill').style.width = pct + '%';
  document.getElementById('audio-thumb').style.right = pct + '%';
  document.getElementById('audio-time-current').textContent = formatTime(current);
  document.getElementById('audio-time-total').textContent = formatTime(total);
  if (status) document.getElementById('audio-status').textContent = status;
}

const WORDPROJECT_AUDIO_BASES = [
  'https://www.wordproaudio.net/bibles/app/audio/16',
  'https://wordproaudio.net/bibles/app/audio/16'
];

const WORDPROJECT_BOOK_NUMBERS = Object.fromEntries([
  ...(Array.isArray(oldTestament) ? oldTestament : []),
  ...(Array.isArray(newTestament) ? newTestament : [])
].map((book, index) => [book.name, index + 1]));

function getCurrentBookNumber() {
  return currentBook ? (WORDPROJECT_BOOK_NUMBERS[currentBook] || null) : null;
}

function getAudioUrls() {
  const bookNo = getCurrentBookNumber();
  if (!bookNo || !currentChapter) return [];
  return WORDPROJECT_AUDIO_BASES.map(base => `${base}/${bookNo}/${currentChapter}.mp3`);
}

function getAudioUrl() {
  return getAudioUrls()[0] || null;
}

function ensureAudioElement() {
  if (!currentAudio) {
    currentAudio = document.createElement('audio');
    currentAudio.preload = 'metadata';
    currentAudio.playsInline = true;
    currentAudio.style.display = 'none';
    document.body.appendChild(currentAudio);

    currentAudio.addEventListener('loadedmetadata', () => {
      totalSpeechTime = Number.isFinite(currentAudio.duration) ? currentAudio.duration : 0;
      elapsedSpeechTime = 0;
      updateAudioBar(0, totalSpeechTime || 1, '▶️ جاهز للتشغيل');
    });
    currentAudio.addEventListener('timeupdate', () => {
      if (isDragging) return;
      elapsedSpeechTime = currentAudio.currentTime || 0;
      updateAudioBar(elapsedSpeechTime, currentAudio.duration || totalSpeechTime || 1, '🔊 جاري التشغيل...');
    });
    currentAudio.addEventListener('play', () => {
      isSpeaking = true;
      document.getElementById('speak-btn').textContent = '⏹';
      document.getElementById('audio-status').textContent = '🔊 جاري التشغيل...';
    });
    currentAudio.addEventListener('pause', () => {
      if (!currentAudio.ended) {
        isSpeaking = false;
        document.getElementById('speak-btn').textContent = '🔊';
        document.getElementById('audio-status').textContent = '⏸ متوقف';
      }
    });
    currentAudio.addEventListener('ended', () => {
      isSpeaking = false;
      stopSpeechTimer();
      elapsedSpeechTime = currentAudio.duration || totalSpeechTime;
      updateAudioBar(elapsedSpeechTime, currentAudio.duration || totalSpeechTime || 1, '✅ انتهى الإصحاح');
      document.getElementById('speak-btn').textContent = '🔊';
      clearHighlight();
    });
    currentAudio.addEventListener('error', () => {
      isSpeaking = false;
      stopSpeechTimer();
      document.getElementById('speak-btn').textContent = '🔊';
      document.getElementById('audio-status').textContent = 'تعذر تحميل التسجيل الصوتي';
      clearHighlight();
      console.error('Audio failed:', currentAudio.src);
    });
  }
  return currentAudio;
}

async function speakVerses() {
  const audio = ensureAudioElement();
  const urls = getAudioUrls();
  if (!urls.length) return;

  if (isSpeaking) {
    stopSpeaking();
    return;
  }

  document.getElementById('audio-status').textContent = '⏳ جاري تجهيز الصوت...';

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      if (audio.src !== url) {
        audio.src = url;
        audio.load();
      }
      await audio.play();
      isSpeaking = true;
      document.getElementById('speak-btn').textContent = '⏹';
      document.getElementById('audio-status').textContent = '🔊 جاري التشغيل...';
      return;
    } catch (err) {
      console.warn('Audio source failed:', url, err);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }

  if ('speechSynthesis' in window) {
    const text = (window.currentVerses || []).join(' ');
    if (text) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ar-SA';
      utterance.rate = 0.9;
      utterance.onstart = () => {
        isSpeaking = true;
        document.getElementById('speak-btn').textContent = '⏹';
        document.getElementById('audio-status').textContent = '🔊 قراءة صوتية احتياطية...';
      };
      utterance.onend = () => {
        isSpeaking = false;
        document.getElementById('speak-btn').textContent = '🔊';
        document.getElementById('audio-status').textContent = '✅ انتهت القراءة';
      };
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
      return;
    }
  }

  document.getElementById('audio-status').textContent = 'تعذر تحميل التسجيل الصوتي لهذا الإصحاح';
}

function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  isSpeaking = false;
  stopSpeechTimer();
  const btn = document.getElementById('speak-btn');
  if (btn) btn.textContent = '🔊';
  const statusEl = document.getElementById('audio-status');
  if (statusEl) statusEl.textContent = '⏸ متوقف';
  clearHighlight();
}

function startSpeechTimer() {
  stopSpeechTimer();
  speechTimer = setInterval(() => {
    if (!isSpeaking || isDragging) return;
    elapsedSpeechTime++;
    if (elapsedSpeechTime > totalSpeechTime) elapsedSpeechTime = totalSpeechTime;
    updateAudioBar(elapsedSpeechTime, totalSpeechTime, '🔊 جاري القراءة...');
  }, 1000);
}

function stopSpeechTimer() {
  if (speechTimer) {
    clearInterval(speechTimer);
    speechTimer = null;
  }
}

function highlightVerse(index) {
  clearHighlight();
  const verses = document.querySelectorAll('.verse');
  if (verses[index]) {
    verses[index].classList.add('speaking');
    verses[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function clearHighlight() {
  document.querySelectorAll('.verse.speaking').forEach(v => v.classList.remove('speaking'));
}

function initAudioSeek() {
  const track = document.getElementById('audio-track');
  const thumb = document.getElementById('audio-thumb');
  if (!track) return;

  track.addEventListener('mousedown', startDrag);
  thumb.addEventListener('mousedown', startDrag);
  track.addEventListener('touchstart', startDrag, { passive: false });
  thumb.addEventListener('touchstart', startDrag, { passive: false });

  document.addEventListener('mousemove', onDrag);
  document.addEventListener('touchmove', onDrag, { passive: false });

  document.addEventListener('mouseup', endDrag);
  document.addEventListener('touchend', endDrag);
  document.addEventListener('touchcancel', endDrag);
}

function startDrag(e) {
  if (totalSpeechTime === 0) return;
  isDragging = true;
  const thumb = document.getElementById('audio-thumb');
  const fill = document.getElementById('audio-fill');
  thumb.classList.add('dragging');
  thumb.style.transition = 'none';
  fill.style.transition = 'none';
  onDrag(e);
}

function onDrag(e) {
  if (!isDragging) return;
  e.preventDefault();

  const track = document.getElementById('audio-track');
  const rect = track.getBoundingClientRect();

  let clientX;
  if (e.touches && e.touches.length > 0) clientX = e.touches[0].clientX;
  else clientX = e.clientX;

  const clickX = clientX - rect.left;
  let pct = 1 - (clickX / rect.width);
  pct = Math.max(0, Math.min(1, pct));

  const current = Math.floor(pct * totalSpeechTime);
  updateAudioBarDrag(current, totalSpeechTime, pct);
}

function endDrag(e) {
  if (!isDragging) return;
  isDragging = false;

  const thumb = document.getElementById('audio-thumb');
  const fill = document.getElementById('audio-fill');
  thumb.classList.remove('dragging');
  thumb.style.transition = 'right 0.3s linear';
  fill.style.transition = 'width 0.3s linear';

  const track = document.getElementById('audio-track');
  const rect = track.getBoundingClientRect();

  let clientX;
  if (e.changedTouches && e.changedTouches.length > 0) clientX = e.changedTouches[0].clientX;
  else clientX = e.clientX;

  const clickX = clientX - rect.left;
  let pct = 1 - (clickX / rect.width);
  pct = Math.max(0, Math.min(1, pct));

  const wordIndex = Math.floor(pct * totalWords);
  restartFromWord(wordIndex);
}

function updateAudioBarDrag(current, total, pct) {
  document.getElementById('audio-fill').style.width = (pct * 100) + '%';
  document.getElementById('audio-thumb').style.right = (pct * 100) + '%';
  document.getElementById('audio-time-current').textContent = formatTime(current);
  document.getElementById('audio-time-total').textContent = formatTime(total);
  document.getElementById('audio-status').textContent = '👆 اسحب للتنقل';
}

function restartFromWord(wordIndex) {
  let cumulative = 0;
  let targetVerse = 0;
  for (let i = 0; i < allVersesText.length; i++) {
    const words = allVersesText[i].split(/\s+/).length;
    if (cumulative + words > wordIndex) { targetVerse = i; break; }
    cumulative += words;
  }

  if ('speechSynthesis' in window) speechSynthesis.cancel();
  stopSpeechTimer();

  currentVerseIndex = targetVerse;
  isSpeaking = true;
  document.getElementById('speak-btn').textContent = '⏹';
  document.getElementById('audio-status').textContent = '🔊 جاري القراءة...';
  startSpeechTimer();
  speakNextVerse();
}

function applyAppFontSettings() {
  const family = appFontFamily === 'Amiri' ? "'Amiri', serif" : "'Cairo', sans-serif";
  document.documentElement.style.setProperty('--app-font-family', family);
  document.documentElement.style.setProperty('--reading-font-size', (18 * readingFontScale / 100) + 'px');
  const verses = document.getElementById('verses-container');
  if (verses) verses.style.fontSize = (20 * fontScale / 100) + 'px';
  const selectors = [
    '#katameros-content .reading-text', '#synaxarium-content .synax-section-body',
    '#synaxarium-content .synaxarium-story', '#prayer-content .prayer-section-body',
    '#prayer-content .prayer-text', '#prayer-content .prayer-single-text',
    '#prayer-content .local-prayer-pages', '#prayer-content .selected-psalm-view .prayer-section-body',
    '#katameros-part-view .prayer-section-body', '#katameros-part-view .selected-psalm-view',
    '#prayer-part-view .selected-psalm-view .prayer-section-body'
  ];
  document.querySelectorAll(selectors.join(',')).forEach(el => {
    el.style.setProperty('font-size', (18 * readingFontScale / 100) + 'px', 'important');
  });
}

function changeFontSize(delta) {
  fontScale = Math.max(10, Math.min(200, fontScale + delta * 10));
  localStorage.setItem('bible_font_scale', String(fontScale));
  applyAppFontSettings();
  updateSettingsUI();
}

function changeReadingFontSize(delta) {
  readingFontScale = Math.max(10, Math.min(200, readingFontScale + delta * 10));
  localStorage.setItem('reading_font_scale', String(readingFontScale));
  applyAppFontSettings();
  updateSettingsUI();
}

function setFontScale(value) {
  readingFontScale = Math.max(10, Math.min(200, Number(value) || 100));
  fontScale = readingFontScale;
  localStorage.setItem('reading_font_scale', String(readingFontScale));
  localStorage.setItem('bible_font_scale', String(fontScale));
  applyAppFontSettings();
  updateSettingsUI();
}

function setAppFontFamily(value) {
  appFontFamily = value === 'Amiri' ? 'Amiri' : 'Cairo';
  localStorage.setItem('app_font_family', appFontFamily);
  applyAppFontSettings();
  updateSettingsUI();
}

function applyTileScale() {
  tileScale = Math.max(0.75, Math.min(1.15, tileScale));
  document.documentElement.style.setProperty('--app-tile-scale', String(tileScale));
}

function changeTileSize(delta) {
  tileScale = Math.max(0.75, Math.min(1.15, tileScale + delta * 0.01));
  localStorage.setItem('app_tile_scale', String(tileScale));
  applyTileScale();
  updateSettingsUI();
}

function setTileScale(value) {
  const percent = Math.max(75, Math.min(115, Number(value) || 100));
  tileScale = percent / 100;
  localStorage.setItem('app_tile_scale', String(tileScale));
  applyTileScale();
  updateSettingsUI();
}

function toggleDarkMode() {
  isDark = !isDark;
  document.body.classList.toggle('dark', isDark);
  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) themeBtn.textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('bible_dark', isDark);
  updateSettingsUI();
}

function updateSettingsUI() {
  const themeBtn = document.getElementById('settings-theme-btn');
  const fontLabel = document.getElementById('settings-font-size');
  const tileLabel = document.getElementById('settings-tile-size');
  if (themeBtn) themeBtn.textContent = isDark ? '☀️' : '🌙';
  if (fontLabel) fontLabel.textContent = `${fontScale}%`;
  const scaleSlider = document.getElementById('font-scale-slider');
  if (scaleSlider) scaleSlider.value = String(readingFontScale);
  const fontPicker = document.getElementById('font-family-picker');
  if (fontPicker) fontPicker.value = appFontFamily;
  if (tileLabel) tileLabel.textContent = `${Math.round(tileScale * 100)}%`;
  const tileSlider = document.getElementById('tile-scale-slider');
  if (tileSlider) tileSlider.value = String(Math.round(tileScale * 100));
}

function showSettings() {
  updateSettingsUI();
  showScreen('settings-screen');
}

function toggleVerseFavorite(verseText, reference) {
  const existing = favorites.findIndex(f => f.text === verseText);
  if (existing >= 0) favorites.splice(existing, 1);
  else favorites.push({ text: verseText, ref: reference, date: Date.now() });
  saveFavorites();
  updateFavIcon();
}

function toggleFavorite() {
  const firstVerse = document.querySelector('.verse');
  if (!firstVerse) return;
  const clone = firstVerse.cloneNode(true);
  const numSpan = clone.querySelector('.verse-num');
  if (numSpan) numSpan.remove();
  const text = clone.textContent.trim();
  const ref = `${currentBook} ${currentChapter}`;

  const existing = favorites.findIndex(f => f.text === text);
  if (existing >= 0) favorites.splice(existing, 1);
  else favorites.push({ text, ref, date: Date.now() });
  saveFavorites();
  updateFavIcon();
}

function updateFavIcon() {
  const firstVerse = document.querySelector('.verse');
  if (!firstVerse) return;
  const clone = firstVerse.cloneNode(true);
  const numSpan = clone.querySelector('.verse-num');
  if (numSpan) numSpan.remove();
  const text = clone.textContent.trim();
  const isFav = favorites.some(f => f.text === text);
  const btn = document.getElementById('fav-btn');
  if (btn) btn.textContent = isFav ? '❤️' : '🤍';
}

function saveFavorites() {
  localStorage.setItem('bible_favorites', JSON.stringify(favorites));
}

function showFavorites() {
  const list = document.getElementById('favorites-list');
  list.innerHTML = '';

  if (favorites.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="big-icon">️</div>
        <p>لا توجد آيات مفضلة بعد</p>
      </div>`;
  } else {
    favorites.forEach((f, i) => {
      const div = document.createElement('div');
      div.className = 'fav-item';
      div.innerHTML = `
        <div class="fav-text">
          ${f.text}
          <div style="font-size:13px;color:#8d6e63;margin-top:6px;font-style:italic">— ${f.ref}</div>
        </div>
        <button class="delete-btn" onclick="removeFavorite(${i})">️</button>
      `;
      list.appendChild(div);
    });
  }

  showScreen('favorites-screen');
}

function removeFavorite(index) {
  favorites.splice(index, 1);
  saveFavorites();
  showFavorites();
}

function getDailyVerse() {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const dayOfYear = Math.floor((now - start) / 86400000);
  const dateKey = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const saved = JSON.parse(localStorage.getItem('bible_daily_verse') || 'null');

  if (saved && saved.dateKey === dateKey && saved.year === year && dailyVerses[saved.index]) {
    return dailyVerses[saved.index];
  }

  const cycleDay = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(2026, 0, 1)) / 86400000);
  const index = ((cycleDay % 700) + 700) % 700;
  const verse = dailyVerses[index % dailyVerses.length];
  localStorage.setItem('bible_daily_verse', JSON.stringify({ dateKey, year, index }));
  return verse;
}

function renderHomeDailyVerse() {
  const verse = getDailyVerse();
  const text = document.getElementById('home-daily-text');
  const ref = document.getElementById('home-daily-ref');
  if (text) text.textContent = verse.text;
  if (ref) ref.textContent = verse.ref;
}

function saveHomeDailyVerse() {
  const verse = getDailyVerse();
  const item = { text: verse.text, ref: verse.ref };
  const exists = favorites.some(f => f.text === item.text && f.ref === item.ref);
  if (!exists) {
    favorites.unshift(item);
    saveFavorites();
  }
  const btn = document.querySelector('.home-daily-actions .home-action-btn');
  if (btn) {
    btn.textContent = exists ? '☆ محفوظة' : '★ تم الحفظ';
    setTimeout(() => { if (btn) btn.textContent = '☆ حفظ'; }, 1200);
  }
}

function shareHomeDailyVerse() {
  const verse = getDailyVerse();
  const fullText = `${verse.text}\n— ${verse.ref} —\n\nمن تطبيق طريق النور`;
  if (navigator.share) navigator.share({ title: 'آية اليوم', text: fullText });
  else if (navigator.clipboard) navigator.clipboard.writeText(fullText).then(() => alert('تم نسخ الآية'));
}

function showDailyVerse() {
  const verse = getDailyVerse();
  document.getElementById('daily-text').textContent = verse.text;
  document.getElementById('daily-ref').textContent = `— ${verse.ref} —`;
  showScreen('daily-screen');
}

function shareVerse() {
  const text = document.getElementById('daily-text').textContent;
  const ref = document.getElementById('daily-ref').textContent;
  const fullText = `${text}\n${ref}\n\n من تطبيق الكتاب المقدس`;

  if (navigator.share) navigator.share({ title: 'آية اليوم', text: fullText });
  else navigator.clipboard.writeText(fullText).then(() => alert(' تم نسخ الآية'));
}

const searchBookCache = new Map();
let searchRequestId = 0;

function normalizeArabic(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function addSearchResult(results, verse, ref, onClick) {
  const div = document.createElement('div');
  div.className = 'search-item';
  div.textContent = verse;
  const span = document.createElement('span');
  span.className = 'search-ref';
  span.textContent = ref;
  div.appendChild(span);
  if (onClick) div.onclick = onClick;
  results.appendChild(div);
}

async function fetchBookForSearch(book) {
  if (searchBookCache.has(book.name)) return searchBookCache.get(book.name);
  const code = bibleBookCodes?.[book.name];
  if (!code) return null;
  const response = await fetch(`https://ebible.org/arb-vd/${code}.htm`, { cache: 'force-cache', mode: 'cors' });
  if (!response.ok) throw new Error(`تعذر تحميل ${book.name}`);
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const text = (doc.body?.innerText || doc.body?.textContent || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const value = { text, normalized: normalizeArabic(text) };
  searchBookCache.set(book.name, value);
  return value;
}

async function remoteSearch(query, results, requestId) {
  const books = [...(oldTestament || []), ...(newTestament || [])];
  const normalizedQuery = normalizeArabic(query);
  let count = 0;

  for (let i = 0; i < books.length && count < 100; i += 6) {
    if (requestId !== searchRequestId) return count;
    const batch = books.slice(i, i + 6);
    const loaded = await Promise.allSettled(batch.map(fetchBookForSearch));
    for (let j = 0; j < loaded.length && count < 100; j++) {
      const result = loaded[j];
      if (result.status !== 'fulfilled' || !result.value) continue;
      const data = result.value;
      const pos = data.normalized.indexOf(normalizedQuery);
      if (pos < 0) continue;

      const start = Math.max(0, pos - 90);
      const end = Math.min(data.text.length, pos + query.length + 130);
      const snippet = (start > 0 ? '...' : '') + data.text.slice(start, end).trim() + (end < data.text.length ? '...' : '');
      const book = batch[j];
      count++;
      addSearchResult(results, snippet, book.name, () => openChapter(book.name, 1));
    }
    if (count === 0 || count < 100) {
      results.querySelector('.search-loading')?.remove();
    }
  }
  return count;
}

async function performSearch() {
  const query = document.getElementById('search-input').value.trim();
  const results = document.getElementById('search-results');
  const requestId = ++searchRequestId;

  if (query.length < 2) {
    results.innerHTML = '<p style="text-align:center;color:#999;padding:20px">اكتب حرفين على الأقل...</p>';
    return;
  }

  results.innerHTML = '<p class="search-loading" style="text-align:center;color:#999;padding:20px">جارٍ البحث...</p>';
  const normalizedQuery = normalizeArabic(query);
  let count = 0;
  const seen = new Set();

  if (Array.isArray(bibleData)) {
    bibleData.forEach(book => {
      book.chapters?.forEach((chapter, chIdx) => {
        chapter?.forEach((verse, vIdx) => {
          if (count >= 100) return;
          if (normalizeArabic(verse).includes(normalizedQuery)) {
            const key = `${book.name}|${chIdx + 1}|${vIdx + 1}|${verse}`;
            if (seen.has(key)) return;
            seen.add(key);
            count++;
            addSearchResult(results, verse, `${book.name} ${chIdx + 1}: ${vIdx + 1}`, () => openChapter(book.name, chIdx + 1));
          }
        });
      });
    });
  }

  if (typeof sampleVerses !== 'undefined' && count < 100) {
    Object.entries(sampleVerses).forEach(([key, verses]) => {
      if (count >= 100 || !Array.isArray(verses)) return;
      const sep = key.lastIndexOf('-');
      const bookName = sep > 0 ? key.slice(0, sep) : key;
      const chapterNum = sep > 0 ? Number(key.slice(sep + 1)) : 1;
      verses.forEach((verse, vIdx) => {
        if (count >= 100 || !normalizeArabic(verse).includes(normalizedQuery)) return;
        const resultKey = `${bookName}|${chapterNum}|${vIdx + 1}|${verse}`;
        if (seen.has(resultKey)) return;
        seen.add(resultKey);
        count++;
        addSearchResult(results, verse, `${bookName} ${chapterNum}: ${vIdx + 1}`, () => openChapter(bookName, chapterNum));
      });
    });
  }

  results.querySelector('.search-loading')?.remove();

  if (count === 0 && requestId === searchRequestId) {
    results.innerHTML = '<p class="search-loading" style="text-align:center;color:#999;padding:20px">جارٍ البحث في جميع الأسفار...</p>';
    try {
      count = await remoteSearch(query, results, requestId);
    } catch (error) {
      console.error('Search error:', error);
    }
    if (requestId !== searchRequestId) return;
    results.querySelector('.search-loading')?.remove();
  }

  if (count === 0 && requestId === searchRequestId) {
    results.innerHTML = '<p style="text-align:center;color:#999;padding:20px">لا توجد نتائج</p>';
  }
}

function showReadingPlan() {
  const list = document.getElementById('plan-list');
  list.innerHTML = '';
  const year = new Date().getFullYear();
  const storageKey = `bible_plan_done_${year}`;
  const completed = JSON.parse(localStorage.getItem(storageKey) || '[]');

  readingPlan.forEach(item => {
    const div = document.createElement('div');
    div.className = 'plan-item' + (completed.includes(item.day) ? ' done' : '');
    div.innerHTML = `
      <span class="plan-day">يوم ${item.day}</span>
      <span class="plan-reading">${item.reading}</span>
      <span class="plan-check">${completed.includes(item.day) ? '' : '○'}</span>
    `;
    div.onclick = () => {
      const idx = completed.indexOf(item.day);
      if (idx >= 0) completed.splice(idx, 1);
      else completed.push(item.day);
      localStorage.setItem(storageKey, JSON.stringify(completed));
      showReadingPlan();
    };
    list.appendChild(div);
  });

  showScreen('plan-screen');
}

let swipeStartX = 0, swipeStartY = 0, swipeTracking = false;
function navigateSwipe(direction) {
  const active = document.querySelector('.screen.active');
  if (!active) return;
  if (active.id === 'reading-screen') {
    const max = Number(generatedBibleNavigation.chapters[currentBook]?.length || 0);
    if (!max) return;
    const next = Math.min(max, Math.max(1, currentChapter + (direction > 0 ? 1 : -1)));
    if (next !== currentChapter) openChapter(currentBook, next);
    return;
  }
  if (active.id === 'katameros-screen' && document.getElementById('dox-online-reading') && !document.getElementById('dox-online-reading').hidden) {
    navigateOnlineDoxology(direction > 0 ? 1 : -1);
    return;
  }
  if (active.id === 'katameros-screen') {
    const doxologies = window.__currentDoxologies || [];
    const selectedDox = Number(window.__selectedDoxology);
    if (doxologies.length && document.getElementById('dox-item-view')) {
      const current = Number.isFinite(selectedDox) ? selectedDox : 0;
      const next = current + (direction > 0 ? 1 : -1);
      if (next >= 0 && next < doxologies.length) {
        chooseTextItem('dox', next);
        return;
      }
    }
  }
  if (active.id === 'prayer-screen') {
    const parts = window.__currentPrayerParts || [];
    const current = Number(window.__selectedPrayerPart);
    const currentPart = Number.isFinite(current) ? parts[current] : null;
    const psalms = window.__currentPsalms || [];
    const selectedPsalm = Number(window.__selectedPsalm);
    if (currentPart && currentPart.title === 'المزامير' && psalms.length) {
      const selected = Number.isFinite(selectedPsalm) && selectedPsalm >= 0 ? selectedPsalm : 0;
      const targetPsalm = selected + (direction > 0 ? 1 : -1);

      if (targetPsalm >= 0 && targetPsalm < psalms.length) {
        showPsalm(targetPsalm);
        const label = document.getElementById('psalm-selected-label');
        if (label && psalms[targetPsalm]) label.textContent = getPsalmDisplayName(psalms[targetPsalm]);
        document.querySelectorAll('#psalm-picker-overlay .text-picker-option').forEach((el,i)=>{el.classList.toggle('active',i===targetPsalm);el.querySelector('.text-picker-check').textContent=i===targetPsalm?'✓':'';});
        return;
      }

      const nextPartIndex = current + (direction > 0 ? 1 : -1);
      if (nextPartIndex >= 0 && nextPartIndex < parts.length) {
        showPrayerPart(nextPartIndex, false);
      }
      return;
    }
    const next = Math.min(parts.length-1, Math.max(0, (Number.isFinite(current) ? current : 0) + (direction > 0 ? 1 : -1)));
    if (parts[next]) showPrayerPart(next, false);
    return;
  }
  if (active.id === 'katameros-screen') {
    const collection = window.__katamerosCollection || [];
    if (collection.length) {
      const currentSub = Number(window.__selectedKatamerosSub);
      const nextSub = Math.min(collection.length-1, Math.max(0, (Number.isFinite(currentSub) ? currentSub : 0) + (direction > 0 ? 1 : -1)));
      if (collection[nextSub]) { showKatamerosCollectionItem(nextSub); return; }
    }
    const parts = window.__katamerosParts || [];
    const current = Number(window.__selectedKatamerosPart);
    const next = Math.min(parts.length-1, Math.max(0, (Number.isFinite(current) ? current : 0) + (direction > 0 ? 1 : -1)));
    if (parts[next]) showKatamerosPart(next, false);
    return;
  }
  if (active.id === 'synaxarium-screen') {
    const parts = window.__synaxParts || [];
    if (parts.length < 2) return;
    const current = Number(window.__selectedSynaxPart);
    const next = Math.min(parts.length-1, Math.max(0, (Number.isFinite(current) ? current : 0) + (direction > 0 ? 1 : -1)));
    if (parts[next]) showSynaxariumPart(next, false);
  }
}
function initSwipeNavigation() {
  document.addEventListener('touchstart', e => {
    if (!e.touches || e.touches.length !== 1) return;
    const target = e.target;
    const active = document.querySelector('.screen.active');
    const inPsalmArea = active && active.id === 'prayer-screen' && target.closest('.selected-psalm-view');
    const inDoxArea = active && active.id === 'katameros-screen' && target.closest('#dox-item-view');
    const inOnlineDoxArea = active && active.id === 'katameros-screen' && target.closest('#dox-online-reading .dox-online-text');
    if (!inPsalmArea && !inDoxArea && !inOnlineDoxArea && target.closest('input,textarea,select,button,a,[contenteditable="true"],#audio-track')) return;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeTracking = true;
  }, {passive:true});
  document.addEventListener('touchend', e => {
    if (!swipeTracking || !e.changedTouches || !e.changedTouches.length) return;
    swipeTracking = false;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    navigateSwipe(dx > 0 ? 1 : -1);
  }, {passive:true});
}

window.addEventListener('DOMContentLoaded', async function() {
  try {
    if (isDark) {
      document.body.classList.add('dark');
      const themeBtn = document.getElementById('theme-btn');
      if (themeBtn) themeBtn.textContent = '️';
    }

    buildBibleNavigation();
    renderHomeDailyVerse();

    await loadBibleData();
    initAudioSeek();
    applyReadingFontSize();
applyTileScale();
initSwipeNavigation();
  } catch (error) {
    console.error('خطأ أثناء تهيئة الموقع:', error);
  }
});

function renderKatamerosHymnEditor(category, title) {
  const view = document.getElementById('katameros-part-view');
  const label = document.getElementById('katameros-selected-label');
  if (!view) return;
  activeHymnCategory = category;
  if (label) label.textContent = title;
  window.__katamerosCollection = null;
  view.innerHTML = `
    <section class="reading-card">
      <div class="reading-label">${escapeHtml(title)}</div>
      <p class="hymns-intro">أضف النصوص أو عدّلها هنا. تُحفظ التغييرات على هذا الجهاز.</p>
      <div id="katameros-hymn-list"></div>
      <button type="button" class="add-hymn-btn" onclick="addKatamerosHymnEntry('${category}')">＋ إضافة نص جديد</button>
    </section>`;
  renderKatamerosHymnList(category);
}
function renderKatamerosHymnList(category) {
  const list = document.getElementById('katameros-hymn-list');
  if (!list) return;
  const entries = hymnLibrary[category] || [];
  if (!entries.length) {
    list.innerHTML = '<div class="hymns-empty">لا توجد نصوص مضافة بعد. اضغط «إضافة نص جديد» للبدء.</div>';
    return;
  }
  list.innerHTML = entries.map((entry, index) => `
    <article class="hymn-entry">
      <div class="hymn-entry-heading"><span>النص ${index + 1}</span><button type="button" class="delete-hymn-btn" onclick="deleteKatamerosHymnEntry('${category}',${index})">حذف</button></div>
      <label>اسم النص<input type="text" value="${escapeHtml(entry.title || '')}" placeholder="اسم النص" oninput="updateKatamerosHymnField('${category}',${index},'title',this.value)"></label>
      <label>المقدمة<textarea rows="3" placeholder="المقدمة (اختياري)" oninput="updateKatamerosHymnField('${category}',${index},'intro',this.value)">${escapeHtml(entry.intro || '')}</textarea></label>
      <label>النص الكامل<textarea rows="7" placeholder="اكتب النص هنا" oninput="updateKatamerosHymnField('${category}',${index},'text',this.value)">${escapeHtml(entry.text || '')}</textarea></label>
      <label>الخاتمة<textarea rows="3" placeholder="الخاتمة (اختياري)" oninput="updateKatamerosHymnField('${category}',${index},'ending',this.value)">${escapeHtml(entry.ending || '')}</textarea></label>
    </article>`).join('');
}
function addKatamerosHymnEntry(category) {
  if (!hymnLibrary[category]) hymnLibrary[category] = [];
  hymnLibrary[category].push({title:'', intro:'', text:'', ending:''});
  saveHymnLibrary();
  renderKatamerosHymnList(category);
}
function updateKatamerosHymnField(category, index, field, value) {
  if (!hymnLibrary[category] || !hymnLibrary[category][index]) return;
  hymnLibrary[category][index][field] = value;
  saveHymnLibrary();
}
function deleteKatamerosHymnEntry(category, index) {
  if (!hymnLibrary[category]) return;
  hymnLibrary[category].splice(index, 1);
  saveHymnLibrary();
  renderKatamerosHymnList(category);
}

Object.assign(window, {
  showScreen, goHome, openTestament, backToBooks, openBook, backToChapters,
  openChapter, speakVerses, stopSpeaking, changeFontSize, changeReadingFontSize, changeTileSize, setTileScale, toggleDarkMode,
  toggleFavorite, showFavorites, removeFavorite, showDailyVerse, shareVerse,
  showSearch, performSearch, showReadingPlan, showSettings, updateSettingsUI,
  openBibleMenu, openAgpeya, openPrayer, togglePrayerPicker, closePrayerPicker, showPrayerPart,
  toggleDailyPicker, closeDailyPicker, showKatamerosPart, showSynaxariumPart, initSwipeNavigation
});

const HYMN_STORAGE_KEY = 'tareeq_alnoor_hymns_v1';
const HYMN_CATEGORIES = {
  naqoos_watos: 'أرباع الناقوس واطس',
  naqoos_adam: 'أرباع الناقوس آدام',
  doxologies: 'الذيكسولوچيات'
};
let activeHymnCategory = null;
let hymnLibrary = loadHymnLibrary();
function loadHymnLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem(HYMN_STORAGE_KEY) || '{}');
    for (const key of Object.keys(HYMN_CATEGORIES)) if (!Array.isArray(saved[key])) saved[key] = [];
    return saved;
  } catch (e) {
    return {naqoos_watos: [], naqoos_adam: [], doxologies: []};
  }
}
function saveHymnLibrary() {
  localStorage.setItem(HYMN_STORAGE_KEY, JSON.stringify(hymnLibrary));
}
function openHymnsLibrary() {
  showScreen('hymns-screen');
  renderHymnsList();
}
function selectHymnCategory(category) {
  if (!Object.prototype.hasOwnProperty.call(HYMN_CATEGORIES, category)) return;
  activeHymnCategory = category;
  document.getElementById('hymns-active-title').textContent = HYMN_CATEGORIES[category];
  document.getElementById('add-hymn-btn').hidden = false;
  renderHymnsList();
}
function addHymnEntry() {
  if (!activeHymnCategory) return;
  hymnLibrary[activeHymnCategory].push({title: '', intro: '', text: '', ending: ''});
  saveHymnLibrary();
  renderHymnsList();
  const list = document.getElementById('hymns-list');
  if (list) list.lastElementChild?.scrollIntoView({behavior:'smooth', block:'start'});
}
function updateHymnField(index, field, value) {
  if (!activeHymnCategory || !hymnLibrary[activeHymnCategory][index]) return;
  hymnLibrary[activeHymnCategory][index][field] = value;
  saveHymnLibrary();
}
function deleteHymnEntry(index) {
  if (!activeHymnCategory) return;
  hymnLibrary[activeHymnCategory].splice(index, 1);
  saveHymnLibrary();
  renderHymnsList();
}
function renderHymnsList() {
  const list = document.getElementById('hymns-list');
  if (!list) return;
  if (!activeHymnCategory) {
    list.innerHTML = '<div class="hymns-empty">اختر القسم الذي تريد إضافة نصوصه أو تعديلها.</div>';
    return;
  }
  const entries = hymnLibrary[activeHymnCategory] || [];
  if (!entries.length) {
    list.innerHTML = '<div class="hymns-empty">لا توجد نصوص في هذا القسم بعد. اضغط «إضافة نص جديد» للبدء.</div>';
    return;
  }
  list.innerHTML = entries.map((entry, index) => `
    <article class="hymn-entry">
      <div class="hymn-entry-heading"><span>النص ${index + 1}</span><button type="button" class="delete-hymn-btn" onclick="deleteHymnEntry(${index})">حذف</button></div>
      <label>اسم اللحن أو الذكسولوجية
        <input type="text" value="${escapeHtml(entry.title)}" placeholder="اكتب الاسم هنا" oninput="updateHymnField(${index}, 'title', this.value)">
      </label>
      <label>المقدمة
        <textarea rows="3" placeholder="أضف نص المقدمة هنا" oninput="updateHymnField(${index}, 'intro', this.value)">${escapeHtml(entry.intro)}</textarea>
      </label>
      <label>النص الكامل
        <textarea rows="7" placeholder="أضف نص اللحن أو الذكسولوجية هنا" oninput="updateHymnField(${index}, 'text', this.value)">${escapeHtml(entry.text)}</textarea>
      </label>
      <label>الخاتمة
        <textarea rows="3" placeholder="أضف نص الخاتمة هنا" oninput="updateHymnField(${index}, 'ending', this.value)">${escapeHtml(entry.ending)}</textarea>
      </label>
    </article>`).join('');
}


function getKatExtras() {
  try { return JSON.parse(localStorage.getItem('tariqNoorKatExtras') || '[]'); }
  catch (_) { return []; }
}
function saveKatExtra() {
  const type = document.getElementById('kat-extra-type').value;
  const title = document.getElementById('kat-extra-title').value.trim();
  const date = document.getElementById('kat-extra-date').value;
  const content = document.getElementById('kat-extra-text').value.trim();
  if (!title || !content) { alert('من فضلك اكتب العنوان والنص أولاً.'); return; }
  const items = getKatExtras();
  items.unshift({id: Date.now().toString(), type, title, date, content});
  localStorage.setItem('tariqNoorKatExtras', JSON.stringify(items));
  document.getElementById('kat-extra-title').value = '';
  document.getElementById('kat-extra-date').value = '';
  document.getElementById('kat-extra-text').value = '';
  renderKatExtras('all');
}
function renderKatExtras(filter = 'all') {
  const root = document.getElementById('kat-extra-list');
  if (!root) return;
  const labels = {doxology:'ذكصولوجية', bell:'ربع ناقوس', feast:'عيد أو مناسبة'};
  const items = getKatExtras().filter(x => filter === 'all' || x.type === filter);
  root.innerHTML = items.length ? items.map(x => `
    <article class="kat-extra-item">
      <div class="kat-extra-item-head"><strong>${escapeHtml(x.title)}</strong><span>${labels[x.type] || ''}${x.date ? ' • ' + escapeHtml(x.date) : ''}</span></div>
      <p>${escapeHtml(x.content).replace(/\n/g, '<br>')}</p>
      <button type="button" onclick="deleteKatExtra('${escapeHtml(x.id)}')">حذف</button>
    </article>`).join('') : '<div class="loading-card">لا توجد إضافات بعد. ابدأ بإضافة أول نص.</div>';
}
function deleteKatExtra(id) {
  if (!confirm('هل تريد حذف هذه الإضافة؟')) return;
  localStorage.setItem('tariqNoorKatExtras', JSON.stringify(getKatExtras().filter(x => x.id !== id)));
  renderKatExtras('all');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyAppFontSettings); else applyAppFontSettings();
