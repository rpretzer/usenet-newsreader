/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        'sovereign': {
          'bg': '#0a0a0f',
          'surface': '#1a1a24',
          'border': '#2a2a3a',
          'text': '#e8e8f0',
          'text-muted': '#a0a0b0',
          'accent': '#4f9cf9',
          'accent-hover': '#6bb0ff',
        }
      },
      fontFamily: {
        'mono': ['JetBrains Mono', 'Courier New', 'monospace'],
      }
    },
  },
  plugins: [],
}

