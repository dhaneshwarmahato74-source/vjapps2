# DK EDITS VJ PLAYER – Desktop App (Mac + Windows)

## Ye app kya karti hai
- Sirf ek URL kholti hai (`app.config.json` → `appUrl`). Browser jaisa address bar/tabs nahi.
- Output window khud extended screen pe full-stretch fullscreen khulti hai. Mirror ho to Mac/Windows pe khud Extend karti hai.
- Screen/laptop sleep nahi hota jab tak app khuli hai.
- **Sab kuch offline chalta hai (pehli baar internet chahiye):** website ka latest version, Appwrite ki video list, Bunny ke saare videos apne computer pe save ho jaate hain.
  Website update karoge to app online hote hi naya version save kar leti hai aur offline pe wahi naya version chalta hai (purana nahi).
- Expiry: `expiresOn` ke baad app me sirf **Uninstall** screen. Menu → Help → Uninstall hamesha hai.

## app.config.json
| key | matlab |
|---|---|
| mode | `auto` (online agar mile, nahi to offline copy), `online`, `local` |
| appUrl | website URL |
| statusUrl | optional `app-status.json` (remote band karne ke liye: `"enabled": false`) |
| expiresOn | `2026-11-15` = 15 Nov raat tak chalegi, 16 Nov se band |
| cacheVideos / videoCacheMaxMB | video cache on/off aur limit (MB) |
| autoOpenOutput | output khud khule |

## Installer banana (GitHub)
1. Is folder ki saari files private GitHub repo me daalo. `.github` hidden hota hai: repo me *Add file → Create new file* → naam `.github/workflows/build.yml` → `WORKFLOW-build.yml.txt` ka text paste.
2. Actions → Build installers → Run workflow. Artifacts me `.exe` (Windows) aur `.dmg` (Mac).

## Pehli baar setup (client ke computer pe)
1. Internet ke saath app kholo, 5–10 min chhodo.
2. Menu View → *Saved videos (video cache)…* me videos ki ginti dekho.
3. Uske baad internet ke bina bhi chalega. Naya video jodne par ek baar internet ke saath kholna.

## Mac/Windows notes
- Mac: pehli baar right-click → Open. "damaged" aaye to `xattr -cr "/Applications/DK EDITS VJ PLAYER.app"`.
- Windows: SmartScreen → More info → Run anyway.
- Mac: System Settings → Displays me Mirror ho to app khud Extend kar deti hai; Windows: DisplaySwitch /extend.

## Website (player/web) aur Appwrite
`player/web/js/appwrite-config.js` me Appwrite ke project / database / table ID bharo. Steps: `player/docs` ya mujhse.
