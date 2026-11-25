import { GalleryDirection } from './gallery'
import { HomeDirection } from './home'
import { StudioDirection } from './studio'

/** Design directions for the owner to pick from: /dashboard?direction=a|b|c (&empty=1). */
export default function Directions() {
  const params = new URLSearchParams(window.location.search)
  const d = params.get('direction')
  const empty = params.get('empty') === '1'
  if (d === 'b') return <HomeDirection empty={empty} />
  if (d === 'c') return <StudioDirection empty={empty} />
  return <GalleryDirection empty={empty} />
}
