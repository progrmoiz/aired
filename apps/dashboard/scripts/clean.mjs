// Remove the previous build from apps/web before Vite writes the new one.
// Vite can't empty apps/web (it holds the rest of the site), so hashed files
// from old builds would pile up in dashboard-assets/ without this.
import { rmSync } from 'node:fs';
const web = new URL('../../web/', import.meta.url);
rmSync(new URL('dashboard-assets/', web), { recursive: true, force: true });
rmSync(new URL('dashboard.html', web), { force: true });
