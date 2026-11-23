// محرك السبورة: صوت Gemini رجالي + كتابة متزامنة + شرح مفصل لكل نقطة بالإشارة + "فهمتي؟" + أسئلة التلميذ
(() => {
  'use strict';
  const cache = new Map(), exCache = new Map();
  let session = 0, flow = 0, raf = 0, audio = null, cancelSay = null, askResolve = null;
  const ASK_PHRASE = 'هل فهمتَ هذه النقطة؟ إن فهمتَ فاضغط فهمت لننتقل إلى التالية، وإن لم تفهم فاضغط عاود، أو اكتب سؤالك في الأسفل.';

  const st = document.createElement('style');
  st.textContent = `.w{opacity:0;transition:opacity .12s}.w.on{opacity:1}
  .blk.pending{visibility:hidden}
  .card-focus .blk:not(.hl):not(.pending){opacity:.4;transition:opacity .3s}
  .blk.hl{outline:2px solid #fbbf24;outline-offset:3px;border-radius:12px;background:rgba(251,191,36,.10)!important;box-shadow:0 0 18px rgba(251,191,36,.25)}`;
  document.head.appendChild(st);

  const pen = document.createElement('span');
  pen.className = 'active-pen-cursor';
  pen.textContent = '✍️';

  const sel = document.getElementById('voiceEngineSelect');
  sel.innerHTML =
    '<option value="gemini" class="bg-slate-900">صوت رجالي واضح (Gemini)</option>' +
    '<option value="browser" class="bg-slate-900">صوت المتصفح</option>';
  voiceEngineMode = 'gemini';

  // ---------- شبكة ----------
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const e = new Error(url + ' ' + r.status); e.status = r.status; throw e; }
    return r;
  }
  const ai = async (action, payload) => (await post('/api/ai', { action, ...payload })).json();

  function fetchAudio(text) {
    if (!cache.has(text)) {
      const p = (async () => {
        try { return URL.createObjectURL(await (await post('/api/tts', { text })).blob()); }
        catch (e) { await new Promise((ok) => setTimeout(ok, 800)); return URL.createObjectURL(await (await post('/api/tts', { text })).blob()); }
      })();
      p.catch(() => cache.delete(text));
      cache.set(text, p);
    }
    return cache.get(text);
  }
  const prefetchAudio = (t) => { if (voiceEngineMode === 'gemini' && t) fetchAudio(t).catch(() => {}); };

  // ---------- تقسيم البطاقة إلى نقاط وكلمات ----------
  function groupBlocks(card) {
    const map = new Map();
    card.querySelectorAll('[data-type="1"]').forEach((it) => {
      const c = it.closest('.grid > *, tbody > tr, .board-card > *') || card;
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(it);
    });
    return [...map].map(([el, items]) => ({ el, items }));
  }
  const textOf = (items) => items.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join(' ');

  function wrapElement(el) {
    const spans = [], nodes = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach((n) => {
      const frag = document.createDocumentFragment();
      n.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) return frag.appendChild(document.createTextNode(part));
        const s = document.createElement('span');
        s.className = 'w';
        s.textContent = part;
        frag.appendChild(s);
        spans.push(s);
      });
      n.replaceWith(frag);
    });
    return spans;
  }
  function mkState(spans) {
    let a = 0;
    const cum = spans.map((s) => (a += s.textContent.length));
    return { spans, cum, total: a || 1, shown: 0 };
  }
  function prepareBlocks(wrap) {
    return groupBlocks(wrap).map((g, i) => {
      const text = textOf(g.items);
      const b = Object.assign(mkState(g.items.flatMap((x) => wrapElement(x))), { el: g.el, text });
      if (i > 0) g.el.classList.add('blk', 'pending');
      return b;
    });
  }

  function reveal(p, frac) {
    const limit = frac * p.total;
    let moved = false;
    while (p.shown < p.spans.length && p.cum[p.shown] <= limit) {
      const s = p.spans[p.shown++];
      s.classList.add('on');
      s.after(pen);
      moved = true;
      if (p.shown % 4 === 0) playChalkTick();
    }
    if (moved) boardCanvas.scrollTop = boardCanvas.scrollHeight;
  }
  function finishReveal(p) { p.spans.forEach((s) => s.classList.add('on')); p.shown = p.spans.length; pen.remove(); }
  function runSync(p, getFrac) {
    cancelAnimationFrame(raf);
    const tick = () => { reveal(p, Math.min(1, getFrac() / 0.93)); raf = requestAnimationFrame(tick); };
    tick();
  }
  function timerClock(durMs) {
    let last = performance.now(), el = 0;
    return () => { const n = performance.now(); if (isPlaying) el += n - last; last = n; return el / durMs; };
  }
  function finishCardInstantly(wrap) {
    wrap.querySelectorAll('.w').forEach((s) => s.classList.add('on'));
    wrap.querySelectorAll('.pending').forEach((e) => e.classList.remove('pending'));
    wrap.querySelectorAll('.hl').forEach((e) => e.classList.remove('hl'));
    wrap.querySelectorAll('.ask-box').forEach((e) => e.remove());
    wrap.classList.remove('card-focus');
    pen.remove();
  }

  // ---------- الصوت ----------
  function halt() {
    session++;
    cancelAnimationFrame(raf);
    clearTimeout(nextStepTimeout);
    if (cancelSay) { const c = cancelSay; cancelSay = null; c(); }
    try { speechSynthesis.cancel(); } catch (e) {}
    if (audio) { audio.onended = audio.onerror = audio.onplay = null; try { audio.pause(); } catch (e) {} audio = null; }
    pen.remove();
    setSpeakingUI(false);
  }
  window.stopAllAudio = () => { flow++; askResolve = null; halt(); };
  const origClear = clearTypingAndTimers;
  window.clearTypingAndTimers = () => { origClear(); cancelAnimationFrame(raf); pen.remove(); };

  // ينطق النص ويكتب p بالتزامن؛ يعيد true عند الانتهاء و false عند المقاطعة
  function say(text, p) {
    return new Promise(async (resolve) => {
      halt();
      cancelSay = () => resolve(false);
      const ses = session;
      liveSubtitle.textContent = text;
      teacherStatusText.textContent = 'الأستاذ يحضّر الشرح...';
      const done = () => {
        if (ses !== session) return;
        cancelAnimationFrame(raf);
        if (p) finishReveal(p);
        setSpeakingUI(false);
        cancelSay = null;
        setTimeout(() => resolve(true), 500);
      };
      let url = null;
      if (voiceEngineMode === 'gemini') {
        try { url = await fetchAudio(text); } catch (e) { showToast('تعذّر صوت Gemini (' + (e.status || 'شبكة') + ')، تم التحويل لصوت المتصفح'); }
      }
      if (ses !== session) return;
      if (url) {
        audio = new Audio(url);
        audio.playbackRate = speechRate;
        audio.onended = done;
        audio.onerror = done;
        audio.onplay = () => setSpeakingUI(true);
        if (p) runSync(p, () => (audio && audio.duration ? audio.currentTime / audio.duration : 0));
        audio.play().catch(() => { showToast('اضغط على زر الشرح للسماح بتشغيل الصوت'); isPlaying = false; updateControlsUI(); });
        return;
      }
      const dur = Math.max(4000, (text.length * 75) / speechRate);
      const clk = timerClock(dur);
      if (p) runSync(p, clk);
      const voices = 'speechSynthesis' in window ? speechSynthesis.getVoices().filter((v) => /^ar/i.test(v.lang)) : [];
      const voice = voices.find((v) => /majed|maged|naayf|tarik|hamed|male/i.test(v.name)) || voices[0];
      let spoken = !voice, timeUp = false;
      if (!voice) showToast('لا يوجد صوت عربي في المتصفح: الكتابة فقط');
      const tryDone = () => { if (spoken && timeUp) done(); };
      const iv = setInterval(() => {
        if (ses !== session) return clearInterval(iv);
        if (clk() >= 1) { timeUp = true; clearInterval(iv); tryDone(); }
      }, 200);
      if (voice) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = voice.lang; u.voice = voice; u.rate = speechRate;
        u.onstart = () => setSpeakingUI(true);
        u.onend = u.onerror = () => { spoken = true; tryDone(); };
        speechSynthesis.speak(u);
      }
    });
  }
  window.speakSynchronized = (text, onDone) => { say(text, null).then((ok) => { if (ok && onDone) onDone(); }); };

  // ---------- الشرح المفصل ----------
  function getExplain(lIdx, idx, mode) {
    const key = lIdx + '-' + idx + '-' + mode;
    if (!exCache.has(key)) {
      const step = LESSONS[lIdx].steps[idx];
      const d = document.createElement('div');
      d.innerHTML = step.buildHtml();
      const gs = groupBlocks(d).map((g) => textOf(g.items));
      const title = gs.shift() || '';
      exCache.set(key, ai('explain', { lesson: LESSONS[lIdx].title, title, blocks: gs, mode })
        .then((r) => r.explanations).catch(() => null)
        .then((v) => { if (!v) exCache.delete(key); return v; }));
    }
    return exCache.get(key);
  }

  // ---------- "فهمتي ولا نعاود؟" ----------
  const promptEl = document.getElementById('comprehensionPrompt');
  const DEFAULT_PROMPT = promptEl ? promptEl.textContent : '';
  function askBox(wrap) {
    wrap.querySelectorAll('.ask-box').forEach((e) => e.remove());
    teacherStatusText.textContent = 'الأستاذ ينتظر جوابك...';
    if (promptEl) promptEl.textContent = '🤔 فهمتي ولا نعاود؟ اضغط "راه فهمت" أو "عاود الشرح"، أو اكتب سؤالك.';
    const p = new Promise((res) => {
      askResolve = (c) => { askResolve = null; if (promptEl) promptEl.textContent = DEFAULT_PROMPT; res(c); };
    });
    say(ASK_PHRASE, null);
    return p;
  }
  async function afterChoice(choice, idx, my) {
    if (my !== flow) return;
    isPlaying = true;
    updateControlsUI();
    if (choice === 'ok') runCard(idx + 1, 'detailed');
    else runCard(idx, 'simpler');
  }

  // ---------- تشغيل بطاقة ----------
  async function runCard(idx, mode) {
    const lesson = LESSONS[currentLessonIdx];
    if (idx < 0 || idx >= lesson.steps.length) {
      isPlaying = false;
      updateControlsUI();
      teacherStatusText.textContent = 'اكتمل الدرس بنجاح!';
      showToast('اكتمل شرح هذا الدرس! يمكنك الانتقال إلى الدرس الموالي.');
      return;
    }
    halt();
    const my = ++flow;
    askResolve = null;
    emptyBoardOverlay.classList.add('hidden');
    liveContentStream.classList.remove('hidden');
    currentStepIdx = idx;
    updateControlsUI();
    while (liveContentStream.children.length > idx) liveContentStream.lastElementChild.remove();

    const step = lesson.steps[idx];
    const wrap = document.createElement('div');
    wrap.className = 'step-card-enter';
    wrap.innerHTML = step.buildHtml();
    liveContentStream.appendChild(wrap);
    boardCanvas.scrollTop = boardCanvas.scrollHeight;

    if (step.isQuiz) {
      if (typeof renderQuiz === 'function') renderQuiz();
      const ok = await say(step.speech, null);
      if (my === flow && ok) runCard(idx + 1, 'detailed');
      return;
    }

    const blocks = prepareBlocks(wrap);
    const exP = blocks.length > 1 ? getExplain(currentLessonIdx, idx, mode) : null;
    const intro = mode === 'simpler' ? 'حسناً، سأعيد شرح هذه النقطة بطريقة أبسط.' : step.speech;

    if (!(await say(intro, blocks[0])) || my !== flow) return;
    const ex = exP ? await exP : null;
    if (my !== flow) return;

    wrap.classList.add('card-focus');
    for (let i = 1; i < blocks.length; i++) {
      wrap.querySelectorAll('.hl').forEach((e) => e.classList.remove('hl'));
      blocks[i].el.classList.remove('pending');
      blocks[i].el.classList.add('hl');
      blocks[i].el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (ex && ex[i]) prefetchAudio(ex[i]);
      const text = (ex && ex[i - 1]) || blocks[i].text;
      if (!(await say(text, blocks[i])) || my !== flow) return;
    }
    finishCardInstantly(wrap);
    if (idx + 1 < lesson.steps.length) getExplain(currentLessonIdx, idx + 1, 'detailed');
    const choice = await askBox(wrap);
    afterChoice(choice, idx, my);
  }
  window.executeStep = (i) => runCard(i, 'detailed');
  window.startOrResumeLesson = () => { isPlaying = true; updateControlsUI(); runCard(Math.max(0, currentStepIdx), 'detailed'); };

  // ---------- أسئلة التلميذ ----------
  async function answerQuestion(q) {
    if (currentStepIdx < 0) { showToast('اضغط "ابدأ الشرح" أولاً ثم اطرح سؤالك'); return; }
    halt();
    const my = ++flow;
    askResolve = null;
    isPlaying = true;
    updateControlsUI();
    const idx = currentStepIdx;
    const wrap = liveContentStream.lastElementChild;
    finishCardInstantly(wrap);
    const context = wrap.innerText;
    const qa = document.createElement('div');
    qa.className = 'board-card p-4 rounded-2xl border-r-4 border-purple-400 mt-4 step-card-enter';
    qa.innerHTML = '<h3 class="font-extrabold text-purple-300 mb-2 text-sm sm:text-base"></h3><p class="text-xs sm:text-sm leading-relaxed"></p>';
    qa.querySelector('h3').textContent = '❓ سؤالك: ' + q;
    wrap.appendChild(qa);
    boardCanvas.scrollTop = boardCanvas.scrollHeight;
    teacherStatusText.textContent = 'الأستاذ يفكر في سؤالك...';
    liveSubtitle.textContent = 'الأستاذ يفكر في سؤالك...';
    let ans;
    try { ans = (await ai('ask', { question: q, lesson: LESSONS[currentLessonIdx].title, context })).answer; }
    catch (e) { ans = 'عذراً، تعذر الوصول إلى الأستاذ الآن. تأكد من الاتصال ومن مفتاح Gemini ثم أعد المحاولة.'; }
    if (my !== flow) return;
    const p = qa.querySelector('p');
    p.textContent = ans;
    const st2 = mkState(wrapElement(p));
    if (!(await say(ans, st2)) || my !== flow) return;
    afterChoice(await askBox(wrap), idx, my);
  }

  function classify(t) {
    if (t.length > 30) return 'q';
    if (/(ما|م)\s?فهمت|عاود|أعد|اعد|مفهم|ما\s?واضح|^لا$/.test(t)) return 'again';
    if (/^(راه\s*)?(فهمت|واضح|كمل|كمّل|تابع|نعم|اه|آه|أه|تمام|مزيان|واه|ok)/i.test(t)) return 'ok';
    return 'q';
  }
  function handleInput(t) {
    const k = classify(t);
    if (k === 'ok') { askResolve ? askResolve('ok') : document.getElementById('nextStepBtn').click(); }
    else if (k === 'again') {
      if (askResolve) askResolve('again');
      else if (currentStepIdx >= 0) { isPlaying = true; runCard(currentStepIdx, 'simpler'); }
      else showToast('اضغط "ابدأ الشرح" أولاً');
    } else answerQuestion(t);
  }

  // شريط التفاعل الموجود في الصفحة
  const form = document.getElementById('studentAskForm');
  const input = document.getElementById('studentInput');
  if (form && input) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    handleInput(t);
  });
  const qu = document.getElementById('quickUnderstoodBtn'), qr = document.getElementById('quickRepeatBtn');
  if (qu) qu.addEventListener('click', () => handleInput('فهمت'));
  if (qr) qr.addEventListener('click', () => handleInput('عاود'));

  // ---------- أزرار التحكم ----------
  document.getElementById('playPauseBtn').addEventListener('click', (e) => {
    if (askResolve) { e.stopImmediatePropagation(); showToast('الأستاذ ينتظر جوابك: فهمت أو عاود'); return; }
    if (isPlaying && audio && !audio.ended) {
      e.stopImmediatePropagation();
      audio.pause(); isPlaying = false; updateControlsUI(); setSpeakingUI(false);
      teacherStatusText.textContent = 'متوقف مؤقتاً';
    } else if (!isPlaying && audio && audio.paused && !audio.ended && audio.currentTime > 0) {
      e.stopImmediatePropagation();
      isPlaying = true; audio.play(); updateControlsUI(); setSpeakingUI(true);
    }
  }, true);
  ['prevStepBtn', 'nextStepBtn'].forEach((id) =>
    document.getElementById(id).addEventListener('click', () => stopAllAudio(), true));
  document.getElementById('speechRateSelect').addEventListener('change', () => { if (audio) audio.playbackRate = speechRate; });
})();
