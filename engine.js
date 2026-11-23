function runCalmWordByWord(p, stepMs = 115) {
  cancelAnimationFrame(raf);
  let lastTick = performance.now();
  const tick = (now) => {
    if (isPlaying && now - lastTick >= stepMs) {
      lastTick = now;
      if (p.shown < p.spans.length) {
        const s = p.spans[p.shown++];
        s.classList.add('on');
        s.after(pen);
        if (p.shown % 3 === 0) playChalkTick();
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
