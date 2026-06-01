# Wayfarer S2 Grid — Chrome Extension

Overlay **S2 cell grids** on the [Niantic Wayfarer map](https://wayfarer.nianticlabs.com/new/mapview) to plan waypoint submissions that follow Pokémon GO cell rules.

## What it shows

| Level | Approx. size | Use |
| ----- | ------------- | --- |
| **14** | ~450 m edge | Gym density (how many stops become gyms in a cell) |
| **17** | ~70 m edge | **One PokéStop/Gym per cell** in Pokémon GO |

The extension also **shades Level 17 cells red** when they already contain an active in-game PokéStop or Gym (blocked for Pokémon GO).

Grid visibility follows the same zoom heuristic as community IITC tools: a level is drawn when `6 ≤ level < mapZoom + 2`.

## Install (developer mode)

1. Open Chrome → **Extensions** → **Manage extensions**
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder in this repository

## Usage

1. Sign in to [Wayfarer](https://wayfarer.nianticlabs.com/) and open **Map** (`/new/mapview`)
2. Pan and zoom — the grid redraws on map idle
3. Use the floating **S2 Grid** panel (bottom-left, above the map legend) or the extension popup to toggle levels

## Files

```
extension/
├── manifest.json
├── background.js
├── lib/s2-geometry.js      # S2 cell math (from community pogo-s2 / IITC)
├── content/
│   ├── overlay.js          # Map hook + drawing (page context)
│   ├── bridge.js           # Settings sync (extension context)
│   └── overlay.css
├── popup/
└── icons/
```

## Disclaimer

This is a **community tool**, not affiliated with Niantic. S2 rules are inferred from player research; always verify nominations against in-game results. Use at your own discretion on Wayfarer.

## Credits

S2 geometry adapted from [pogo-s2](https://gitlab.com/NvlblNm/pogo-s2) / IITC regions plugin.
