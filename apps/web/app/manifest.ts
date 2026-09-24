import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AULA — казахская кухня',
    short_name: 'AULA',
    description: 'Меню, доставка, бронь столов и банкеты в ресторанах AULA (Астана)',
    start_url: '/ru',
    display: 'standalone',
    background_color: '#fbf6ee',
    theme_color: '#57351e',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
