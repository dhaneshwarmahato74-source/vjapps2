# DK EDITS VJ PLAYER – Desktop App (Windows + Mac)

Yeh app aapki website (ek fixed URL) ko apni window me kholti hai – address bar nahi, tabs nahi, browser nahi.

## Kya karta hai
- **Sirf ek URL** khulta hai (`app.config.json` → `appUrl`). Dusri site pe navigate nahi ho sakta.
- **Output window apne aap extended screen pe fullscreen** khulti hai (Windows + Mac). Controller laptop pe rehta hai.
- Browser jaisa background throttling nahi – window peeche ho ya dusri screen pe ho, video/strobe chalta rehta hai. Screen sleep band.
- **Uninstall option**: menu → Help → *Uninstall…* (Windows: Settings → Apps me bhi dikhta hai).
- **Kill-switch**: URL hata do / `app-status.json` me `"enabled": false` kar do / `expiresOn` date nikal jaye →
  app me sirf ek screen dikhti hai jisme **Uninstall** button hai (player nahi chalta).

## Step 1 – Website upload
`player/web/` folder ke andar ki saari files apni site pe daalo (jaise `https://yoursite.com/vj/`). **HTTPS zaroori hai** (mic + extended-screen permission ke liye).
Kill-switch chahiye to `site-extra/app-status.json` ko usi folder me rakho (`https://yoursite.com/vj/app-status.json`).
- Band karna: `"enabled": false`  |  Auto expiry: `"expiresOn": "2026-12-31"`

## Step 2 – URL set karo
`app.config.json`:
```json
{ "mode": "online", "appUrl": "https://yoursite.com/vj/", "statusUrl": "https://yoursite.com/vj/app-status.json", "expiresOn": "" }
```

## Step 3 – Installer banao
**Option A – GitHub (aasaan, Mac + Windows dono):** is folder ko ek private GitHub repo me push karo → Actions → *Build installers* → Run workflow.
Artifacts me `.exe` (Windows) aur `.dmg` (Mac) milenge.

**Option B – apne computer pe:** Node.js 20+ install karo, phir
```
npm install
npm run dist:win     # Windows pe  -> dist/*.exe
npm run dist:mac     # Mac pe      -> dist/*.dmg
```
Test ke liye bina install: `npm start`.

## Client ko dene ke notes
- **Mac:** app signed nahi hai (Apple developer account chahiye, $99/yr). Pehli baar *right-click → Open* karna padega. Agar "damaged" bole: Terminal me `xattr -cr "/Applications/DK EDITS VJ PLAYER.app"`.
- **Windows:** SmartScreen "Unknown publisher" dikha sakta hai → *More info → Run anyway*.
- Mac pe pehli baar microphone permission pooochega (Audio-reactive mode ke liye).

## ⚠ Art-Net / Tiger Touch
Hosted website browser me chalti hai, aur browser UDP (Art-Net) receive **nahi** kar sakta. Online mode me **Manual + Audio mode chalenge, Tiger Touch sync nahi**.
Agar client ko Tiger Touch chahiye: `app.config.json` me `"mode": "local"` karo – tab app ke andar bundled bridge chalta hai (offline, Art-Net kaam karega, `player/` folder ka version use hota hai, website update se nahi badlega – naye version ke liye `player/web` replace karke dobara build).

## Dusri settings
`autoOpenOutput` (true/false), `controllerFullscreen`, `statusCheckMinutes`, `localPort`.
Shortcut: **Ctrl/Cmd+Shift+O** = output dobara extended screen pe kholo, **Ctrl/Cmd+R** = reload.
