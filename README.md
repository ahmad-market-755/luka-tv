# Luka TV 🎬

تطبيق ويب (PWA) لمشاهدة الأفلام والمسلسلات — **مجاني بالكامل**:
- الاستضافة: GitHub Pages
- قاعدة البيانات وتسجيل الدخول: Firebase (باقة Spark المجانية)
- بيانات الأفلام (بوستر/قصة/تقييم): TMDB (مجاني)

## الملفات
| الملف | وظيفته |
|---|---|
| index.html | الصفحة الرئيسية للتطبيق |
| style.css | التصميم |
| app.js | كل منطق التطبيق (الصفحات، المشغّل، لوحة الإدارة) |
| firebase-config.js | **الإعدادات اللي هتعدلها** |
| manifest.json + icon.svg | عشان يتثبت على الموبايل كتطبيق |
| sw.js | يخلي التطبيق أسرع |
| firestore.rules | قواعد الأمان (تتنسخ في Firebase) |

---

## الخطوة 1: Firebase (مجاني)
1. ادخل https://console.firebase.google.com واعمل Project جديد (اقفل Google Analytics).
2. **Build > Authentication > Get started > Email/Password > Enable**.
3. تبويب **Users > Add user**: حط إيميلك وكلمة سر (ده حساب الأدمن).
4. **Build > Firestore Database > Create database** (اختار أقرب منطقة، و Production mode).
5. تبويب **Rules**: انسخ محتوى `firestore.rules` والصقه، وغيّر `you@example.com` لإيميلك، وادوس **Publish**.
6. **Project settings (⚙️) > Your apps > أيقونة </> (Web)**: سجّل تطبيق، وانسخ قيم `firebaseConfig`.
7. افتح `firebase-config.js` والصق القيم دي، وغيّر `ADMIN_EMAIL` لنفس الإيميل.

> **ملحوظة:** متفعّلش Firebase Storage؛ بقى بيطلب بطاقة دفع. إحنا مش محتاجينه، لأنك بتحط **روابط** الفيديو.

## الخطوة 2: مفتاح TMDB (مجاني)
1. سجّل في https://www.themoviedb.org وادخل Settings > API واطلب API key (النوع Developer).
2. الصق المفتاح في `TMDB_KEY` جوه `firebase-config.js`.

## الخطوة 3: الرفع على GitHub Pages
1. اعمل Repository جديد على GitHub (Public).
2. **Add file > Upload files** وارفع كل الملفات (من الموبايل عادي).
3. **Settings > Pages > Source: Deploy from a branch > main / (root) > Save**.
4. بعد دقيقة هتلاقي الرابط: `https://USERNAME.github.io/REPO/`
5. **Firebase > Authentication > Settings > Authorized domains** ضيف `USERNAME.github.io`.

## الخطوة 4: التثبيت على الموبايل
افتح الرابط في Chrome > القائمة (⋮) > **Add to Home screen / Install app**.

---

## إضافة فيلم أو مسلسل
1. افتح التطبيق > تبويب **الإدارة** > سجّل دخول بحساب الأدمن.
2. اكتب اسم الفيلم في خانة TMDB واضغط **بحث** وإختار النتيجة: البيانات كلها بتتملى لوحدها.
3. **فيلم:** الصق رابط الفيديو (mp4 / m3u8 / يوتيوب) في خانة «رابط الفيديو».
4. **مسلسل:** اكتب الحلقات سطر لكل حلقة: `رقم الموسم|رقم الحلقة|الرابط`
   ```
   1|1|https://example.com/s1e1.mp4
   1|2|https://example.com/s1e2.mp4
   ```
5. اضغط **حفظ**: بيظهر فوراً في الرئيسية.

## فين ترفع الفيديوهات مجاناً؟
- محتوى مملوك ليك أو مرخّص: أي استضافة بتدّيك **رابط مباشر** (mp4 أو m3u8).
- الدومين العام: https://archive.org فيه أفلام كتير مجانية قانونياً، وروابط التحميل بتاعتها تشتغل مباشرة.
- يوتيوب: الصق رابط الفيديو لو عندك صلاحية عرضه.

## المميزات الموجودة
الرئيسية، كمّل مشاهدة (بيحفظ مكان التوقف)، أفلام، مسلسلات (مواسم وحلقات)، بحث، قائمتي، مشغّل بتخطي ±10 ثواني وتشغيل الحلقة التالية تلقائياً، ولوحة إدارة كاملة.
