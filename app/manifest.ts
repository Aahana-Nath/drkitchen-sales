import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DrKitchen Sales',
    short_name: 'DrK Sales',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafaf9',
    theme_color: '#c2410c',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  }
}
