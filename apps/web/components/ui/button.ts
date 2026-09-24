import clsx from 'clsx';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'whatsapp';
export type ButtonSize = 'md' | 'lg' | 'sm';

/** Классы кнопок/ссылок-кнопок. Минимальная высота 44–52 px — удобные цели касания на телефоне. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string): string {
  return clsx(
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors',
    'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-gold-500',
    'disabled:cursor-not-allowed disabled:opacity-50',
    {
      'min-h-11 px-4 text-sm': size === 'sm',
      'min-h-12 px-5 text-base': size === 'md',
      'min-h-13 px-7 text-base sm:text-lg': size === 'lg',
    },
    {
      'bg-earth-700 text-cream-50 hover:bg-earth-800': variant === 'primary',
      'bg-gold-400 text-earth-900 hover:bg-gold-300': variant === 'secondary',
      'border border-earth-300 bg-transparent text-earth-800 hover:bg-earth-50': variant === 'outline',
      'bg-transparent text-earth-800 hover:bg-earth-50': variant === 'ghost',
      'bg-whatsapp text-white hover:bg-whatsapp-dark': variant === 'whatsapp',
    },
    className,
  );
}
