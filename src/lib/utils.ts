import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Converts decimal feet to feet and inches format (e.g., 17.167 feet -> "17' 2"")
 * Rounds to the nearest inch
 */
export function formatFeetAndInches(decimalFeet: number): string {
  if (decimalFeet === 0) return "0' 0\""
  
  const totalInches = Math.round(decimalFeet * 12)
  const feet = Math.floor(totalInches / 12)
  const inches = totalInches % 12
  
  return `${feet}' ${inches}"`
}
