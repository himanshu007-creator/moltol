/**
 * Email-client-safe HTML shell: table layout, inline styles only, no
 * flexbox/grid/webfonts, explicit bgcolor + light-only color-scheme so
 * Outlook/Gmail/Apple Mail/dark-mode auto-invert all render it the same.
 */

const BRAND = {
  bg: "#FFFBF2",
  card: "#FFFFFF",
  ink: "#1C1B17",
  inkMuted: "#6B6655",
  marigold: "#FFC629",
  marigoldDark: "#B9880A",
  teal: "#0E9488",
  border: "#EFE6D2",
};

export interface EmailLayoutOptions {
  preheader: string;
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  footerNote?: string;
}

export function renderEmailLayout(opts: EmailLayoutOptions): string {
  const footer =
    opts.footerNote ??
    "MolTol · Hackathon build. Sandbox money only. If you didn't request this, you can ignore this email.";

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>MolTol</title>
<!--[if mso]>
<style>table {border-collapse: collapse;} .fallback-font {font-family: Arial, sans-serif;}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.bg};">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.bg};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td align="center" style="padding-bottom:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<span style="font-size:28px;line-height:1;">🏮</span>
<span style="display:inline-block;margin-left:8px;font-size:20px;font-weight:700;color:${BRAND.ink};vertical-align:middle;">MolTol</span>
</td></tr>
<tr><td style="background-color:${BRAND.card};border:1px solid ${BRAND.border};border-radius:16px;padding:36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${BRAND.marigoldDark};">${opts.eyebrow}</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${BRAND.ink};">${opts.heading}</h1>
${opts.bodyHtml}
</td></tr>
<tr><td align="center" style="padding:24px 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${BRAND.inkMuted};">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function codeBlock(code: string): string {
  const digits = code
    .split("")
    .map(
      (d) =>
        `<td style="width:40px;height:52px;background-color:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:10px;text-align:center;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace;font-size:26px;font-weight:700;color:${BRAND.ink};">${d}</td>`,
    )
    .join(`<td style="width:6px;"></td>`);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px auto;"><tr>${digits}</tr></table>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${BRAND.ink};">${text}</p>`;
}

export function mutedParagraph(text: string): string {
  return `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:${BRAND.inkMuted};">${text}</p>`;
}

export const emailBrand = BRAND;
