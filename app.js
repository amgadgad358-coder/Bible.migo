// Bible Reader Internet Text Fix v2
// ============ المتغيرات العامة ============
let bibleData = null;
let currentTestament = 'old';
let currentBook = null;
let currentChapter = 1;
let favorites = JSON.parse(localStorage.getItem('bible_favorites') || '[]');
let fontSize = parseInt(localStorage.getItem('bible_fontSize') || '20');
let isDark = localStorage.getItem('bible_dark') === 'true';

// ============ متغيرات الصوت ============
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

// ============ التنقل بين الشاشات ============
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

// ============ تحميل الكتاب المقدس ============
async function loadBibleData() {
  // نحمّل البيانات المحلية فقط كخطة احتياطية.
  // عند فتح أي إصحاح سنحاول أولاً جلب النص المنظم من الإنترنت.
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

/*
 * eBible.org يعرض كل إصحاح في ملف مستقل مثل GEN01.htm.
 * نقرأ النص من الصفحة ونستخرج رقم الآية + نصها، بدلاً من أخذ
 * النص الخام للصفحة بالكامل، حتى لا تظهر العناوين والقوائم وسط الآيات.
 */
// ============ مصادر الإنترنت + التخزين المحلي ============
// المصدر الأول: eBible HTML
// المصدر الثاني: Bible SuperSearch API (SVD العربي)
// بعد نجاح أي مصدر يتم حفظ الإصحاح في localStorage ليعمل لاحقاً حتى بدون اتصال.
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
    // لو امتلأت مساحة localStorage لا نفشل عرض الإصحاح.
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

  // نختار سلسلة تبدأ من 1 حتى لا نأخذ أرقاماً من واجهة الموقع.
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
  // 1) لو الإصحاح اتولد قبل كده، نستخدم النسخة المحفوظة فوراً.
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
  // الإنترنت أولاً دائماً، لأن هذا هو المصدر الأساسي للنص.
  try {
    const remoteVerses = await fetchRemoteChapter(bookName, chapterNum);

    // حفظ نسخة الجلسة بعد نجاح الإنترنت.
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

    // fallback محلي إذا كان الإنترنت غير متاح.
    const book = Array.isArray(bibleData)
      ? bibleData.find(b => b.name === bookName)
      : null;

    const localVerses = book?.chapters?.[chapterNum - 1];
    if (Array.isArray(localVerses) && localVerses.length) {
      // تحويل الأسطر المحلية إلى آيات منفصلة بشكل مقروء.
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

    // يدعم # و ## حتى لو كان الملف يحتوي على BOM أو مسافات.
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

// ============ الأسفار ============
// ============ توليد القوائم تلقائياً عند تحميل الموقع ============
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

  // تجهيز القوائم في الذاكرة قبل أي ضغط على الشاشة.
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

// ============ عرض الإصحاح ============
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

    // توحيد شكل البيانات سواء جاءت من الإنترنت أو من النسخة المحلية.
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
// ============ تجهيز بيانات الصوت ============
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

// ============ القراءة الصوتية الخارجية ============
// مصدر تسجيلات عربية بشرية حقيقية من Wordproject.
// book number مطابق لترتيب الأسفار 1..66.
const WORDPROJECT_AUDIO_BASES = [
  'https://www.wordproaudio.net/bibles/app/audio/16',
  'https://wordproaudio.net/bibles/app/audio/16'
];

// أرقام WordProject ثابتة: متى=40، مرقس=41، لوقا=42، يوحنا=43 ...
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

  // كحل أخير، استخدم قارئ الجهاز حتى لا يبقى الإصحاح بلا صوت.
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

// ============ المؤقت ============
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

// ============ تظليل الآية ============
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

// ============ السحب يمين ويسار ============
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

// ============ إعادة التشغيل من كلمة معينة ============
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

// ============ الأدوات ============
function changeFontSize(delta) {
  fontSize = Math.max(14, Math.min(32, fontSize + delta * 2));
  document.getElementById('verses-container').style.fontSize = fontSize + 'px';
  localStorage.setItem('bible_fontSize', fontSize);
}

function toggleDarkMode() {
  isDark = !isDark;
  document.body.classList.toggle('dark', isDark);
  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) themeBtn.textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('bible_dark', isDark);
  updateSettingsUI();
}

// ============ الإعدادات والتواصل ============
function updateSettingsUI() {
  const themeBtn = document.getElementById('settings-theme-btn');
  const fontLabel = document.getElementById('settings-font-size');
  if (themeBtn) themeBtn.textContent = isDark ? '☀️' : '🌙';
  if (fontLabel) fontLabel.textContent = `${fontSize}px`;
}

function showSettings() {
  updateSettingsUI();
  showScreen('settings-screen');
}

// ============ المفضلة ============
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

// ============ آية اليوم ============
function getDailyVerse() {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const dayOfYear = Math.floor((now - start) / 86400000);
  const dateKey = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const saved = JSON.parse(localStorage.getItem('bible_daily_verse') || 'null');

  // الآية ثابتة طوال اليوم، وتُعاد قراءتها عند فتح التطبيق مرة أخرى.
  if (saved && saved.dateKey === dateKey && saved.year === year && dailyVerses[saved.index]) {
    return dailyVerses[saved.index];
  }

  // تغيير ترتيب الاختيار مع بداية كل سنة حتى لا يبدأ العام الجديد بنفس التسلسل.
  const index = (dayOfYear + (year * 7)) % dailyVerses.length;
  localStorage.setItem('bible_daily_verse', JSON.stringify({ dateKey, year, index }));
  return dailyVerses[index];
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

// ============ البحث ============
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

  // البحث في البيانات المحلية أولاً.
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

  // إضافة النتائج المعروفة من الآيات المختارة حتى يعمل البحث حتى قبل تحميل أي إصحاح.
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

  // إذا لم توجد نتيجة محلية، ابحث في جميع الأسفار من المصدر الإلكتروني.
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

// ============ خطة القراءة ============
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

// ============ التهيئة ============
window.addEventListener('DOMContentLoaded', async function() {
  try {
    if (isDark) {
      document.body.classList.add('dark');
      const themeBtn = document.getElementById('theme-btn');
      if (themeBtn) themeBtn.textContent = '️';
    }

    // توليد العهدين والأسفار والإصحاحات فور فتح الموقع.
    buildBibleNavigation();

    await loadBibleData();
    initAudioSeek();
  } catch (error) {
    console.error('خطأ أثناء تهيئة الموقع:', error);
  }
});

// ضمان أن دوال الأزرار الموجودة في HTML متاحة دائمًا في النطاق العام.
Object.assign(window, {
  showScreen, goHome, openTestament, backToBooks, openBook, backToChapters,
  openChapter, speakVerses, stopSpeaking, changeFontSize, toggleDarkMode,
  toggleFavorite, showFavorites, removeFavorite, showDailyVerse, shareVerse,
  showSearch, performSearch, showReadingPlan, showSettings, updateSettingsUI
});