/*
 * CyberGoose işareti: kalın boyun çizgisi + öne bakan gaga + 10×10 piksel göz.
 * Boyun `currentColor` (koyu zeminde brand-paper, açık zeminde brand-graphite gibi davranır);
 * gaga her zaman brand-beak. Döndürmeyin, gölge/gradyan eklemeyin.
 */
type GooseMarkProps = { height?: number; title?: string }

export function GooseMark({ height = 16, title }: GooseMarkProps) {
  const width = Math.round((height * 122) / 162)
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 122 162"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path fill="currentColor" fillRule="evenodd" d="M0 162V58A58 58 0 0 1 58 0H84V44H58A14 14 0 0 0 44 58V162ZM60 14V24H70V14Z" />
      <path fill="var(--brand-beak)" d="M84 0H100L122 22L100 44H84Z" />
    </svg>
  )
}
