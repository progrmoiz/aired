import { GalleryDirection } from './gallery'

/** The Gallery mockup, kept to preview team features: /dashboard?direction=a (&ws=team, &style=midnight|daylight, &empty=1). */
export default function Directions() {
  const empty = new URLSearchParams(window.location.search).get('empty') === '1'
  return <GalleryDirection empty={empty} />
}
