# Third-party notices

## ascii-sharks — MIT

- Source: https://github.com/stackedlol/ascii-sharks (commit `a0074c1`, which added the MIT license on 2026-10-24)
- Copyright (c) 2026 drewdi
- License text: [`src/scripts/creatures/LICENSE-ascii-sharks.md`](src/scripts/creatures/LICENSE-ascii-sharks.md)
- Adapted in `src/scripts/creatures/`:
  - `util.ts`: math helpers
  - `shapes.ts`: the eight shark body plans and the tiger and zebra markings
  - `creatures.ts`: spine steering and motion
  - `raster.ts`: supersampled character rasterisation, shading and glyph ramps

Each adapted file has a header listing what was changed.

## character-ocean — MIT (front-end files only)

- Source: https://github.com/jiezi1234/character-ocean
- Copyright (c) 2026 jiezi1234
- Used: the default "mixed" creature line-up from `src/app.ts`, which is MIT-licensed. It is reproduced as `DEFAULT_LINEUP` in `src/scripts/creatures/shapes.ts`.
- Not used: that repository's modified animation files (`engine.ts`, `world.ts`, `renderer.ts`, `species.ts`, `math.ts`), because they carry no license grant. That includes its manta ray, whale shark and sunfish code. The whale shark, manta ray and ocean sunfish body plans in this project are original work, written without that code.

## Fonts

Inter and JetBrains Mono are loaded from Google Fonts under the SIL Open Font License 1.1. No font files are bundled.
