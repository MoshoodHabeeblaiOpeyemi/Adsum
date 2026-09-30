# brand/

Static brand assets for **Adsum** (app icons, mark variations, and wordmarks).

*Adsum* is Latin for "I am present" — what a Roman student said when called during roll
call. The name, the "A" monogram and the tagline are one design.

> Formerly VeriPresenX, before that Attendify. The `veripresenx-*` files are kept on disk
> deliberately: they are the previous brand, not clutter, and the rebrand did not delete
> them.

## The mark IS the first letter

This is the thing to know before editing anything here. The gradient **"A" monogram is
the A of "Adsum"** — the lockup is the mark ligated with the letters `dsum`, not a mark
sitting beside a separate `Adsum`.

Measuring the supplied artwork confirms it: cutting the lockup's text band at the
mark/word boundary (x=658) yields exactly `sum`. Cutting earlier looks like `dsum` only
because the mark's violet stroke reads as a `d` at a glance. So there is no separate
letter "A" in the wordmark to recover.

## Files

| File | Size | Where it is used |
| --- | --- | --- |
| `adsum-wordmark.png` | 1331×512 | **Navbar** (`.brand-wordmark`) — mark + `dsum`, no tagline |
| `adsum-text.png` | 517×235 | **Splash wordmark** (`.splash-wordmark`) — `Adsum` over "I am present", NO mark |
| `adsum-monogram.png` | 373×290 | **Splash logo** (`.splash-logo`), and the source for every mark/icon below |
| `adsum-logo-full.png` | 983×361 | The complete logo — mark + `Adsum` + tagline. Docs, social, print |
| `mark-256-cutout.png` | 256² | The mark on transparency |
| `mark-64-cutout.png`, `mark-256.png`, `mark-64.png` | 64², 256² | The same mark at other sizes |
| `favicon-32.png` | 32² | Browser tab (`<link rel="icon">`) |
| `apple-touch-icon-180.png` | 180² | iOS home screen. Opaque, because iOS composites transparency to black |
| `icon-192.png`, `icon-512.png` | 192², 512² | PWA install, `"purpose": "any"` |
| `icon-maskable-512.png` | 512² | PWA install, `"purpose": "maskable"` — mark at 58% so it survives the safe-zone crop |
| `adsum-mark-1024.png`, `adsum-mark-cutout-1024.png` | 1024² | Archival mark |

### Why the splash uses two files

`.splash-logo` is the monogram and `.splash-wordmark` is `adsum-text.png`. Pointing the
wordmark at the full lockup instead would print the A twice — once as the splash logo and
again inside the wordmark. The navbar, which has no separate mark slot, uses the combined
`adsum-wordmark.png`.

## Two variants: SOLID and CUTOUT

For the old shield these had to differ, because its interior was opaque white and punching
that out changed how the badge read on the dark theme. **The Adsum mark has no white
interior** — it is one continuous gradient glyph — so the two renders are pixel-identical.
Both filenames are still produced so `index.html` and `sw.js` keep their existing paths and
the flip below still works; it just no longer changes anything visually.

## No `mix-blend-mode`

The previous wordmark was keyed from **black**, so `style.css` blended it with
`mix-blend-mode: screen` (and `multiply` on light) to hide a 1px fringe. The Adsum assets
are **true alpha**, and screening a bright cyan-to-violet gradient against the dark navbar
blew it out to white. Those rules were removed; normal alpha compositing is correct. Do not
add them back.

## Regenerating

The cutouts are produced from the supplied artwork by thresholding the navy plate away.
**Use peak channel (`max(R,G,B)`), not luminance.** Measured on the 1280×763 source:

| peak | pixels | what it is |
| --- | --- | --- |
| 12–57 | ~700k | navy plate + radial glow → alpha 0 |
| 60–129 | ~6k | thin antialiased edge tail → partial alpha |
| 130–255 | 107,810 | solid mark → alpha 255 |

So a ramp of `LO=62, HI=118` sits in the cliff and leaves the edge soft but the interior
solid. Luminance cannot do this: the glow tail reaches L≈98 while the mark's deepest violet
sits at L≈88, so a luminance ramp either leaves a navy halo or erodes the violet — which is
exactly what the first attempt did.

Scaling must set `ImageAttributes.WrapMode = TileFlipXY`, or the resampler reads
transparent-black from outside the source rect and bakes a dark fringe into every edge.

The extracted masters live in `_master/` (`mark-src`, `word-src`, `tagline-src`) so the
build can be re-run without the original JPEGs.
