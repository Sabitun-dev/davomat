// DejaVu Sans for PDFs: it has Latin, Uzbek and Cyrillic letters.
// On Netlify the font files are shipped next to the function (netlify.toml: included_files).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const cache = new Map<string, Uint8Array>();

export function loadFont(bold = false): Uint8Array {
  const file = bold ? "DejaVuSans-Bold.ttf" : "DejaVuSans.ttf";
  const hit = cache.get(file);
  if (hit) return hit;
  const rel = join("node_modules", "dejavu-fonts-ttf", "ttf", file);
  const roots = [process.cwd(), process.env.LAMBDA_TASK_ROOT, "/var/task"].filter(Boolean) as string[];
  for (const root of roots) {
    const path = join(root, rel);
    if (existsSync(path)) {
      const bytes = new Uint8Array(readFileSync(path));
      cache.set(file, bytes);
      return bytes;
    }
  }
  throw new Error(`Font ${file} not found`);
}
