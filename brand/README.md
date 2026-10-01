# brand/

Static brand assets for **Adsum** (app icons, mark variations, and wordmarks).

*Adsum* is Latin for "I am present" — what a Roman student said when called during roll
call. The name, the "A" monogram and the tagline are one design.

> Formerly VeriPresenX, before that Attendify. The `veripresenx-*` files are kept on disk
> deliberately: they are the previous brand, not clutter, and the rebrand did not delete
> them.

## Two assets, exactly as designed

| File | Where it is used |
| --- | --- |
| `adsum-logo-full.png` | **Splash + navbar** — the full lockup: the "A" monogram, "Adsum", and "I am present". One image. |
| `adsum-logo-no-tag.png` | Held in `_master/` — the same lockup without the tagline, in case the navbar wants a cleaner line at small sizes |
| `mark-256-cutout.png`, `mark-64-cutout.png` | The monogram on transparency |

**The monogram is the icon.** `favicon-32.png`, `apple-touch-icon-180.png`, `icon-192.png`,
`icon-512.png` and `icon-maskable-512.png` are all the "A" monogram, never the full lockup —
an app tile has no room for a tagline, and the mark alone is what identifies the app at 32 px.

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
