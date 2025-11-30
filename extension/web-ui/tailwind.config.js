
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'copilot-bg': '#0d1117',
        'copilot-chat': '#161b22',
        'copilot-border': '#30363d',
        'copilot-user': '#21262d',
        'copilot-ai': '#1f6feb',
        'copilot-text': '#c9d1d9',
        'copilot-text-muted': '#8b949e',
        'copilot-blue': '#58a6ff',
      },
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
