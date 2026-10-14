import { codeBlock, mutedParagraph, paragraph, renderEmailLayout } from "./layout";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderSignupOtpEmail(code: string): RenderedEmail {
  const html = renderEmailLayout({
    preheader: `Your MolTol code is ${code}`,
    eyebrow: "Verify your email",
    heading: "One code to open your stall.",
    bodyHtml:
      paragraph("Enter this code to finish creating your MolTol account:") +
      codeBlock(code) +
      mutedParagraph("This code expires in 10 minutes. Didn't sign up? You can safely ignore this email."),
  });
  const text = `Your MolTol verification code is ${code}. It expires in 10 minutes.`;
  return { subject: `${code} is your MolTol verification code`, html, text };
}

export function renderPasswordResetEmail(code: string): RenderedEmail {
  const html = renderEmailLayout({
    preheader: `Your MolTol password reset code is ${code}`,
    eyebrow: "Reset your password",
    heading: "Let's get you back in.",
    bodyHtml:
      paragraph("Use this code to set a new password for your MolTol account:") +
      codeBlock(code) +
      mutedParagraph(
        "This code expires in 10 minutes. If you didn't ask to reset your password, your account is still safe — just ignore this email.",
      ),
  });
  const text = `Your MolTol password reset code is ${code}. It expires in 10 minutes.`;
  return { subject: `${code} is your MolTol password reset code`, html, text };
}
