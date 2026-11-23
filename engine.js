(() => {
  'use strict';

  let session = 0;
  let wordTimer = null;
  let activePrep = null;
  let awaitingComprehension = false;

  const styleTag = document.createElement('style');
  styleTag.textContent = '.w{opacity:0;transition:opacity .18s ease}.w.on{opacity:1}';
  document.head.appendChild(styleTag);

  const pen = document.createElement('span');
  pen.className = 'active-pen-cursor';
  pen.textContent = '✍️';

  const voiceSelect = document.getElementById('voiceEngineSelect');
  if (voiceSelect) {
    voiceSelect.innerHTML =
      '<option value="browser" selected class="bg-slate-900">صوت المتصفح العربي</option>' +
      '<option value="silent" class="bg-slate-900">كتابة فقط (بدون صوت)</option>';
  }
  voiceEngineMode = 'browser';

  function stopWordTimer() {
    if (wordTimer) {
      clearInterval(wordTimer);
      wordTimer = null;
    }
    pen.remove();
  }

  window.typewriteCardElements = function (card) {
    stopWordTimer();
    const spans = [];

    card.querySelectorAll('[data-type="1"]').forEach((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      textNodes.forEach((node) => {
        const frag = document.createDocumentFragment();
        node.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            frag.appendChild(document.createTextNode(part));
          } else {
            const span = document.createElement('span');
            span.className = 'w';
            span.textContent = part;
            frag.appendChild(span);
            spans.push(span);
          }
        });
        node.replaceWith(frag);
      });
    });

    activePrep = {
      spans,
      index: 0
    };
  };

  function revealRemainingWords(prepObj) {
    if (!prepObj || !prepObj.spans) return;
    for (let i = prepObj.index; i < prepObj.spans.length; i++) {
      prepObj.spans[i].classList.add('on');
    }
    prepObj.index = prepObj.spans.length;
    pen.remove();
  }

  function startSlowWordByWord(prepObj) {
    stopWordTimer();
    if (!prepObj || !prepObj.spans.length) return;

    // سرعة كتابة هادئة ومريحة للعين: حوالي 220ms لكل كلمة في 1.0x
    const intervalMs = Math.max(110, Math.round(220 / (speechRate || 1)));

    wordTimer = setInterval(() => {
      if (!isPlaying) return;

      if (prepObj.index >= prepObj.spans.length) {
        stopWordTimer();
        return;
      }

      const currentSpan = prepObj.spans[prepObj.index++];
      currentSpan.classList.add('on');
      currentSpan.after(pen);

      if (prepObj.index % 3 === 0 && typeof playChalkTick === 'function') {
        playChalkTick();
      }
      if (typeof boardCanvas !== 'undefined' && boardCanvas) {
        boardCanvas.scrollTop = boardCanvas.scrollHeight;
      }
    }, intervalMs);
  }

  window.stopAllAudio = function () {
    session++;
    stopWordTimer();
    clearTimeout(nextStepTimeout);
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch (e) {}
    setSpeakingUI(false);
  };

  const baseClear = typeof clearTypingAndTimers === 'function' ? clearTypingAndTimers : () => {};
  window.clearTypingAndTimers = function () {
    baseClear();
    stopWordTimer();
  };

  function pickArabicVoice() {
    if (!('speechSynthesis' in window)) return null;
    const allVoices = window.speechSynthesis.getVoices() || [];
    const arVoices = allVoices.filter((v) => /^ar/i.test(v.lang));
    if (!arVoices.length) return null;
    return (
      arVoices.find((v) => /majed|maged|naayf|tarik|hamed|salma|layla|male|arabic/i.test(v.name)) ||
      arVoices[0]
    );
  }

  window.speakSynchronized = function (text, onDone) {
    stopAllAudio();
    const mySession = session;

    if (typeof liveSubtitle !== 'undefined' && liveSubtitle) {
      liveSubtitle.textContent = text;
    }

    const prepObj = activePrep;
    activePrep = null;

    if (prepObj) {
      startSlowWordByWord(prepObj);
    }

    const markStepReadyForStudent = () => {
      if (mySession !== session) return;
      revealRemainingWords(prepObj);
      stopWordTimer();
      setSpeakingUI(false);
      awaitingComprehension = true;
      isPlaying = false;
      if (typeof updateControlsUI === 'function') updateControlsUI();
      if (typeof teacherStatusText !== 'undefined' && teacherStatusText) {
        teacherStatusText.textContent = 'في انتظار ردك: "راه فهمت" أو سؤالك';
      }
      const promptEl = document.getElementById('comprehensionPrompt');
      if (promptEl) {
        promptEl.textContent =
          '❓ واش فهمتي هاد الجزء ولا نعاود نشرحو ليك؟ اكتب "راه فهمت" أو سول على أي حاجة.';
      }
      if (typeof onDone === 'function') onDone();
    };

    const wordsCount = String(text || '').trim().split(/\s+/).filter(Boolean).length;
    const minWaitMs = Math.max(4500, Math.round((wordsCount * 240) / (speechRate || 1)));

    if (voiceEngineMode === 'silent' || !('speechSynthesis' in window)) {
      setSpeakingUI(true);
      nextStepTimeout = setTimeout(markStepReadyForStudent, minWaitMs);
      return;
    }

    const voice = pickArabicVoice();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice ? voice.lang : 'ar-SA';
    if (voice) utterance.voice = voice;
    utterance.rate = speechRate || 1;

    let finished = false;
    const safeFinish = () => {
      if (finished || mySession !== session) return;
      finished = true;
      clearTimeout(safetyTimer);
      markStepReadyForStudent();
    };

    // مؤقت أمان باش الكتابة تكمل بهدوء حتى لو أنهى المتصفح الصوت مبكراً
    const safetyTimer = setTimeout(safeFinish, minWaitMs);

    utterance.onstart = () => {
      if (mySession === session) setSpeakingUI(true);
    };

    utterance.onend = () => {
      // نترك الكتابة تكمل حتى نهاية مؤقت الأمان إذا كانت باقا ما كملتش
      if (!prepObj || prepObj.index >= prepObj.spans.length) {
        safeFinish();
      }
    };

    utterance.onerror = () => {
      if (!voice && typeof showToast === 'function') {
        showToast('ما كاينش صوت عربي في المتصفح؛ الكتابة مستمرة بهدوء.');
      }
    };

    try {
      setSpeakingUI(true);
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      nextStepTimeout = setTimeout(safeFinish, minWaitMs);
    }
  };

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }

  const playBtn = document.getElementById('playPauseBtn');
  if (playBtn) {
    playBtn.addEventListener(
      'click',
      (e) => {
        if (isPlaying && 'speechSynthesis' in window && window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          e.stopImmediatePropagation();
          try { window.speechSynthesis.pause(); } catch (err) {}
          isPlaying = false;
          if (typeof updateControlsUI === 'function') updateControlsUI();
          setSpeakingUI(false);
          if (typeof teacherStatusText !== 'undefined' && teacherStatusText) {
            teacherStatusText.textContent = 'متوقف مؤقتاً';
          }
        } else if (!isPlaying && 'speechSynthesis' in window && window.speechSynthesis.paused) {
          e.stopImmediatePropagation();
          try { window.speechSynthesis.resume(); } catch (err) {}
          isPlaying = true;
          if (typeof updateControlsUI === 'function') updateControlsUI();
          setSpeakingUI(true);
        }
      },
      true
    );
  }

  ['prevStepBtn', 'nextStepBtn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener(
        'click',
        () => {
          awaitingComprehension = false;
          window.stopAllAudio();
        },
        true
      );
    }
  });
})();
