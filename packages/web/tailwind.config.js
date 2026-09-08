/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        gold: {
          50: "#fffdf5",
          100: "#fdf8e6",
          200: "#faefc5",
          300: "#f5df9a",
          400: "#eec866",
          500: "#e5b138",
          600: "#cb9226",
          700: "#a36e1f",
          800: "#845620",
          900: "#6e471f",
        },
        card: {
          DEFAULT: "#131315",
          inner: "#0b0b0c",
          border: "#26262b",
        },
      },
      fontFamily: {
        serif: ["Cinzel", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "gold-glow": "0 0 25px -5px rgba(229, 177, 56, 0.3)",
      },
    },
  },
  plugins: [],
}
