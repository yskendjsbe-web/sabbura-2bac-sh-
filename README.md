# السبورة الذكية — نشر على GitHub + Vercel

## هيكل المشروع
```
smart-board/
├─ index.html      ← ملفك الأصلي + سطر واحد (انظر أسفل)
├─ engine.js       ← الصوت الرجالي + الكتابة كلمة بكلمة
├─ api/tts.js      ← دالة الخادم التي تكلم Gemini (المفتاح سري هنا)
└─ package.json
```

## 1) عدّل index.html
احفظ ملفك الأصلي باسم `index.html` وأضف هذا السطر قبل `</body>` مباشرة (بعد وسم </script> الأخير):
```html
<script src="engine.js"></script>
```

## 2) مفتاح Gemini
من https://aistudio.google.com/apikey أنشئ مفتاحاً مجانياً.

## 3) GitHub
```
git init && git add . && git commit -m "smart board"
git branch -M main
git remote add origin https://github.com/USERNAME/smart-board.git
git push -u origin main
```
> لا تضع المفتاح في أي ملف. 

## 4) Vercel
1. vercel.com → Add New → Project → اختر المستودع → Deploy.
2. Settings → Environment Variables → أضف `GEMINI_API_KEY` = مفتاحك (لكل البيئات).
3. Deployments → Redeploy.

## اختياري (متغيرات بيئة)
- `GEMINI_VOICE`: Charon (افتراضي) | Orus | Fenrir | Algenib — كلها أصوات رجالية.
- `GEMINI_TTS_MODEL`: افتراضي gemini-2.5-flash-preview-tts

## تجربة محلية
`npm i -g vercel` ثم `vercel dev` (مع ملف `.env` فيه `GEMINI_API_KEY=...`، ولا ترفعه إلى GitHub).
