
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Deep black, high-contrast theme
        'copilot-bg': '#02040a',
        'copilot-chat': '#050810',
        'copilot-border': '#1a1f2b',
        'copilot-user': '#0b1020',
        'copilot-ai': '#111827',
        'copilot-text': '#e5e7eb',
        'copilot-text-muted': '#6b7280',
        'copilot-blue': '#38bdf8',
      },
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
