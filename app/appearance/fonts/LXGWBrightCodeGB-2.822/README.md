# LXGW Bright Code GB 2.822

SkyNote bundles the Regular and Italic fonts used by the local Cursor editor as WOFF2 web fonts. The original glyphs, character coverage, names and metrics are preserved; only the container format is compressed. These files are application web fonts, not system font installers.

Upstream: https://github.com/lxgw/LxgwBright-Code

License and the upstream additional permission for web font conversion: `OFL.txt`.

`SOURCE.json` records the original TTF and bundled WOFF2 SHA-256 values and sizes. To reproduce the conversion with FontTools and Brotli, load the matching original TTF with `TTFont`, set `font.flavor = "woff2"`, then save it. No subsetting is applied.

The UI uses a CJK Unicode range so English interface text keeps the macOS system font. Note text and code prefer Courier New for Latin characters and this font for Chinese characters, matching the Cursor font stack. Courier New is supplied by macOS and is not redistributed.
