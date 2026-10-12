import { clsx, type ClassValue } from 'clsx';

/** Tiny class-name joiner. One helper, used by every component. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
