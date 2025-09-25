import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#f0f9ff', 100: '#e0f2fe', 600: '#0284c7', 700: '#0369a1' }
      },
      boxShadow: { soft: '0 10px 25px -10px rgba(0,0,0,0.12)' },
      borderRadius: { xl2: '1rem' }
    }
  },
  plugins: []
} satisfies Config