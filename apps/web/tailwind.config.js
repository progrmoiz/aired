/** @type {import('tailwindcss').Config} */
export default {
  content: ['./apps/web/*.html', './apps/web/*.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        aired: {
          bg: '#0a0a0b',
          surface: '#111113',
          'surface-hover': '#18181b',
          border: '#222225',
          'border-focus': '#3b3b40',
          'text-primary': '#ededef',
          'text-secondary': '#8a8a8e',
          'text-tertiary': '#56565a',
          accent: '#7c6aef',
          'accent-hover': '#8b7bf2',
        },
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.5rem', { lineHeight: '2rem' }],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        lg: '12px',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
