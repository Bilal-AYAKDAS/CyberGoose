/*
 * CyberGoose ikon seti: 24 ızgara, 1.5 çizgi, yuvarlak uç, dolgusuz; arayüzde 16px.
 * Renk `currentColor` ile gelir (varsayılan text-muted, klasör text-accent).
 * İlk 14 ikon tasarım sistemindeki assets/Icons ile birebir aynıdır; close, plus, sun, moon,
 * info ve alert aynı ızgara ve çizgiyle çizilmiş tamamlayıcı ikonlardır.
 */
const paths = {
  folder: 'M3 6v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-8.6L9.7 5.3A1 1 0 0 0 9 5H4a1 1 0 0 0-1 1Z',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Zm0 0v5h5',
  upload: 'M12 15V4m-4.5 4.5L12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  download: 'M12 4v11m-4.5-4.5L12 15l4.5-4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  transfer: 'M4 8h15m-3.5-3.5L19 8l-3.5 3.5M20 16H5m3.5-3.5L5 16l3.5 3.5',
  server: 'M4 4h16v7H4zM4 13h16v7H4zM7 7.5h3M7 16.5h3',
  key: 'M10.8 13.2L19 5m-3 3 2.5 2.5M8 20a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  cloud: 'M7 18.5h10.5a4 4 0 0 0 .5-7.97 6 6 0 0 0-11.6-1.4A4.7 4.7 0 0 0 7 18.5Z',
  bookmark: 'M6 3h12v18l-6-4.5L6 21V3Z',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20',
  'chevron-right': 'M10 6l6 6-6 6',
  home: 'M4 10.5 12 4l8 6.5V20H4v-9.5ZM10 20v-6h4v6',
  close: 'M7 7l10 10M17 7 7 17',
  plus: 'M12 5v14M5 12h14',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5m0-8h.01',
  alert: 'M12 4 3 20h18L12 4Zm0 6v4m0 3h.01',
} as const

export type IconName = keyof typeof paths

type IconProps = {
  name: IconName
  size?: number
  className?: string
}

export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      className={className ? `cg-ico ${className}` : 'cg-ico'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  )
}
