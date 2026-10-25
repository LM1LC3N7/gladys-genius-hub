// Generates cover.png (800x534) for gladys-genius-hub: plain Node, no dependency.
// A radiator with its wireless valve, a room thermostat dial and a small hub
// box with its network port, on a warm gradient (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
const skyAt = (x, y) => {
  const t = (x / W) * 0.6 + (y / H) * 0.4;
  return [230 - 120 * t, 120 - 50 * t, 70 + 40 * t];
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    set(x, y, skyAt(x, y));
  }
}
const white = [255, 255, 255];
const dark = [40, 34, 52];
const warm = [255, 170, 60];
const green = [90, 210, 130];
const grey = [200, 204, 212];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};

disc(400, 267, 280, white, 0.05);

// The radiator: a frame and its fins, the valve at its left end.
box(150, 180, 520, 420, 14, white);
for (let k = 0; k < 9; k += 1) {
  box(170 + k * 39, 200, 196 + k * 39, 400, 6, grey);
}
line(150, 440, 520, 440, 6, dark);
line(170, 420, 170, 450, 6, dark);
line(500, 420, 500, 450, 6, dark);
// The wireless valve: a cylinder with its display and a warm glow.
box(80, 270, 160, 330, 12, white);
box(92, 282, 136, 318, 6, dark);
disc(114, 300, 9, warm);
line(160, 300, 150, 300, 10, grey);

// The room thermostat: a dial with its needle and the setpoint arc.
disc(650, 200, 90, white);
disc(650, 200, 74, dark);
for (let a = -140; a <= 140; a += 10) {
  const rad = ((a - 90) * Math.PI) / 180;
  const color = a < 40 ? warm : grey;
  disc(650 + 58 * Math.cos(rad), 200 + 58 * Math.sin(rad), 3, color);
}
line(
  650,
  200,
  650 + 48 * Math.cos((-50 * Math.PI) / 180),
  200 + 48 * Math.sin((-50 * Math.PI) / 180),
  5,
  white,
);
disc(650, 200, 8, white);

// The hub: a box with its network port and two status lights.
box(560, 340, 740, 460, 16, white);
box(585, 410, 640, 445, 4, dark);
disc(690, 375, 8, green);
disc(715, 375, 8, warm);
// The radio link from the hub to the valve and the thermostat.
for (let k = 1; k <= 3; k += 1) {
  const r = 24 * k;
  for (let a = 150; a <= 210; a += 2) {
    const rad = (a * Math.PI) / 180;
    disc(560 + r * Math.cos(rad), 400 + r * Math.sin(rad), 2.5, white, 0.8);
  }
}

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
