// Mock data for the team version of Direction A: workspaces, people, folders,
// shared pages, activity and the audit log. Every name and address is made up
// (example domains only).
import { PAGES, type MockPage } from './data'

export type Workspace = { id: 'personal' | 'oakfield' | 'northwind'; name: string; kind: string; initial: string; tone: string }

export const WORKSPACES: Workspace[] = [
  { id: 'personal', name: 'Moiz', kind: 'Personal', initial: 'M', tone: 'bg-gradient-to-br from-(--aired-avatar-from) to-(--aired-avatar-to) text-(--aired-avatar-text)' },
  { id: 'oakfield', name: 'Oakfield School', kind: 'Team · 9 members', initial: 'O', tone: 'bg-gradient-to-br from-amber-300 to-orange-500 text-orange-950' },
  { id: 'northwind', name: 'Northwind Coaching', kind: 'Team · 3 members', initial: 'N', tone: 'bg-gradient-to-br from-emerald-300 to-teal-600 text-teal-950' },
]

export type Role = 'Owner' | 'Admin' | 'Member' | 'Viewer'
export type Person = { id: string; name: string; email: string; role: Role; pages: number; active: string; you?: boolean }

export const DOMAIN = 'oakfield.example'

export const MEMBERS: Person[] = [
  { id: 'moiz', name: 'Moiz', email: `moiz@${DOMAIN}`, role: 'Owner', pages: 4, active: 'Now', you: true },
  { id: 'priya', name: 'Priya Shah', email: `priya@${DOMAIN}`, role: 'Admin', pages: 12, active: '10 min ago' },
  { id: 'sam', name: 'Sam Ortiz', email: `sam@${DOMAIN}`, role: 'Member', pages: 7, active: '1 hour ago' },
  { id: 'leo', name: 'Leo Martins', email: `leo@${DOMAIN}`, role: 'Member', pages: 9, active: 'Today' },
  { id: 'aisha', name: 'Aisha Khan', email: `aisha@${DOMAIN}`, role: 'Member', pages: 3, active: 'Yesterday' },
  { id: 'grace', name: 'Grace Liu', email: `grace@${DOMAIN}`, role: 'Member', pages: 5, active: '2 days ago' },
  { id: 'tom', name: 'Tom Becker', email: `tom@${DOMAIN}`, role: 'Viewer', pages: 0, active: '1 week ago' },
  { id: 'nadia', name: 'Nadia Rossi', email: `nadia@${DOMAIN}`, role: 'Member', pages: 2, active: '3 weeks ago' },
  { id: 'ben', name: 'Ben Hughes', email: `ben@${DOMAIN}`, role: 'Viewer', pages: 0, active: 'Never' },
]

export const GUESTS = [
  { id: 'joanna', name: 'Joanna Reed', email: 'joanna@example.com', note: 'Parent governor', access: 'Trip letter: museum', until: 'Until 30 Dec' },
  { id: 'chris', name: 'Chris Park', email: 'chris@example.net', note: 'PTA chair', access: 'Bake sale poster', until: 'No end date' },
  { id: 'ella', name: 'Ella Ford', email: 'ella@example.org', note: 'Supply teacher', access: 'Year 9 folder', until: 'Until Friday' },
]

export const INVITES = [
  { email: `hana@${DOMAIN}`, role: 'Member' as Role, sent: '2 days ago' },
  { email: `oscar@${DOMAIN}`, role: 'Viewer' as Role, sent: '5 days ago' },
]

export const GROUPS = [
  { name: 'Year 9 team', people: ['priya', 'sam', 'grace', 'moiz'], note: 'Can edit the Year 9 folder' },
  { name: 'Office', people: ['aisha', 'nadia'], note: 'Can view everything' },
  { name: 'Governors', people: ['joanna'], note: '1 guest · can view 2 pages' },
]

export const SEATS = { used: MEMBERS.length, total: 15 }

export const byId = (id: string) => MEMBERS.find((m) => m.id === id) ?? MEMBERS[0]

export type Access = 'workspace' | 'link' | 'people'

export type TeamPage = MockPage & { by: string; folder: string; access: Access; people?: number }

const base = (body: string, bg: string, fg = '#111') =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{width:1200px;height:800px;overflow:hidden;background:${bg};color:${fg};font-family:-apple-system,'Segoe UI',sans-serif;padding:64px 72px}
h1{font-size:64px;line-height:1.05;letter-spacing:-.02em}p{font-size:22px;line-height:1.5}
</style></head><body>${body}</body></html>`

const science: MockPage = {
  id: 'science-fair', title: 'Science fair sign-up', owner: 'Year 7', kind: 'Form',
  expires: 'Expires in 3 days', expiresShort: '3 days', soon: true, pin: false, views: 46, today: 14,
  published: '4 days ago', size: '22 KB',
  html: base(`
<p style="font-weight:800;color:#0369a1;letter-spacing:.12em">OAKFIELD SCIENCE FAIR · 14 MARCH</p>
<h1 style="margin-top:16px">Sign up your project 🔬</h1>
<div style="margin-top:44px;display:grid;gap:18px;max-width:760px">
${['Your name', 'Project title', 'Do you need a power socket?'].map((l) => `<div><p style="font-size:20px;color:#475569;font-weight:600">${l}</p><div style="margin-top:8px;height:64px;border-radius:16px;background:#fff;border:3px solid #bae6fd"></div></div>`).join('')}
<div style="margin-top:10px;width:260px;height:70px;border-radius:999px;background:#0284c7;color:#fff;display:grid;place-items:center;font-size:26px;font-weight:800">Sign me up</div>
</div>`, '#f0f9ff'),
}

const trip: MockPage = {
  id: 'museum-trip', title: 'Trip letter: museum', owner: 'Year 5 parents', kind: 'Letter',
  expires: 'Expires 30 Dec', expiresShort: '30 Dec', pin: true, views: 23, today: 4,
  published: '6 days ago', size: '31 KB',
  html: base(`
<div style="display:flex;justify-content:space-between"><p style="font-weight:700;color:#7c2d12">Oakfield School</p><p style="color:#9a3412">Year 5 · Letter home</p></div>
<h1 style="margin-top:36px;color:#431407">Natural History<br/>Museum trip 🦕</h1>
<p style="margin-top:26px;color:#7c2d12;max-width:820px">Thursday 9 January. Coach leaves at 8:30 and is back by 3:15. Please bring a packed lunch and a waterproof coat.</p>
<div style="margin-top:36px;display:flex;gap:18px">${['Permission slip', 'Kit list', 'Questions?'].map((x) => `<div style="background:#fff;border:3px solid #fed7aa;border-radius:18px;padding:20px 26px;font-size:24px;font-weight:700;color:#9a3412">${x}</div>`).join('')}</div>`, '#fff7ed'),
}

const page = (id: string) => PAGES.find((p) => p.id === id)!

export const TEAM_PAGES: TeamPage[] = [
  { ...science, by: 'grace', folder: 'Events', access: 'link' },
  { ...page('y9-fractions'), by: 'priya', folder: 'Year 9', access: 'workspace', published: '10 min ago' },
  { ...page('parents-evening'), by: 'moiz', folder: 'Events', access: 'link' },
  { ...trip, by: 'aisha', folder: 'Parents', access: 'people', people: 3 },
  { ...page('bake-sale'), by: 'sam', folder: 'Events', access: 'link' },
  { ...page('spelling-animals'), by: 'leo', folder: 'Year 3', access: 'workspace' },
]

export const FOLDERS = [
  { name: 'Year 9', count: 18, tone: 'bg-indigo-400' },
  { name: 'Year 3', count: 11, tone: 'bg-amber-400' },
  { name: 'Events', count: 9, tone: 'bg-pink-400' },
  { name: 'Parents', count: 6, tone: 'bg-orange-400' },
]

export const ACTIVITY = [
  { who: 'priya', what: 'published', page: 'Year 9 fractions quiz', when: '10 min ago' },
  { who: 'sam', what: 'shared with 2 guests', page: 'Bake sale poster', when: '1 hour ago' },
  { who: 'leo', what: 'passed 80 views on', page: 'Spelling game: animals', when: 'Today' },
]

export const AUDIT = [
  { when: 'Today, 09:42', who: 'priya', action: 'Published a page', target: 'Year 9 fractions quiz' },
  { when: 'Today, 08:15', who: 'sam', action: 'Invited a guest', target: 'chris@example.net → Bake sale poster' },
  { when: 'Yesterday, 16:03', who: 'moiz', action: 'Changed a role', target: 'Priya Shah: Member → Admin' },
  { when: 'Yesterday, 11:20', who: 'aisha', action: 'Added a PIN', target: 'Trip letter: museum' },
  { when: 'Mon, 14:51', who: 'moiz', action: 'Verified a domain', target: `pages.${DOMAIN}` },
  { when: 'Mon, 10:08', who: 'grace', action: 'Created an AI tool key', target: 'Claude · Grace’s laptop' },
  { when: 'Sun, 19:30', who: 'leo', action: 'Deleted a page', target: 'Spelling test: week 4' },
  { when: 'Fri, 09:01', who: 'moiz', action: 'Turned on Google sign-in', target: DOMAIN },
]
