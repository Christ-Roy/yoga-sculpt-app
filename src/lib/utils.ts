import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Helper shadcn standard : fusionne des classes conditionnelles (clsx) puis
 * dédoublonne les classes Tailwind en conflit (tailwind-merge).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
