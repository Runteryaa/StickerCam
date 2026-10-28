import { Platform } from 'react-native';

/**
 * StickerCam görsel dili: sıcak kağıt tonları, mürekkep siyahı ve mercan vurgular.
 */
export const Colors = {
  paper: '#F8F1E2',
  paperDeep: '#EFE3CD',
  paperLine: '#DCCDB2',
  card: '#FFFBF2',
  ink: '#241D15',
  inkSoft: '#6C5F50',
  inkFaint: '#A2947F',
  white: '#FFFFFF',
  accent: '#DF5F37',
  accentDeep: '#BC4725',
  accentSoft: '#F9DFD2',
  mint: '#2F7A69',
  mintSoft: '#DBEDE6',
  danger: '#B8422F',
  stage: '#16110C',
  stageSoft: '#241C14',
  overlay: 'rgba(20, 14, 9, 0.66)',
  checkerA: '#F2EAD9',
  checkerB: '#E8DCC6',
} as const;

export const Fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }) as string,
  sans: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }) as string,
  sansMedium: Platform.select({
    ios: 'System',
    android: 'sans-serif-medium',
    default: 'System',
  }) as string,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
};

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 24,
  six: 32,
  seven: 48,
} as const;

export const Radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
  pill: 999,
} as const;
