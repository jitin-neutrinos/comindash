import { tailwindTheme } from './src/theme.js'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: tailwindTheme,
  },
  plugins: [],
}
