#!/usr/bin/env python3
"""Vygeneruje placeholder /public/assets/1p-logo.png (blokové „1P").
Čistá stdlib (zlib + struct), žádné závislosti."""
import struct, zlib, pathlib

W = H = 256
BG = (18, 34, 78, 255)
FG = (255, 255, 255, 255)
ACCENT = (255, 179, 71, 255)

GLYPHS = {
    '1': ["..X..", ".XX..", "..X..", "..X..", "..X..", "..X..", ".XXX."],
    'P': ["XXXX.", "X...X", "X...X", "XXXX.", "X....", "X....", "X...."],
}

px = [[BG] * W for _ in range(H)]

text = "1P"
cell = 18
total_w = (len(text) * 5 + (len(text) - 1)) * cell
x0 = (W - total_w) // 2
y0 = (H - 7 * cell) // 2 - 14

for gi, ch in enumerate(text):
    glyph = GLYPHS[ch]
    gx = x0 + gi * 6 * cell
    for row, line in enumerate(glyph):
        for col, c in enumerate(line):
            if c == 'X':
                for dy in range(cell):
                    for dx in range(cell):
                        px[y0 + row * cell + dy][gx + col * cell + dx] = FG

# oranžový podtržník
uy = y0 + 7 * cell + 16
for dy in range(10):
    for dx in range(total_w):
        px[uy + dy][x0 + dx] = ACCENT

raw = b''.join(b'\x00' + b''.join(struct.pack('4B', *p) for p in row) for row in px)

def chunk(tag, data):
    c = struct.pack('>I', len(data)) + tag + data
    return c + struct.pack('>I', zlib.crc32(tag + data))

png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw, 9))
       + chunk(b'IEND', b''))

out = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'assets' / '1p-logo.png'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(png)
print(f"OK: {out} ({len(png)} B)")
