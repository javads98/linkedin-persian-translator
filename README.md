<div dir="rtl" align="right">

# 🇮🇷 مترجم فارسی لینکدین

### افزونه گوگل کروم برای ترجمه کامل صفحات لینکدین به فارسی

<div align="center">

![Chrome](https://img.shields.io/badge/Google%20Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![LinkedIn](https://img.shields.io/badge/LinkedIn-Translator-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)
![Persian](https://img.shields.io/badge/زبان-فارسی-green?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

</div>

---

## ❓ مشکل چیه؟

ابزارهای ترجمه معمولی (مثل Google Translate یا افزونه‌های مرورگر) روی لینکدین **درست کار نمی‌کنن** چون:

- 🔄 لینکدین از **React/Ember.js** استفاده می‌کنه و محتوا به صورت داینامیک رندر میشه
- 📜 با **Lazy Loading** محتوا فقط وقتی اسکرول کنید بارگذاری میشه
- 🌀 **Virtual DOM** باعث میشه متن‌ها مستقیماً در HTML قابل دسترسی نباشن

## ✅ راه‌حل

این افزونه با تکنیک‌های پیشرفته، تمام این مشکلات رو حل می‌کنه و **تمام متن‌های لینکدین** رو به فارسی ترجمه می‌کنه.

---

## ✨ ویژگی‌ها

| ویژگی | توضیحات |
|---|---|
| 📄 **ترجمه کامل صفحه** | پست‌ها، کامنت‌ها، پروفایل‌ها، شرح شغل‌ها و پیام‌ها |
| 🔄 **محتوای داینامیک** | تشخیص و ترجمه خودکار محتوای جدید هنگام اسکرول |
| 🌍 **همه زبان‌ها** | ترجمه از هر زبانی به فارسی |
| 🔘 **دکمه شناور** | دکمه همیشه در دسترس روی صفحه |
| ↩️ **قابلیت بازگشت** | برگرداندن متن‌ها به زبان اصلی با یک کلیک |
| 💾 **کش هوشمند** | ذخیره ترجمه‌ها برای سرعت بیشتر |
| ⚙️ **دو موتور ترجمه** | Google Translate و MyMemory |
| 🤖 **ترجمه خودکار** | ترجمه خودکار هنگام ورود به لینکدین |

---

## 📥 نصب

### روش ۱ — نصب دستی (Developer Mode)

<div dir="ltr" align="left">

```
1. Clone or download this repository
2. Open chrome://extensions/
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the extension folder
```

</div>

**به فارسی:**

1. **این ریپو رو دانلود کنید** (دکمه سبز Code > Download ZIP)
2. فایل ZIP رو از حالت فشرده خارج کنید
3. در کروم آدرس `chrome://extensions/` رو باز کنید
4. در گوشه بالا سمت راست **Developer mode** رو فعال کنید
5. روی **Load unpacked** کلیک کنید
6. پوشه افزونه رو انتخاب کنید
7. ✅ تمام!

---

## 🚀 نحوه استفاده

### دکمه شناور
بعد از نصب، یک دکمه آبی **«ترجمه»** در گوشه پایین-چپ صفحات لینکدین ظاهر میشه. روش کلیک کنید.

### از طریق Popup
روی آیکون افزونه در نوار ابزار کروم کلیک کنید و دکمه **«ترجمه صفحه به فارسی»** رو بزنید.

### بازگشت به زبان اصلی
دکمه **«بازگشت»** رو بزنید تا متن‌ها به حالت اول برگردن.

---

## ⚙️ تنظیمات

| تنظیم | توضیح |
|---|---|
| **ترجمه خودکار** | فعال کنید تا هر بار که وارد لینکدین شدید، صفحه خودکار ترجمه بشه |
| **موتور ترجمه** | بین Google Translate (پیشنهادی) و MyMemory انتخاب کنید |

---

## 📂 ساختار پروژه

<div dir="ltr" align="left">

```
linkedin-persian-translator/
├── manifest.json          # Extension manifest (V3)
├── background.js          # Service worker - translation API & cache
├── content.js             # Content script - DOM scanning & translation
├── popup.html             # Popup UI
├── popup.js               # Popup logic
├── styles/
│   └── content.css        # Floating button & translated text styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

</div>

---

## 🛠️ تکنولوژی‌ها

- **Manifest V3** — جدیدترین استاندارد افزونه‌های کروم
- **MutationObserver** — تشخیص تغییرات DOM در لحظه
- **Google Translate API** — موتور ترجمه اصلی
- **Chrome Storage API** — ذخیره تنظیمات

---

## 📄 مجوز

این پروژه تحت مجوز **MIT** منتشر شده است. آزادانه استفاده کنید!

---

<div align="center">

**ساخته شده با ❤️ برای کاربران فارسی‌زبان لینکدین**

⭐ اگه این افزونه بدردتون خورد، یه ستاره بدید!

</div>

</div>
