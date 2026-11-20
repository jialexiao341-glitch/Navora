// ============================================================
// Optional extension contract for the lightweight BootShell.
//
// By default '@product' resolves to product/default (an empty object).
// Alternate builds can override COW_PRODUCT_DIR in vite.config.ts to supply
// a custom StatusLogo on the boot/error screen.
// ============================================================
import type React from 'react'

export interface ProductSlots {
  // Rendered as the logo on the startup/connecting status screen in place of
  // the default app logo.
  StatusLogo?: React.FC
}

export interface ProductExtension {
  slots?: ProductSlots
}
