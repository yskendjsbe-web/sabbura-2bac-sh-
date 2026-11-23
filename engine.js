(() => {
  'use strict';

  let session = 0;
  let raf = 0;
  let audio = null;
  let prep = null;
  let awaitingComprehension = false;

  const st = document.createElement('style');
  st.textContent = '.w{opacity:0;transition:opacity .12s}.w.on{opacity:1}';
  document.head.appendChild(st);

  const pen = document.createElement('span');
  pen.className = 'active-pen-cursor';
  pen.textContent = '✍️';

  const sel = document.getElementById('voiceEngineSelect');
  if (sel) {
    sel.innerHTML =
      '<option value="auto" class="bg-slate-900">صوت عربي تلقائي (مضمون)</option>' +
      '<option value="browser" class="bg-slate-900">صوت المتصفح فقط</option>' +
      '<option value="cloud" class="bg-slate-900">صوت سحابي عربي</option>';
  }
  voiceEngineMode = 'auto';

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
    prep = { spans, total: spans.length || 1, shown: 0 };
  };

  function startWordWriter(p, stepMs = 130) {
    cancelAnimationFrame(raf);
    if (!p || !p.spans.length) return;
    let last = performance.now();

    const tick = (now) => {
      if (isPlaying && now - last >= stepMs) {
        last = now;
        if (p.shown < p.spans.length) {
          const s = p.spans[p.shown++];
          s.classList.add('on');
          s.after(pen);
          if (p.shown % 4 === 0) playChalkTick();
          boardCanvas.scrollTop = boardCanvas.scrollHeight;
        }
      }
      if (p.shown < p.spans.length) {
        raf = requestAnimationFrame(tick);
      } else {
        pen.remove();
      }
    };
    raf = requestAnimationFrame(tick);
  }

  function finishReveal(p) {
    if (!p) return;
    p.spans.forEach((s) => s.classList.add('on'));
    p.shown = p.spans.length;
    pen.remove();
  }

  window.stopAllAudio = function () {
    session++;
    cancelAnimationFrame(raf);
    clearTimeout(nextStepTimeout);
    try {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    } catch (e) {}
    if (audio) {
      audio.onended = audio.onerror = null;
      try {
        audio.pause();
        audio.src = '';
      } catch (e) {}
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

  function splitArabicText(text, maxLen = 140) {
    const parts = text.split(/([.،!؟:؛])/);
    const chunks = [];
    let cur = '';
    for (const part of parts) {
      if ((cur + part).length <= maxLen) {
        cur += part;
      } else {
        if (cur.trim()) chunks.push(cur.trim());
        cur = part;
      }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.length ? chunks : [text.slice(0, maxLen)];
  }

  function playArabicCloud(text, mySession, p, onDone) {
    const chunks = splitArabicText(text, 140);
    let idx = 0;

    function nextChunk() {
      if (mySession !== session || !isPlaying) return;
      if (idx >= chunks.length) {
        finishReveal(p);
        setSpeakingUI(false);
        if (onDone) onDone();
        return;
      }
      const chunk = chunks[idx++];
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ar&q=${encodeURIComponent(chunk)}`;
      const a = new Audio(url);
      a.playbackRate = speechRate;
      audio = a;

      setSpeakingUI(true);
      a.onended = () => nextChunk();
      a.onerror = () => {
        const waitMs = Math.max(2400, (chunk.length * 60) / speechRate);
        nextStepTimeout = setTimeout(nextChunk, waitMs);
      };
      a.play().catch(() => {
        const waitMs = Math.max(2400, (chunk.length * 60) / speechRate);
        nextStepTimeout = setTimeout(nextChunk, waitMs);
      });
    }

    nextChunk();
  }

  function tryBrowserArabic(text, mySession, p, onDone) {
    if (!('speechSynthesis' in window)) {
      playArabicCloud(text, mySession, p, onDone);
      return;
    }

    const voices = speechSynthesis.getVoices().filter((v) => /^ar/i.test(v.lang));
    if (!voices.length && voiceEngineMode === 'auto') {
      playArabicCloud(text, mySession, p, onDone);
      return;
    }

    let started = false;
    const u = new SpeechSynthesisUtterance(text);
    const chosen =
      voices.find((v) => /majed|maged|naayf|tarik|hamed|male/i.test(v.name)) || voices[0];

    u.lang = chosen ? chosen.lang : 'ar-SA';
    if (chosen) u.voice = chosen;
    u.rate = speechRate;

    const fallbackTimer = setTimeout(() => {
      if (!started && mySession === session && isPlaying) {
        try {
          speechSynthesis.cancel();
        } catch (e) {}
        playArabicCloud(text, mySession, p, onDone);
      }
    }, 1000);

    u.onstart = () => {
      started = true;
      clearTimeout(fallbackTimer);
      if (mySession === session) setSpeakingUI(true);
    };

    u.onend = () => {
      clearTimeout(fallbackTimer);
      if (mySession !== session) return;
      finishReveal(p);
      setSpeakingUI(false);
      if (isPlaying && onDone) {
        nextStepTimeout = setTimeout(onDone, 650);
      }
    };

    u.onerror = () => {
      clearTimeout(fallbackTimer);
      if (mySession === session && isPlaying) {
        playArabicCloud(text, mySession, p, onDone);
      }
    };

    try {
      speechSynthesis.speak(u);
    } catch (e) {
      clearTimeout(fallbackTimer);
      playArabicCloud(text, mySession, p, onDone);
    }
  }

  window.speakSynchronized = function (text, onDone) {
    stopAllAudio();
    const mySession = session;
    liveSubtitle.textContent = text;

    const p = prep;
    prep = null;

    const stepMs = Math.max(95, Math.round(135 / speechRate));
    if (p) startWordWriter(p, stepMs);

    const finishStep = () => {
      if (mySession !== session) return;
      cancelAnimationFrame(raf);
      finishReveal(p);
      setSpeakingUI(false);
      awaitingComprehension = true;
      isPlaying = false;
      updateControlsUI();
      teacherStatusText.textContent = 'في انتظار ردك: "راه فهمت" أو سؤالك';
      const promptEl = document.getElementById('comprehensionPrompt');
      if (promptEl) {
        promptEl.textContent =
          '❓ واش فهمتي هاد الجزء ولا نعاود نشرحو ليك؟ اكتب "راه فهمت" أو سول على أي حاجة.';
      }
      if (onDone) onDone();
    };

    if (voiceEngineMode === 'cloud') {
      playArabicCloud(text, mySession, p, finishStep);
    } else {
      tryBrowserArabic(text, mySession, p, finishStep);
    }
  };

  document.getElementById('playPauseBtn').addEventListener(
    'click',
    (e) => {
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
    },
    true
  );

  ['prevStepBtn', 'nextStepBtn'].forEach((id) =>
    document.getElementById(id).addEventListener(
      'click',
      () => {
        awaitingComprehension = false;
        stopAllAudio();
      },
      true
    )
  );

  document.getElementById('speechRateSelect').addEventListener('change', () => {
    if (audio) audio.playbackRate = speechRate;
  });
})();
