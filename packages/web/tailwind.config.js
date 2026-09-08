/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Overlay accent palette, resolved from the CSS variables declared in index.css
        // so the theme picked in the admin panel repaints the overlay at runtime.
        accent: {
          bright: "rgb(var(--accent-bright) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
          base: "rgb(var(--accent-base) / <alpha-value>)",
          deep: "rgb(var(--accent-deep) / <alpha-value>)",
          edge: "rgb(var(--accent-edge) / <alpha-value>)",
          muted: "rgb(var(--accent-muted) / <alpha-value>)",
          ink: "rgb(var(--accent-ink) / <alpha-value>)",
        },
        // Fixed gold chrome of the admin control room (not themed: it never goes on stream).
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
