Google Maps and Niantic games (like Pokémon GO, Ingress, and Monster Hunter Now) don’t see the world as a smooth, continuous sphere. Instead, they divide the Earth into grid squares using a mathematical system called **S2 Cells**.

Here is a breakdown of how S2 cells work and exactly how they dictate the gameplay in Pokémon GO.

---

## What Are S2 Cells?

Developed by Google, the S2 geometry library projects the 3D sphere of the Earth onto the six faces of a cube, and then subdivides those faces into a hierarchical grid.

### Key Characteristics:

- **Levels (0 to 30):** The grid system has levels ranging from Level 0 (six massive cells covering the entire planet) down to Level 30 (cells measuring just a few square millimeters).
- **The 4-to-1 Rule:** Every time you go down one level, a single cell is cleanly divided into **four smaller cells**. For example, one Level 13 cell contains exactly four Level 14 cells.
- **No Distortion At the Poles:** Unlike traditional flat maps (like Mercator projections) that distort sizes near the poles, S2 cells maintain relatively consistent geographic areas anywhere on Earth.

---

## Which S2 Cell Levels Matter for Pokémon GO?

Niantic uses different cell levels as the "invisible boundaries" for almost every mechanic in the game, from where Pokémon appear to how gyms are created.

### 1. Level 10: Catch Card Regions & Weather

- **Size:** Roughly $10\text{ km} \times 10\text{ km}$ to $20\text{ km} \times 20\text{ km}$ depending on latitude.
- **In-Game Use:** \* **Weather:** The hourly in-game weather is pulled from real-world forecasts based on Level 10 cells. If you cross a Level 10 boundary, the weather can instantly change.
- **Catch Locations:** The text at the bottom of a caught Pokémon showing the city/region is tied to Level 10 boundaries.

### 2. Level 13: EX Raids & Elite Raids

- **Size:** Roughly $1.2\text{ km} \times 1.2\text{ km}$.
- **In-Game Use:** Historically used to calculate EX Raid eligibility, Niantic still uses Level 13 cells to manage scheduling and blockouts for major global/local live events and specialized raid distributions to ensure a fair spread across a region.

### 3. Level 14: Gym Creation & Density

- **Size:** Roughly $2.5\text{ km}^2$.
- **In-Game Use:** This is one of the most critical levels for map creators. The number of PokéStops/Gyms within a single Level 14 cell determines how many of those points of interest (POIs) transform into Gyms:
- **1–2 POIs:** 1 Gym
- **6–19 POIs:** 2 Gyms
- **20+ POIs:** 3 Gyms

### 4. Level 17: PokéStop Inclusion (The "One Stop" Rule)

- **Size:** Roughly $70\text{ m} \times 70\text{ m}$.
- **In-Game Use:** This is the golden rule of Niantic Wayfarer submissions. **Only one PokéStop or Gym can exist per Level 17 cell.** If a player nominates a new stop and it gets approved, but it sits in a Level 17 cell that already contains a PokéStop, it will _not_ appear in Pokémon GO (though it might appear in Ingress or Monster Hunter Now, which use different cell level restrictions).

### 5. Level 20: Wild Pokémon Spawns & Precise Locations

- **Size:** Roughly $3\text{ m} \times 3\text{ m}$.
- **In-Game Use:** \* **Spawn Points:** Individual wild Pokémon spawns are anchored to specific Level 20 cells.
- **Interactions:** The exact coordinate of a PokéStop interaction ring is checked at this microscopic level.

---

## Summary Reference Table

| S2 Cell Level | Approx. Edge Length | Primary Pokémon GO Function                              |
| ------------- | ------------------- | -------------------------------------------------------- |
| **Level 10**  | ~15 km              | In-game weather zones, Catch location text               |
| **Level 13**  | ~1.2 km             | Event boundaries, Elite Raid distribution                |
| **Level 14**  | ~450 m              | Gym density logic (determines _which_ stops become gyms) |
| **Level 17**  | ~70 m               | PokéStop visibility limit (Max 1 POI per cell)           |
| **Level 20**  | ~3 m                | Individual spawn point placement                         |

If you are planning to submit new wayspots or trying to optimize your local community's map, mapping tools like **IITC** (with Pokémon GO plugins) or online S2 cell visualizers are heavily utilized by the community to look at Level 14 and Level 17 grids explicitly.
