const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'])

/** Dosya adına göre önizleme türü: görsel, PDF veya yok. */
export function previewKind(name: string): 'image' | 'pdf' | null {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return null
}
