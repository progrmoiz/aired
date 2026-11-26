// Mock pages for the three design directions. Each has a small sample HTML
// document, rendered in a sandboxed iframe as its thumbnail/preview, the way
// the real dashboard would show a person's own pages.

export type MockPage = {
  id: string
  title: string
  owner: string
  kind: string
  expires: string
  expiresShort: string
  soon?: boolean
  pin: boolean
  views: number
  today: number
  published: string
  size: string
  html: string
}

const base = (body: string, bg: string, fg = '#111', font = "-apple-system, 'Segoe UI', sans-serif") =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{width:1200px;height:800px;overflow:hidden;background:${bg};color:${fg};font-family:${font};padding:64px 72px}
h1{font-size:64px;line-height:1.05;letter-spacing:-.02em}h2{font-size:28px}p{font-size:22px;line-height:1.5}
</style></head><body>${body}</body></html>`

export const PAGES: MockPage[] = [
  {
    id: 'leg-day-w3', title: 'Week 3 leg day', owner: 'For Maya', kind: 'Workout plan',
    expires: 'Expires Friday', expiresShort: 'Fri', soon: true, pin: false, views: 14, today: 5,
    published: '2 days ago', size: '18 KB',
    html: base(`
<p style="font-size:20px;letter-spacing:.2em;text-transform:uppercase;color:#f97316;font-weight:700">Coach Sam · Week 3</p>
<h1 style="margin-top:14px">Leg day 🦵</h1>
<p style="color:#57534e;margin-top:10px">Warm up 10 min · Rest 90 s between sets</p>
<div style="margin-top:40px;display:grid;gap:16px">
${[['Back squat', '4 × 8', '60 kg'], ['Romanian deadlift', '3 × 10', '50 kg'], ['Walking lunges', '3 × 12', 'Body'], ['Leg press', '3 × 12', '120 kg']]
  .map(([a, b, c]) => `<div style="display:flex;justify-content:space-between;align-items:center;background:#fff;border-radius:20px;padding:26px 32px;box-shadow:0 2px 0 #e7e5e4"><b style="font-size:30px">${a}</b><span style="font-size:26px;color:#57534e">${b} &nbsp;·&nbsp; <b style="color:#ea580c">${c}</b></span></div>`).join('')}
</div>`, '#fff7ed'),
  },
  {
    id: 'y9-fractions', title: 'Year 9 fractions quiz', owner: 'Class 9B', kind: 'Quiz',
    expires: 'Never expires', expiresShort: 'Never', pin: false, views: 31, today: 12,
    published: '5 days ago', size: '42 KB',
    html: base(`
<div style="display:flex;justify-content:space-between;align-items:center"><p style="font-weight:700;color:#4338ca">Maths · Year 9</p><p style="background:#e0e7ff;color:#3730a3;border-radius:999px;padding:6px 20px;font-weight:700">Question 3 of 10</p></div>
<h1 style="margin-top:40px">What is ¾ + ⅙?</h1>
<div style="margin-top:48px;display:grid;grid-template-columns:1fr 1fr;gap:22px">
${['11/12', '4/10', '5/6', '10/12'].map((x, i) => `<div style="border:4px solid ${i === 0 ? '#4f46e5' : '#c7d2fe'};background:${i === 0 ? '#eef2ff' : '#fff'};border-radius:24px;padding:36px;font-size:44px;font-weight:700;text-align:center">${x}</div>`).join('')}
</div>`, '#f5f7ff'),
  },
  {
    id: 'parents-evening', title: "Parents' evening slides", owner: 'Year 9 team', kind: 'Slides',
    expires: 'Expires in 2 days', expiresShort: '2 days', soon: true, pin: true, views: 7, today: 2,
    published: 'Yesterday', size: '1.2 MB',
    html: base(`
<p style="color:#a7f3d0;font-size:22px">Slide 1 of 12</p>
<h1 style="margin-top:140px;font-size:84px;color:#fff">Welcome to<br/>Parents' Evening</h1>
<p style="margin-top:28px;color:#99f6e4;font-size:28px">Year 9 · Thursday 6pm · Main hall</p>
<div style="position:absolute;right:72px;bottom:64px;width:220px;height:220px;border-radius:50%;background:#14b8a6;opacity:.35"></div>`, '#0f3d3a', '#fff'),
  },
  {
    id: 'checkin-maya', title: 'Client check-in: Maya', owner: 'Private', kind: 'Progress report',
    expires: 'Never expires', expiresShort: 'Never', pin: true, views: 4, today: 1,
    published: '1 week ago', size: '86 KB',
    html: base(`
<h2 style="color:#64748b;font-weight:600">8-week check-in</h2>
<h1 style="margin-top:8px">Maya's progress</h1>
<div style="margin-top:36px;display:grid;grid-template-columns:repeat(3,1fr);gap:20px">
${[['Squat', '+15 kg'], ['Body fat', '−3.2%'], ['Sessions', '22 / 24']].map(([a, b]) => `<div style="background:#fff;border:2px solid #e2e8f0;border-radius:20px;padding:26px"><p style="color:#64748b">${a}</p><p style="font-size:44px;font-weight:800;color:#0f766e">${b}</p></div>`).join('')}
</div>
<div style="margin-top:30px;height:220px;display:flex;align-items:flex-end;gap:14px;border-bottom:3px solid #cbd5e1">
${[30, 38, 35, 48, 52, 60, 66, 78].map((h) => `<i style="flex:1;height:${h * 2.6}px;background:#14b8a6;border-radius:10px 10px 0 0"></i>`).join('')}
</div>`, '#f8fafc'),
  },
  {
    id: 'bake-sale', title: 'Bake sale poster', owner: 'PTA', kind: 'Poster',
    expires: 'Expires 30 Dec', expiresShort: '30 Dec', pin: false, views: 52, today: 9,
    published: '3 weeks ago', size: '240 KB',
    html: base(`
<div style="text-align:center;padding-top:30px">
<p style="font-size:30px;font-weight:700;color:#be185d;letter-spacing:.15em">FRIDAY · 3:15 PM</p>
<h1 style="font-size:120px;margin-top:20px;color:#831843">Bake Sale!</h1>
<p style="font-size:34px;margin-top:20px;color:#9d174d">Cakes · Cookies · Lemonade</p>
<div style="margin:56px auto 0;display:flex;justify-content:center;gap:28px;font-size:90px">🧁 🍪 🍋</div>
<p style="margin-top:40px;font-size:26px;color:#be185d">All money goes to the new library</p></div>`, '#fdf2f8'),
  },
  {
    id: 'spelling-animals', title: 'Spelling game: animals', owner: 'Year 3', kind: 'Game',
    expires: 'Never expires', expiresShort: 'Never', pin: false, views: 88, today: 21,
    published: '1 month ago', size: '64 KB',
    html: base(`
<div style="display:flex;justify-content:space-between"><p style="font-weight:800;font-size:30px">⭐ 7</p><p style="font-weight:800;font-size:30px">Level 2</p></div>
<div style="text-align:center;margin-top:40px;font-size:150px">🦒</div>
<div style="display:flex;justify-content:center;gap:16px;margin-top:30px">
${'GIRAF_E'.split('').map((ch) => `<div style="width:96px;height:110px;border-radius:20px;background:${ch === '_' ? '#fde68a' : '#fff'};border:4px solid #f59e0b;display:grid;place-items:center;font-size:60px;font-weight:800">${ch === '_' ? '' : ch}</div>`).join('')}
</div>`, '#fef9c3'),
  },
]

export const USER = { first: 'Moiz', login: 'moiz', initial: 'M', plan: 'Free' }
export const host = 'aired.sh'

export const origin = 'https://aired.sh'
