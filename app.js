let bibleData = null;
let currentTestament = 'old';
let currentBook = null;
let currentChapter = 1;
let favorites = JSON.parse(localStorage.getItem('bible_favorites') || '[]');
let fontSize = parseInt(localStorage.getItem('bible_fontSize') || '20');
let readingFontSize = parseInt(localStorage.getItem('reading_fontSize') || '20');
let iconScale = parseFloat(localStorage.getItem('app_icon_scale') || '1');
if (!Number.isFinite(readingFontSize)) readingFontSize = 20;
if (!Number.isFinite(iconScale)) iconScale = 1;
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

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  window.scrollTo(0, 0);
}

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
const KATAMEROS_API = 'https://api.katameros.app';

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

function renderPsalmPart(part) {
  const view = document.getElementById('prayer-part-view');
  if (!view) return;
  const psalms = splitPsalms(part.text);
  window.__currentPsalms = psalms;
  window.__selectedPsalm = -1;
  view.classList.remove('prayer-part-empty');
  if (!psalms.length) {
    view.innerHTML = `<div class="prayer-section-title">المزامير</div><div class="prayer-section-body">لا توجد مزامير منظمة في هذا الجزء.</div>`;
    return;
  }
  view.innerHTML = `
    <div class="prayer-section-title">المزامير</div>
    <div class="psalm-picker-box">
      <label for="psalm-select">اختر المزمور</label>
      <select id="psalm-select" class="psalm-select">
        ${psalms.map((p,i)=>`<option value="${i}">${escapeHtml(p.title)}</option>`).join('')}
      </select>
    </div>
    <div id="selected-psalm-view" class="selected-psalm-view"></div>`;
  const select = document.getElementById('psalm-select');
  if (select) {
    select.value = '0';
    select.addEventListener('change', () => {
      const index = Number(select.value);
      if (Number.isInteger(index) && index >= 0) showPsalm(index);
    });
  }
  showPsalm(0);
}

function showPsalm(index) {
  const psalms = window.__currentPsalms || [];
  const item = psalms[index];
  if (!item) return;
  window.__selectedPsalm = index;
  const view = document.getElementById('selected-psalm-view');
  if (!view) return;
  view.innerHTML = `<div class="prayer-section-title">${escapeHtml(item.title)}</div><div class="prayer-section-body">${escapeHtml(item.text).replace(/\n/g,'<br>')}</div>`;
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

function showPrayerPart(index) {
  const items = window.__currentPrayerParts || [];
  const item = items[index];
  if (!item) return;
  const label = document.getElementById('selected-prayer-label');
  if (label) label.textContent = item.title;
  window.__selectedPrayerPart = index;
  renderLocalPrayerPart(item);
  closePrayerPicker();
  const view = document.getElementById('prayer-part-view');
  if (view) view.scrollIntoView({behavior:'smooth',block:'start'});
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
  document.getElementById('katameros-date').textContent = copticLabel || 'قراءات اليوم';
  document.getElementById('katameros-content').innerHTML = '<div class="loading-card">جاري تحميل القطمارس الحقيقي بالعربية…</div>';

  const day = date.slice(8,10), month = date.slice(5,7), year = date.slice(0,4);
  const sources = [
    `https://r.jina.ai/https://www.ayakolyoum.com/public/katamaros?date=${date}`,
    `https://www.ayakolyoum.com/public/katamaros?date=${date}`,
    `https://r.jina.ai/https://www.copticchurch.net/readings/ar?g_day=${day}&g_month=${month}&g_year=${year}`,
    `https://www.copticchurch.net/readings/ar?g_day=${day}&g_month=${month}&g_year=${year}`,
    `https://r.jina.ai/https://st-takla.org/zJ/index.php/component/katamaros/?dbl=ar&iday=${day}&imonth=${month}&iyear=${year}&view=reading-arabic`,
    `https://st-takla.org/zJ/index.php/component/katamaros/?dbl=ar&iday=${day}&imonth=${month}&iyear=${year}&view=reading-arabic`
  ];

  for (const url of sources) {
    try {
      const html = await fetchText([url]);
      if (renderKatamerosArabicHtml(html)) return;
    } catch (e) { console.warn('Katameros source failed', url, e); }
  }

  try {
    const data = await fetchJson([
      `${COPTIC_API}/readings/${date}?detailed=true&lang=ar`,
      `${KATAMEROS_API}/readings/gregorian/${date.split('-').reverse().join('-')}?languageId=3&bibleId=3`
    ]);
    renderKatameros(data);
  } catch (e) {
    showOnlineError('katameros-content', 'تعذر تحميل قراءات القطمارس بالعربية من المصادر المتاحة.');
  }
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
    'مزمور العشية':'مزمور العشية','إنجيل العشية':'إنجيل العشية','الإنجيل العشية':'إنجيل العشية',
    'مزمور باكر':'مزمور باكر','إنجيل باكر':'إنجيل باكر','الإنجيل باكر':'إنجيل باكر',
    'مزمور القداس':'مزمور القداس','إنجيل القداس':'إنجيل القداس',
    'البولس':'البولس','الكاثوليكون':'الكاثوليكون','الإبركسيس':'الإبركسيس','الابركسيس':'الإبركسيس',
    'مقدمة العشية':'مقدمة العشية','مقدمة باكر':'مقدمة باكر','مقدمة القداس':'مقدمة القداس'
  };
  let section='';
  for (let i=0;i<clean.length;i++) {
    const line=clean[i];
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
    'مزمور العشية':'مزمور العشية','إنجيل العشية':'إنجيل العشية','الإنجيل العشية':'إنجيل العشية',
    'مزمور باكر':'مزمور باكر','إنجيل باكر':'إنجيل باكر','الإنجيل باكر':'إنجيل باكر',
    'البولس':'البولس','الكاثوليكون':'الكاثوليكون','الإبركسيس':'الإبركسيس','الابركسيس':'الإبركسيس',
    'مزمور القداس':'مزمور القداس','إنجيل القداس':'إنجيل القداس'
  };
  const titles=Object.keys(aliases);
  const out=[]; let current=null;
  for(const line of clean){
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
  const items=parts.map((p,i)=>({...p})).sort((a,b)=>{
    const ai=order.indexOf(a.title), bi=order.indexOf(b.title);
    return (ai<0?999:ai)-(bi<0?999:bi);
  }).map((p,i)=>({...p,id:`katameros-part-${i}`}));
  if (!items.length) return false;
  root.innerHTML=`
    <div class="daily-selector-wrap">
      <button type="button" class="daily-selector-btn" onclick="toggleDailyPicker('katameros')" aria-expanded="false">
        <span id="katameros-selected-label">${escapeHtml(items[0].title)}</span><span>⌄</span>
      </button>
    </div>
    <div id="katameros-part-view" class="daily-selected-view"></div>
    <div id="katameros-picker" class="daily-picker-overlay" onclick="closeDailyPicker('katameros',event)" aria-hidden="true">
      <div class="daily-picker" onclick="event.stopPropagation()">
        <div class="daily-picker-head"><strong>اختر جزء القطمارس</strong><button type="button" onclick="toggleDailyPicker('katameros')">×</button></div>
        <div class="daily-choice-list">${items.map((p,i)=>`<button type="button" class="daily-choice" onclick="showKatamerosPart(${i})"><span>${escapeHtml(p.title)}</span></button>`).join('')}</div>
      </div>
    </div>`;
  window.__katamerosParts=items;
  window.__selectedKatamerosPart=0;
  showKatamerosPart(0,false);
  return true;
}

function showKatamerosPart(index,smooth=true) {
  const parts=window.__katamerosParts||[];
  if(!parts[index]) return;
  window.__selectedKatamerosPart=index;
  const label=document.getElementById('katameros-selected-label');
  const view=document.getElementById('katameros-part-view');
  if(label) label.textContent=parts[index].title;
  if(view) view.innerHTML=`<section class="reading-card"><div class="reading-label">${escapeHtml(parts[index].title)}</div><div class="reading-text">${escapeHtml(parts[index].text).replace(/\n/g,'<br><br>')}</div></section>`;
  closeDailyPicker('katameros');
  if(smooth && view) view.scrollIntoView({behavior:'smooth',block:'start'});
}

function toggleDailyPicker(type) {
  const id=type==='katameros'?'katameros-picker':'synaxarium-picker';
  const overlay=document.getElementById(id);
  if(!overlay) return;
  const open=!overlay.classList.contains('show');
  overlay.classList.toggle('show',open);
  overlay.setAttribute('aria-hidden',String(!open));
  document.body.classList.toggle('daily-picker-open',open);
}
function closeDailyPicker(type,event) {
  if(event&&event.target!==event.currentTarget) return;
  const id=type==='katameros'?'katameros-picker':'synaxarium-picker';
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
  const lines = raw.split(/\n+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const aliases = {
    'مزمور العشية':'مزمور العشية', 'إنجيل العشية':'إنجيل العشية', 'الإنجيل العشية':'إنجيل العشية',
    'مزمور باكر':'مزمور باكر', 'إنجيل باكر':'إنجيل باكر', 'الإنجيل باكر':'إنجيل باكر',
    'مزمور القداس':'مزمور القداس', 'إنجيل القداس':'إنجيل القداس', 'الإنجيل القداس':'إنجيل القداس',
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
    if (name === 'مزمور' || name === 'المزمور') return service === 'vespers' ? 'مزمور العشية' : service === 'matins' ? 'مزمور باكر' : 'مزمور القداس';
    if (name === 'إنجيل' || name === 'الإنجيل') return service === 'vespers' ? 'إنجيل العشية' : service === 'matins' ? 'إنجيل باكر' : 'إنجيل القداس';
    return aliases[name] || name;
  };
  const isHeading = line => {
    if (aliases[line] || ['العشية','باكر','القداس','القداس الإلهي','قراءات القداس','مزمور','المزمور','إنجيل','الإنجيل'].includes(line)) return true;
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

  for (const line of lines) {
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
    const inline = line.match(/^(مزمور العشية|إنجيل العشية|مزمور باكر|إنجيل باكر|البولس|الكاثوليكون|الإبركسيس|الابركسيس|مزمور القداس|إنجيل القداس)\s*[:：-]?\s*(.*)$/);
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
    const key = p.title + '|' + text;
    if (!text || text.length < 2 || seen.has(key)) return false;
    seen.add(key); return true;
  });

  if (!clean.length) {
    const fallback = katamerosStructuredParts(lines);
    if (fallback.length) return renderKatamerosParts(fallback);
    return false;
  }
  return renderKatamerosParts(clean);
}

const readingNamesAr = {
  psalm:'المزمور', gospel:'الإنجيل', pauline:'البولس', catholicon:'الكاثوليكون', praxis:'الإبركسيس', acts:'الإبركسيس', liturgy:'القداس', matins:'باكر', vespers:'العشية', readings:'القراءات', epistle:'الرسالة'
};

function renderKatameros(data) {
  const root=document.getElementById('katameros-content');
  const parts=[]; const used=new Set();
  function add(title,value){
    const text=stripHtml(value).trim();
    if(!text||text.length<2||!looksArabic(text)) return;
    const key=title+'|'+text;
    if(used.has(key)) return;
    used.add(key); parts.push({title:title||'قراءة',text});
  }
  function walk(v,key='',section=''){
    if(v==null) return;
    const k=String(key||'').toLowerCase();
    let title=readingNamesAr[k]||(looksArabic(key)?key:'');
    if(/pauline|بولس/.test(k)) title='البولس';
    else if(/cath|كاثولي/.test(k)) title='الكاثوليكون';
    else if(/praxis|acts|ابركسيس|إبركسيس/.test(k)) title='الإبركسيس';
    else if(/psalm/.test(k)) title=section==='liturgy'?'مزمور القداس':section==='vespers'?'مزمور العشية':section==='matins'?'مزمور باكر':'المزمور';
    else if(/gospel/.test(k)) title=section==='liturgy'?'إنجيل القداس':section==='vespers'?'إنجيل العشية':section==='matins'?'إنجيل باكر':'الإنجيل';
    if(typeof v==='string'||typeof v==='number'){ add(title,v); return; }
    if(Array.isArray(v)){v.forEach(x=>walk(x,key,section));return;}
    if(typeof v==='object') Object.entries(v).forEach(([k2,val])=>{
      const sec=/vespers|عشية/.test(String(k2).toLowerCase())?'vespers':/matins|باكر/.test(String(k2).toLowerCase())?'matins':/liturgy|قداس/.test(String(k2).toLowerCase())?'liturgy':section;
      walk(val,k2,sec);
    });
  }
  walk(data);
  if(!parts.length){root.innerHTML='<div class="online-error"><h3>لم تظهر قراءات اليوم</h3><p>تمت تجربة المصادر العربية المتاحة للقطمارس.</p></div>';return;}
  renderKatamerosParts(parts);
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

function changeFontSize(delta) {
  fontSize = Math.max(14, Math.min(32, fontSize + delta * 2));
  const verses = document.getElementById('verses-container');
  if (verses) verses.style.fontSize = fontSize + 'px';
  localStorage.setItem('bible_fontSize', fontSize);
}

function applyReadingFontSize() {
  const size = Math.max(14, Math.min(32, Number(readingFontSize) || 20));
  readingFontSize = size;
  document.documentElement.style.setProperty('--reading-font-size', size + 'px');

  const selectors = [
    '#katameros-content .reading-text',
    '#synaxarium-content .synax-section-body',
    '#synaxarium-content .synaxarium-story',
    '#prayer-content .prayer-section-body',
    '#prayer-content .prayer-text',
    '#prayer-content .prayer-single-text',
    '#prayer-content .local-prayer-pages',
    '#prayer-content .selected-psalm-view .prayer-section-body'
  ];
  document.querySelectorAll(selectors.join(',')).forEach(el => {
    el.style.setProperty('font-size', size + 'px', 'important');
  });
}

function changeReadingFontSize(delta) {
  readingFontSize = Math.max(14, Math.min(32, readingFontSize + delta * 2));
  localStorage.setItem('reading_fontSize', readingFontSize);
  applyReadingFontSize();
}

function applyIconScale() {
  iconScale = Math.max(0.50, Math.min(1.35, iconScale));
  document.documentElement.style.setProperty('--app-icon-scale', String(iconScale));
}

function changeIconSize(delta) {
  iconScale = Math.max(0.50, Math.min(1.35, iconScale + delta * 0.1));
  localStorage.setItem('app_icon_scale', String(iconScale));
  applyIconScale();
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
  const iconLabel = document.getElementById('settings-icon-size');
  if (themeBtn) themeBtn.textContent = isDark ? '☀️' : '🌙';
  if (fontLabel) fontLabel.textContent = `${fontSize}px`;
  if (iconLabel) iconLabel.textContent = `${Math.round(iconScale * 100)}%`;
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
        const select = document.getElementById('psalm-select');
        if (select) select.value = String(targetPsalm);
        return;
      }

      const nextPartIndex = current + (direction > 0 ? 1 : -1);
      if (nextPartIndex >= 0 && nextPartIndex < parts.length) {
        showPrayerPart(nextPartIndex);
      }
      return;
    }
    const next = Math.min(parts.length-1, Math.max(0, (Number.isFinite(current) ? current : 0) + (direction > 0 ? 1 : -1)));
    if (parts[next]) showPrayerPart(next);
    return;
  }
  if (active.id === 'katameros-screen') {
    const parts = window.__katamerosParts || [];
    const current = Number(window.__selectedKatamerosPart);
    const next = Math.min(parts.length-1, Math.max(0, (Number.isFinite(current) ? current : 0) + (direction > 0 ? 1 : -1)));
    if (parts[next]) showKatamerosPart(next);
    return;
  }
  if (active.id === 'synaxarium-screen') {
    const parts = window.__synaxParts || [];
    if (parts.length < 2) return;
    const current = Number(window.__selectedSynaxPart);
    const next = Math.min(parts.length-1, Math.max(0, (Number.isFinite(current) ? current : 0) + (direction > 0 ? 1 : -1)));
    if (parts[next]) showSynaxariumPart(next);
  }
}
function initSwipeNavigation() {
  document.addEventListener('touchstart', e => {
    if (!e.touches || e.touches.length !== 1) return;
    const target = e.target;
    const active = document.querySelector('.screen.active');
    const inPsalmArea = active && active.id === 'prayer-screen' && target.closest('.psalm-picker-box,.selected-psalm-view');
    if (!inPsalmArea && target.closest('input,textarea,select,button,a,[contenteditable="true"],#audio-track')) return;
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
applyIconScale();
initSwipeNavigation();
  } catch (error) {
    console.error('خطأ أثناء تهيئة الموقع:', error);
  }
});

Object.assign(window, {
  showScreen, goHome, openTestament, backToBooks, openBook, backToChapters,
  openChapter, speakVerses, stopSpeaking, changeFontSize, changeReadingFontSize, changeIconSize, toggleDarkMode,
  toggleFavorite, showFavorites, removeFavorite, showDailyVerse, shareVerse,
  showSearch, performSearch, showReadingPlan, showSettings, updateSettingsUI,
  openBibleMenu, openAgpeya, openPrayer, togglePrayerPicker, closePrayerPicker, showPrayerPart,
  toggleDailyPicker, closeDailyPicker, showKatamerosPart, showSynaxariumPart, initSwipeNavigation
});