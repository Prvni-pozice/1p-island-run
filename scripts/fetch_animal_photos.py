#!/usr/bin/env python3
"""Stáhne placeholder fotky zvířat z Wikipedie (media-list REST API) do
/public/assets/animals/{nazev}/head.jpg, body.jpg, side.jpg.
Čistá stdlib. Fotky jsou z Wikimedia Commons (svobodné licence) — pro
produkci nahradit vlastními fotkami (stačí přepsat soubory)."""
import json, pathlib, time, urllib.request, urllib.error

ANIMALS = {
    'kapybara': 'Capybara',
    'morce': 'Guinea_pig',
    'krecek': 'Golden_hamster',
    'quokka': 'Quokka',
    'cincila': 'Chinchilla',
}
SKIP_WORDS = ('map', 'range', 'locator', 'logo', 'diagram', 'skull', 'skeleton',
              'distribution', 'painting', 'children', 'stamp', 'statue', 'roast',
              'meat', 'dish', 'cuy', 'anatomy')
HEADERS = {'User-Agent': '1p-island-run-placeholder-fetch/1.0 (internal dev tool)'}

base = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'animals'

def get(url, tries=5):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            time.sleep(1.2)  # šetrné tempo — Wikimedia rate limit
            return data
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < tries - 1:
                wait = 5 * (attempt + 1)
                print(f'   429 — čekám {wait}s…')
                time.sleep(wait)
                continue
            raise

for folder, article in ANIMALS.items():
    data = json.loads(get(f'https://en.wikipedia.org/api/rest_v1/page/media-list/{article}'))
    urls = []
    for item in data.get('items', []):
        if item.get('type') != 'image':
            continue
        title = item.get('title', '').lower()
        if not (title.endswith('.jpg') or title.endswith('.jpeg')):
            continue
        if any(w in title for w in SKIP_WORDS):
            continue
        srcset = item.get('srcset') or []
        if not srcset:
            continue
        src = srcset[0]['src']  # 1× thumb (~320 px) stačí na texturu boxu
        if src.startswith('//'):
            src = 'https:' + src
        urls.append(src)
        if len(urls) >= 3:
            break

    if not urls:
        print(f'!! {folder}: žádné fotky nenalezeny, přeskakuji')
        continue

    while len(urls) < 3:
        urls.append(urls[0])

    outdir = base / folder
    outdir.mkdir(parents=True, exist_ok=True)
    for name, url in zip(('head.jpg', 'body.jpg', 'side.jpg'), urls):
        try:
            blob = get(url)
            (outdir / name).write_bytes(blob)
            print(f'OK {folder}/{name}  ({len(blob)//1024} kB)  {url.split("/")[-1][:60]}')
        except Exception as e:
            print(f'!! {folder}/{name}: {e}')
