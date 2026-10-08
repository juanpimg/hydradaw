/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0a0d14',
          surface: '#101522',
          surfaceLight: '#182032',
          border: '#1f2a40',
          text: '#f1f5f9',
          muted: '#94a3b8'
        },
        daw: {
          accent: '#06b6d4',
          green: '#10b981',
          red: '#ef4444',
          amber: '#f59e0b',
          purple: '#a855f7',
          blue: '#3b82f6'
        }
      }
    },
  },
  plugins: [],
}
