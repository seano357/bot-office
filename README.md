# Bot Office

A private, self-hosted copy of the 3D "office" dashboard from
[bodila51/grokbot-wallpaper](https://github.com/bodila51/grokbot-wallpaper) by 0xCodila
(an independent project, not affiliated with the makers of Grok Bot). All credit for the design, code and 3D assets goes
to the original author. The upstream repository had no license file when this copy was made (Nov 2, 2026, upstream
commit 76232f7); this copy is for personal use and will be taken down on request.

## What changed from upstream

- The page reads bot status **only from https://ntfy.sh**. The second mailbox (`relay.0xcodila.com`, WebSocket) is removed,
  and links can no longer point the page at another host (`#topic@host`, `?feed=`, `&ntfy=` are ignored).
- The anonymous visit counter (`POST relay.0xcodila.com/_beacon` on open and on leave) is removed.
- three.js 0.170.0 (MIT) is vendored in `office/vendor/three/` instead of loading from cdn.jsdelivr.net.
- Inter and Nunito (SIL OFL 1.1, via @fontsource) are self-hosted in `office/vendor/fonts/` instead of Google Fonts.
- Open Graph / Twitter preview tags pointing at the upstream site are removed.
- A Content-Security-Policy limits the page to this site and `https://ntfy.sh`.
- Only the office page and its assets are included (no landing page, wallpaper, relay, server or apps).

## Use

Open `https://<user>.github.io/bot-office/office/#<topic>`. The topic is the password: it lives only in the link's hash
(never sent to GitHub) and is **not** stored in this repository. Bots post JSON lines with
`curl -s -d '<json>' https://ntfy.sh/<topic>` (formats listed at the top of `office/feed.js`).
