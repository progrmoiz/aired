import { GalleryDirection } from './gallery'
import { HomeDirection } from './home'

/** Design directions for the owner to pick from: /dashboard?direction=a|b (&empty=1, &style=, and for A &ws=team). */
export default function Directions() {
  const params = new URLSearchParams(window.location.search)
  const empty = params.get('empty') === '1'
  if (params.get('direction') === 'b') return <HomeDirection empty={empty} />
  return <GalleryDirection empty={empty} />
}
