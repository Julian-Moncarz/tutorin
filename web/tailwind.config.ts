import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Satoshi', 'system-ui', 'sans-serif'],
      },
      colors: {
        cream: {
          DEFAULT: '#f5f0e8',
          raised: '#ede7dd',
          overlay: '#e3ddd3',
          border: '#d4cdc2',
          dark: '#c4bdb3',
        },
        charcoal: {
          DEFAULT: '#1a1a1a',
          secondary: '#3d3832',
          muted: '#8a847c',
        },
        green: {
          DEFAULT: '#22c55e',
          hover: '#16a34a',
          light: '#dcfce7',
          faint: '#22c55e12',
        },
        danger: '#dc2626',
      },
    },
  },
  plugins: [],
};

export default config;
