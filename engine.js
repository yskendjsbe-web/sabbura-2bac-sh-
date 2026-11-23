// محرك الصوت + الكتابة المتزامنة مع الكلمات (يُحمَّل بعد السكربت الأصلي ويستبدل بعض دواله)
(() => {
  'use strict';
  const cache = new Map();
  let session = 0, raf = 0, audio = null, prep = null;

  const st = document.createElement('style');
  st.textContent = '.w{opacity:0;transition:opacity .12s}.w.on{opacity:1}';
  document.head.appendChild(st);

  const pen = document.createElement('span');
  pen.className = 'active-pen-cursor';
  pen.textContent = '✍️';

  // محرك الصوت: Gemini (رجل) أو صوت المتصفح
  const sel = document.getElementById('voiceEngineSelect');
  sel.innerHTML =
    '<option value="gemini" class="bg-slate-900">صوت رجالي واضح (Gemini)</option>' +
    '<option value="browser" class="bg-slate-900">صوت المتصفح</option>';
  voiceEngineMode = 'gemini';

  function fetchAudio(text) {
    if (!cache.has(text)) {
      const p = (async () => {
        for (let i = 0; i < 2; i++) {
          const r = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          if (r.ok) return URL.createObjectURL(await r.blob());
          if (i === 1) throw new Error('TTS ' + r.status);
          await new Promise((ok) => setTimeout(ok, 800));
        }
      })();
      p.catch(() => cache.delete(text));
      cache.set(text, p);
    }
    return cache.get(text);
  }

  // تقطيع نصوص البطاقة إلى كلمات مخفية (مع الحفاظ على <strong> و<br> والجداول)
  window.typewriteCardElements = function (card) {
    const spans = [];
    card.querySelectorAll('[data-type="1"]').forEach((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
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
    });
    let acc = 0;
    const cum = spans.map((s) => (acc += s.textContent.length));
    prep = { spans, cum, total: acc || 1, shown: 0 };
  };

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

  function finishReveal(p) {
    p.spans.forEach((s) => s.classList.add('on'));
    p.shown = p.spans.length;
    pen.remove();
  }

  // الكتابة تتبع تقدّم الصوت: الكلمة تظهر حين ينطقها الأستاذ تقريباً
  function runSync(p, getFrac) {
    cancelAnimationFrame(raf);
    const tick = () => {
      reveal(p, Math.min(1, getFrac() / 0.93));
      raf = requestAnimationFrame(tick);
    };
    tick();
  }

  function timerClock(durMs) {
    let last = performance.now(), el = 0;
    return () => {
      const n = performance.now();
      if (isPlaying) el += n - last;
      last = n;
      return el / durMs;
    };
  }

  window.stopAllAudio = function () {
    session++;
    cancelAnimationFrame(raf);
    clearTimeout(nextStepTimeout);
    try { speechSynthesis.cancel(); } catch (e) {}
    if (audio) {
      audio.onended = audio.onerror = null;
      try { audio.pause(); } catch (e) {}
      audio = null;
    }
    pen.remove();
    setSpeakingUI(false);
  };

  const origClear = clearTypingAndTimers;
  window.clearTypingAndTimers = function () {
    origClear();
    cancelAnimationFrame(raf);
    pen.remove();
  };

  window.speakSynchronized = async function (text, onDone) {
    stopAllAudio();
    const my = session;
    liveSubtitle.textContent = text;
    const p = prep; prep = null;
    teacherStatusText.textContent = 'الأستاذ يحضّر الشرح...';

    const done = () => {
      if (my !== session) return;
      cancelAnimationFrame(raf);
      if (p) finishReveal(p);
      setSpeakingUI(false);
      if (isPlaying && onDone) nextStepTimeout = setTimeout(onDone, 700);
    };

    let url = null;
    if (voiceEngineMode === 'gemini') {
      try { url = await fetchAudio(text); }
      catch (e) { showToast('تعذّر صوت Gemini، تم التحويل لصوت المتصفح'); }
    }
    if (my !== session) return;

    if (url) {
      audio = new Audio(url);
      audio.playbackRate = speechRate;
      audio.onended = done;
      audio.onerror = done;
      audio.onplay = () => setSpeakingUI(true);
      if (p) runSync(p, () => (audio && audio.duration ? audio.currentTime / audio.duration : 0));
      audio.play().catch(() => {
        showToast('اضغط على زر الشرح للسماح بتشغيل الصوت');
        isPlaying = false;
        updateControlsUI();
      });
      const next = LESSONS[currentLessonIdx].steps[currentStepIdx + 1];
      if (next) fetchAudio(next.speech).catch(() => {});
      return;
    }

    // صوت المتصفح (احتياطي)
    const dur = Math.max(3000, (text.length * 68) / speechRate);
    if (p) runSync(p, timerClock(dur));
    if (!('speechSynthesis' in window)) { nextStepTimeout = setTimeout(done, dur); return; }
    const voices = speechSynthesis.getVoices().filter((v) => /^ar/i.test(v.lang));
    const voice = voices.find((v) => /majed|maged|naayf|tarik|hamed|male/i.test(v.name)) || voices[0];
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice ? voice.lang : 'ar-SA';
    if (voice) u.voice = voice;
    u.rate = speechRate;
    u.onstart = () => setSpeakingUI(true);
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  };

  // إيقاف مؤقت حقيقي واستئناف من نفس الكلمة
  document.getElementById('playPauseBtn').addEventListener('click', (e) => {
    if (isPlaying && audio && !audio.ended) {
      e.stopImmediatePropagation();
      audio.pause();
      isPlaying = false;
      updateControlsUI();
      setSpeakingUI(false);
      teacherStatusText.textContent = 'متوقف مؤقتاً';
    } else if (!isPlaying && audio && audio.paused && !audio.ended && audio.currentTime > 0) {
      e.stopImmediatePropagation();
      isPlaying = true;
      audio.play();
      updateControlsUI();
      setSpeakingUI(true);
    }
  }, true);

  ['prevStepBtn', 'nextStepBtn'].forEach((id) =>
    document.getElementById(id).addEventListener('click', () => stopAllAudio(), true)
  );

  document.getElementById('speechRateSelect').addEventListener('change', () => {
    if (audio) audio.playbackRate = speechRate;
  });
})();
