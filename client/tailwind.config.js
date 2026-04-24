/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f5f7ff',
          100: '#e6ecff',
          200: '#c9d4ff',
          300: '#a3b4ff',
          400: '#7c8cff',
          500: '#4f46e5',
          600: '#4338ca',
          700: '#3730a3',
          800: '#2a247d',
          900: '#1e1a5c',
        },
      },
    },
  },
  plugins: [],
};
