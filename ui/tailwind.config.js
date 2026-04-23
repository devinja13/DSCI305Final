/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        planning: {
          light: '#f8fafc',
          DEFAULT: '#e2e8f0',
          dark: '#0f172a',
          accent: '#0284c7', // Professional muted blue
          accentHover: '#0369a1',
          mapOverlay: 'rgba(15, 23, 42, 0.7)'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
