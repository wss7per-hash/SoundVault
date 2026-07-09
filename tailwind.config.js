/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#1a1a18',
          card: '#2C2C2A',
          hover: '#353533',
          border: '#3E3E3C'
        },
        accent: {
          DEFAULT: '#534AB7',
          light: '#7F77DD',
          muted: '#3C3489'
        },
        muted: {
          DEFAULT: '#888780',
          light: '#B4B2A9'
        }
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'PingFang SC',
          'Microsoft YaHei',
          'sans-serif'
        ],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace']
      },
      borderRadius: {
        DEFAULT: '8px',
        md: '8px',
        lg: '12px',
        xl: '16px'
      },
      borderWidth: {
        DEFAULT: '0.5px',
        '0': '0',
        '0.5': '0.5px',
        '1': '1px'
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
}
