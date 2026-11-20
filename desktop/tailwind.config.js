const path = require('path')

// When '@product' points outside this project (COW_PRODUCT_DIR), scan that
// directory too so classes used only there still get generated.
const productContent = process.env.COW_PRODUCT_DIR
  ? [path.join(process.env.COW_PRODUCT_DIR, '**/*.{tsx,ts}')]
  : []

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,tsx,ts}', ...productContent],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      colors: {
        primary: {
          50: '#EDFDF3',
          100: '#D4FAE2',
          200: '#ABF4C7',
          300: '#74E9A4',
          400: '#4ABE6E',
          500: '#35A85B',
          600: '#228547',
          700: '#1C6B3B',
          800: '#1A5532',
          900: '#16462A',
        },
      },
      animation: {
        'pulse-dot': 'pulseDot 1.4s infinite ease-in-out both',
      },
      keyframes: {
        pulseDot: {
          '0%, 80%, 100%': { transform: 'scale(0.6)', opacity: '0.4' },
          '40%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
