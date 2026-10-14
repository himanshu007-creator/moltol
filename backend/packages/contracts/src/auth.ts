import { z } from "zod";

export const SignupRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const VerifyOtpRequestSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "code must be 6 digits"),
});
export type VerifyOtpRequest = z.infer<typeof VerifyOtpRequestSchema>;

export const ResendOtpRequestSchema = z.object({
  email: z.string().email(),
});
export type ResendOtpRequest = z.infer<typeof ResendOtpRequestSchema>;

export const OtpPurposeSchema = z.enum(["signup", "reset"]);
export type OtpPurpose = z.infer<typeof OtpPurposeSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "code must be 6 digits"),
  newPassword: z.string().min(8).max(200),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  hasShop: z.boolean(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthSessionSchema = z.object({
  token: z.string(),
  user: AuthUserSchema,
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const SignupResponseSchema = z.object({
  normalizedEmail: z.string(),
  message: z.string(),
  resendCooldownSeconds: z.number().int(),
});
export type SignupResponse = z.infer<typeof SignupResponseSchema>;
