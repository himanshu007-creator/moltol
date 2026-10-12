/**
 * Mock auth — any phone number, OTP is always "1234". Swap for real providers
 * later. (The demo account itself is auto-provisioned on first load — see
 * stores/session.ts provisionDemo — not logged in through this module.)
 */

import { DEMO_USER } from './seeds';

export const MOCK_OTP = '1234';

export interface AuthRequest {
  identifier: string;
  otp?: string;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  name?: string;
  phone?: string;
}

export function requestOtp(_identifier: string): { ok: boolean; sentTo?: string } {
  // In a real build: backend texts the OTP. Here it is always "1234".
  return { ok: true };
}

export function verifyOtp(req: AuthRequest): AuthResult {
  if (!req.identifier.trim()) return { ok: false, error: 'empty' };
  if (req.otp?.trim() !== MOCK_OTP) return { ok: false, error: 'bad-otp' };
  return { ok: true, name: DEMO_USER.name, phone: req.identifier.trim() };
}