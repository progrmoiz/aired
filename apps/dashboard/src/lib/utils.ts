import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The type sizes from the shared tokens (index.css @theme) are font sizes,
// not colours, so merging `text-body` must not drop `text-primary-foreground`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["body", "md", "heading", "subheading", "title", "display"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
