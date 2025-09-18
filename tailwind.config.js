export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        neonGreen: '#39ff14',
        neonPink: '#ff2d95',
        neonCyan: '#00e5ff',
        cyberPurple: '#6a00ff',
        cyberBgStart: '#050014',
        cyberBgEnd: '#0b0024'
      },
      fontFamily: {
        display: ['Orbitron', 'system-ui', 'sans-serif'],
        mono: ['"Share Tech Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'neon-md': '0 6px 30px rgba(57,255,20,0.06), 0 0 40px rgba(0,229,255,0.06)',
      },
    },
  },
  plugins: [],
}
