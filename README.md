# 1P Island Run

Webová 3D voxel hra ve stylu Minecraftu: procedurálně generovaný tropický
ostrov, roztomilá zvířata a závod o nejrychlejší doběhnutí k zářícímu bloku
s logem 1P. Bez backendu — jedna statická stránka (Vite + Three.js).

## Spuštění

```bash
npm install
npm run dev        # dev server (http://<server-ip>:5180)
npm run build      # produkční build do dist/
npm run preview    # náhled produkčního buildu (port 5180)
```

## Ovládání

| Zařízení | Pohyb | Rozhled | Skok |
|---|---|---|---|
| Desktop | WASD / šipky | myš (Pointer Lock) | mezerník |
| Mobil | virtuální joystick (levá půlka) | tažení prstem (pravá půlka) | tlačítko SKOK |

Cíl: co nejrychleji doběhnout k zářícímu bloku 1P (sloup světla je vidět
z dálky). Čas se měří od startu, nejlepší čas se ukládá do `localStorage`.
„Hrát znovu" vygeneruje nový ostrov (nový seed) i novou pozici cíle.

## Výměna textur zvířat a loga

Vše je v `public/assets/` — **stačí přepsat soubory, kód se nemění**:

```
public/assets/1p-logo.png                 # logo na cílovém bloku
public/assets/animals/<druh>/head.jpg     # obličej (přední stěna hlavy)
public/assets/animals/<druh>/body.jpg     # srst (tělo, nohy, uši)
public/assets/animals/<druh>/side.jpg     # boky těla + zbytek hlavy
```

Druhy (názvy složek bez diakritiky): `kapybara`, `morce`, `krecek`,
`quokka`, `cincila`.

Doporučený formát: JPG, ideálně čtvercový ořez ~512×512 px. Pokud soubor
chybí nebo se nenačte, hra automaticky použije barevný gradient placeholder
se jménem druhu.

> **Poznámka k současným fotkám:** jde o placeholder fotky stažené
> z Wikimedia Commons (svobodné licence, viz `scripts/fetch_animal_photos.py`).
> Před ostrým veřejným nasazením je nahraďte vlastními fotografiemi.

Placeholder logo lze znovu vygenerovat: `python3 scripts/generate_logo.py`.

## Deploy na Vercel

Projekt je deploy-ready jako statický build:

1. Import repozitáře do Vercelu
2. Framework preset: **Vite** (detekuje se automaticky)
3. Build command: `npm run build`, output: `dist/`

Žádné env proměnné ani serverové funkce nejsou potřeba.

## Technika

- **Three.js** — renderer s ACESFilmic tone mappingem, PCFSoft stíny,
  EffectComposer (UnrealBloom + SMAA), pixel ratio cap 2
- **Terén** — 64×64 voxel ostrov ze simplex noise, jedna merged geometrie
  s per-vertex ambient occlusion (Minecraft look), procedurální texture atlas
- **Voda** — vlastní shader: vlnění, fresnel odraz oblohy, světlejší mělčina,
  animovaná pěna na hraně pláže
- **Zvířata** — voxel boxy s fotografickými texturami, wander AI
  (chůze/pauza/otočka, respektují terén a vodu), poskočení při přiblížení
- **Struktura** — `src/world.js`, `player.js`, `controls.js`, `animals.js`,
  `goal.js`, `ui.js`, `particles.js`, `main.js`

Cílový výkon: 60 FPS na iPhone 13 Pro a novějších (minimum 30 FPS).
