# brand/

Static brand assets for **Adsum** (app icons, mark variations, and wordmarks).

*Adsum* is Latin for "I am present" — what a Roman student said when called during roll
call. The name, the "A" monogram and the tagline are one design.

> Formerly VeriPresenX, before that Attendify. Both previous brands' artwork has been
> deleted from this folder — only Adsum ships. The rename history itself is still
> recorded in the repo README and docs, because the `veripresenx_*` localStorage keys are
> load-bearing migration state and must not be "tidied away" (see
> [docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md) §5).

## Two assets, exactly as designed

| File | Where it is used |
| --- | --- |
| `adsum-logo-full.png` | **Splash + navbar** — the full lockup: the "A" monogram, "Adsum", and "I am present". One image. |
| `adsum-logo-no-tag.png` | Held in `_master/` — the same lockup without the tagline, in case the navbar wants a cleaner line at small sizes |
| `mark-256-cutout.png`, `mark-64-cutout.png` | The monogram on transparency |

**The monogram is the icon, and it is allowed to be loud.** `favicon-32.png`,
`apple-touch-icon-180.png`, `icon-192.png`, `icon-512.png` and
`icon-maskable-512.png` are all the "A" monogram, never the full lockup — an app
tile has no room for a wordmark, and at 32px the mark is the only thing that reads.

### Every installable icon is backgroundless

The four installable tiles used to sit on an opaque `#0B0D17` plate. On a phone
that plate is the *worst* part of the icon: launchers draw their own shape and
shadow behind it, so a dark square reads as a dark square inside their shape
rather than as the app. All four are now **true alpha** — the mark floats and the
platform supplies the background.

They are built from `mark-256-cutout.png` (real alpha), whose ink bounding box
measures **236×183 px inside a 256×256 canvas** — *not* square, because the
monogram's swash overshoots the cap height. Each tile scales by WIDTH from that
measured box and centres the result, rather than stretching a square crop, which
is what bent the swash the first time.

| File | Mark fills | Plate |
| --- | --- | --- |
| `favicon-32.png` | 96% | **none** (transparent) |
| `mark-64-cutout.png`, `mark-256-cutout.png` | 92% | **none** (transparent) |
| `icon-192.png`, `icon-512.png` | 86% | **none** (transparent) |
| `apple-touch-icon-180.png` | 88% | **none** (transparent) |
| `icon-maskable-512.png` | 60% (safe-zone constrained) | **none** (transparent) |
| `mark-256.png` | 92% | **none** — the centre logo of the projected QR |

> ⚠️ **Two of these are a deliberate trade-off, and they are the two that can
> look wrong on a real device.** `apple-touch-icon-180.png` is transparent
> because **iOS composites alpha to black**, so on an iPhone home screen this
> icon can render as a black square — the exact problem the plate existed to
> solve. `icon-maskable-512.png` is transparent because a maskable icon is
> *designed* to be masked into an arbitrary shape and normally needs a full-bleed
> plate to fill it. Both were made backgroundless on request. If either looks
> wrong in the wild, the revert is to re-composite it onto `#0B0D17` at the same
> measured scale — the artwork itself is untouched either way.

`mark-64.png` was deleted: zero references anywhere in the repo. `mark-256.png`
was **kept** despite sitting next to `mark-256-cutout.png` looking redundant — it
is loaded by `app.js` as the centre logo of the projected attendance QR
(`QR_LOGO_SRC`).

The tab icon is the one that must be backgroundless: a browser tab is already sitting on a
light or dark chrome, and an opaque plate just reads as a dark blob. The installable tiles
stay opaque for the opposite reason — iOS composites transparency to **black**, so a
transparent home-screen icon renders as a black square.

`index.html` declares the favicon at both 32 and 256 so a high-DPI browser picks the crisp
file instead of upscaling a 32px one.

### The logo is trimmed to its ink

`adsum-logo-full.png` is trimmed to its bounding box. The original export carried roughly a
quarter of the canvas as empty transparent margin above and below the artwork, so a CSS
`height` spent most of its box on nothing and the navbar logo looked tiny. Trimming changes
no visible pixel — it only makes the box match the drawing, so `height: 44px` in `style.css`
means 44px of actual logo.

### Do not split the lockup

An earlier revision rebuilt the wordmark from a crop of the text band and cut the name down
to `sum`, because the mark's violet stroke reads like a `d`. That was wrong twice over: it
broke the name, and it re-drew artwork that did not need re-drawing. The supplied file is
the logo. Use it whole.

The A in the lockup is the monogram, which is why the lockup cannot be split into
"mark + wordmark" without losing a letter — which is also why the navbar and the splash
both use the single full file.

## Two variants: SOLID and CUTOUT

For the old shield these had to differ, because its interior was opaque white and punching
that out changed how the badge read on the dark theme. **The Adsum mark has no white
interior** — it is one continuous gradient glyph — so the two renders are pixel-identical.
Both filenames are still produced so `index.html` and `sw.js` keep their existing paths and
the documented one-line flip still works; it just no longer changes anything visually.

## No `mix-blend-mode`

The previous wordmark was keyed from **black**, so `style.css` blended it with
`mix-blend-mode: screen` (and `multiply` on light) to hide a 1px fringe. The Adsum assets
are **true alpha**, and screening a bright cyan-to-violet gradient against the dark navbar
blew it out to white. Those rules were removed; normal alpha compositing is correct. Do not
add them back.

## Regenerating

`adsum-logo-full.png` is the supplied artwork with the navy plate removed — it is a
background knockout, **not** a redraw. No cropping, no recompositing, no resampling of one
letter against another.

**Knock out the plate by PEAK channel (`max(R,G,B)`), not luminance.** Measured on the
1280×763 source:

| peak | pixels | what it is |
| --- | --- | --- |
| 12–57 | ~700k | navy plate + radial glow → alpha 0 |
| 60–129 | ~6k | thin antialiased edge tail → partial alpha |
| 130–255 | 107,810 | solid mark → alpha 255 |

A ramp of `LO=62, HI=118` sits in the cliff: the edge stays soft, the interior solid.
Luminance cannot do this — the glow tail reaches L≈98 while the mark's deepest violet sits
at L≈88, so the two overlap and any luminance ramp either leaves a navy halo or erodes the
violet.

Source artwork (kept for regeneration, not shipped to browsers):
`WhatsApp Image 2026-09-29 at 11.39.37 PM (1).jpeg` is the full lockup, `(2).jpeg` is the
monogram alone.
