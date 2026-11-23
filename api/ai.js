// دالة الذكاء الاصطناعي: شرح مفصل لكل نقطة (explain) + جواب أسئلة التلميذ (ask)
const MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const SYS =
  'أنت أستاذ لغة عربية مغربي ودود لتلاميذ الثانية بكالوريا (آداب وعلوم إنسانية). ' +
  'تتكلم بعربية فصيحة سهلة وواضحة، بلا رموز ولا إيموجي ولا تنسيق ماركداون.';

const ARRAY_SCHEMA = { type: 'ARRAY', items: { type: 'STRING' } };
const TUNE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING', enum: ['tune', 'question'] },
    reply: { type: 'STRING' },
    reset: { type: 'BOOLEAN' }, rerun: { type: 'BOOLEAN' }, clearNotes: { type: 'BOOLEAN' },
    writeSpeed: { type: 'NUMBER' }, writeLead: { type: 'NUMBER' }, speechRate: { type: 'NUMBER' }, pauseMs: { type: 'NUMBER' },
    detail: { type: 'STRING', enum: ['brief', 'normal', 'detailed'] },
    addNote: { type: 'STRING' },
  },
  required: ['intent', 'reply'],
};
const notesText = (n) => (Array.isArray(n) && n.length ? '\nتعليمات أسلوب دائمة من التلميذ (التزم بها): ' + n.slice(-6).map((x) => String(x).slice(0, 200)).join(' | ') : '');
const LEN = { brief: 'بين 120 و300 حرف', normal: 'بين 250 و650 حرفاً', detailed: 'بين 450 و900 حرف' };

async function gemini(key, prompt, schema) {
  const generationConfig = { temperature: 0.5, thinkingConfig: { thinkingBudget: 0 } };
  if (schema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = schema;
  }
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYS }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      }),
    }
  );
  if (!r.ok) throw new Error('Gemini ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const d = await r.json();
  return (d?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return res.status(200).json({ ok: true, hasKey: !!process.env.GEMINI_API_KEY, model: MODEL });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' });
  const b = req.body || {};

  try {
    if (b.action === 'explain') {
      const blocks = (Array.isArray(b.blocks) ? b.blocks : []).slice(0, 12).map((x) => String(x).slice(0, 1500));
      if (!blocks.length) return res.status(400).json({ error: 'No blocks' });
      let prompt =
        `الدرس: ${String(b.lesson || '').slice(0, 200)}\nعنوان البطاقة: ${String(b.title || '').slice(0, 300)}\n\nالنقاط:\n` +
        blocks.map((t, i) => `${i + 1}) ${t}`).join('\n\n') +
        '\n\nاشرح كل نقطة شرحاً مفصلاً ودقيقاً كأنك تتحدث مع التلميذ أمامك: ابدأ بذكر اسم النقطة، فسّر كل جزء فيها ' +
        'مع مثال أو ربط بالنص عند الحاجة، ثم اختم بجملة تثبيت قصيرة. التزم بمضمون النقاط المعطاة ولا تخترع أسماء أو تواريخ ' +
        'أو أبياتاً جديدة. كل شرح ' + (LEN[b.detail] || LEN.normal) + '. أرجع مصفوفة JSON من النصوص بنفس عدد النقاط وبنفس الترتيب.';
      if (b.mode === 'simpler')
        prompt += '\nالتلميذ لم يفهم في المرة السابقة، فاشرح بكلمات أبسط وبمثال من الحياة اليومية، وبجمل أقصر.';
      prompt += notesText(b.notes);
      let arr = [];
      try { arr = JSON.parse(await gemini(key, prompt, ARRAY_SCHEMA)); } catch (e) { arr = []; }
      const explanations = blocks.map((t, i) => String(arr[i] || t).slice(0, 1100));
      return res.status(200).json({ explanations });
    }

    if (b.action === 'tune') {
      const msg = String(b.message || '').slice(0, 300);
      const prompt =
        'أنت تتحكم في إعدادات سبورة تفاعلية لشرح الدروس. الإعدادات الحالية: ' + JSON.stringify(b.settings || {}) + '\n' +
        'رسالة التلميذ (غالباً بالدارجة المغربية): ' + msg + '\n\n' +
        'إن كانت الرسالة ملاحظة أو طلباً يخص طريقة عمل السبورة (سرعة الكتابة، سرعة الصوت، طول الشرح أو بساطته، التزامن بين الكتابة والصوت، أسلوب الأستاذ، أو مدح/نقد للأداء) فاجعل intent=tune وأعد القيم الجديدة النهائية للحقول التي تتغير فقط. وإلا (سؤال في مادة الدرس) فاجعل intent=question.\n' +
        'الحقول: writeSpeed من 0.6 إلى 2 (1 افتراضي؛ الأكبر = كتابة أسرع تنتهي قبل نهاية الصوت). writeLead من -0.3 إلى 0.3 (سالب = الكتابة تتأخر عن الصوت، موجب = تسبقه). speechRate من 0.6 إلى 1.6. pauseMs من 200 إلى 3000 (وقفة بين النقاط). detail: brief أو normal أو detailed. addNote: تعليمة أسلوب دائمة قصيرة تضاف لتعليمات الأستاذ (مثل: أكثر من الأمثلة). reset=true لإرجاع الإعدادات الافتراضية. clearNotes=true لمسح التعليمات. rerun=true إن كان التغيير يخص محتوى الشرح (detail أو addNote) ويستحق إعادة شرح البطاقة الحالية.\n' +
        'أمثلة: "خفف الشرح" -> detail ينزل درجة وrerun=true. "زيد شوية فسرعة الكتابة" -> writeSpeed = الحالي × 1.25. "كتب قبل ما تنطق" -> writeLead أقل بـ 0.1. "الكتابة تأخرات" -> writeLead أكثر بـ 0.1. "كتبتي مزيان" -> intent=tune بلا تغيير وreply شكر قصير.\n' +
        'reply: جملة قصيرة بالدارجة المغربية البسيطة تؤكد ما تغيّر.';
      let out;
      try { out = JSON.parse(await gemini(key, prompt, TUNE_SCHEMA)); } catch (e) { out = { intent: 'question', reply: '' }; }
      return res.status(200).json(out);
    }

    if (b.action === 'ask') {
      const q = String(b.question || '').slice(0, 500).trim();
      if (!q) return res.status(400).json({ error: 'No question' });
      const prompt =
        `الدرس: ${String(b.lesson || '').slice(0, 200)}\nما هو مكتوب الآن على السبورة:\n${String(b.context || '').slice(0, 4000)}\n\n` +
        `سؤال التلميذ: ${q}\n\nأجب بدقة وبوضوح في 300 إلى 650 حرفاً، معتمداً على ما في السبورة أولاً، ` +
        'وبمثال إن لزم. إن كان السؤال خارج مقرر اللغة العربية فاعتذر بلطف وأعده إلى الدرس.' + notesText(b.notes);
      const answer = (await gemini(key, prompt, null)).trim().slice(0, 1100);
      return res.status(200).json({ answer });
    }
    return res.status(400).json({ error: 'Bad action' });
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
};
