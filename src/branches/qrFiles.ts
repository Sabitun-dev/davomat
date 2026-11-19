// QR files for a branch: PNG and an A4 poster PDF with a short Uzbek instruction.

import QRCode from "qrcode";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { miniAppLink } from "../lib/appConfig.ts";
import { env } from "../lib/env.ts";
import { loadFont } from "../lib/fonts.ts";
import { t } from "../i18n/index.ts";
import { staticToken } from "../attendance/qr.ts";

export async function branchQrText(branch: { id: number; qrVersion: number }): Promise<string> {
  return miniAppLink(staticToken(env.qrSecret, branch.id, branch.qrVersion));
}

export async function qrPng(text: string, width = 1024): Promise<Uint8Array> {
  const buf = await QRCode.toBuffer(text, { type: "png", width, margin: 2, errorCorrectionLevel: "M" });
  return new Uint8Array(buf);
}

export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
}

/** Safe file name from a branch name. */
export function fileSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40) || "branch"
  );
}

export async function posterPdf(branch: { name: string; address: string }, qrText: string): Promise<Uint8Array> {
  const lang = "uz";
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(loadFont(false), { subset: true });
  const bold = await pdf.embedFont(loadFont(true), { subset: true });
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const accent = rgb(0x6d / 255, 0x4a / 255, 1);
  const ink = rgb(0.09, 0.09, 0.11);
  const grey = rgb(0.42, 0.41, 0.48);

  const centered = (text: string, y: number, size: number, font = regular, color = ink) => {
    let s = size;
    while (font.widthOfTextAtSize(text, s) > width - 80 && s > 10) s -= 1;
    page.drawText(text, { x: (width - font.widthOfTextAtSize(text, s)) / 2, y, size: s, font, color });
  };

  page.drawRectangle({ x: 0, y: height - 150, width, height: 150, color: accent });
  centered(branch.name, height - 82, 34, bold, rgb(1, 1, 1));
  if (branch.address) centered(branch.address, height - 118, 15, regular, rgb(1, 1, 1));

  centered(t(lang, "poster.title"), height - 205, 30, bold);

  const png = await pdf.embedPng(await qrPng(qrText, 1200));
  const qrSize = 340;
  const qrY = height - 235 - qrSize;
  page.drawRectangle({ x: (width - qrSize) / 2 - 14, y: qrY - 14, width: qrSize + 28, height: qrSize + 28, borderColor: accent, borderWidth: 3 });
  page.drawImage(png, { x: (width - qrSize) / 2, y: qrY, width: qrSize, height: qrSize });

  const steps = [t(lang, "poster.step1"), t(lang, "poster.step2"), t(lang, "poster.step3")];
  let y = qrY - 60;
  for (const step of steps) {
    page.drawText(step, { x: 70, y, size: 17, font: regular, color: ink });
    y -= 32;
  }
  centered(t(lang, "poster.note"), 50, 12, regular, grey);
  return pdf.save();
}
