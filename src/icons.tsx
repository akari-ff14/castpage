// SVG アイコン集 — lucide-react を入れずに必要なものだけ inline で持つ。
// すべて 24×24 ViewBox、stroke="currentColor" で親の color に追従。
// 使い方: <Home size={16} />

import type { SVGProps } from 'react'

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number
}

const base = (props: IconProps) => {
  const { size = 18, strokeWidth = 2, ...rest } = props
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  }
}

export const Home = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 12 L12 3 L21 12" />
    <path d="M5 10v10h14V10" />
    <path d="M9 20v-6h6v6" />
  </svg>
)

export const MessageSquare = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

export const Calendar = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
)

export const ListChecks = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 5l2 2 4-4" />
    <path d="M3 12l2 2 4-4" />
    <path d="M3 19l2 2 4-4" />
    <path d="M13 6h8M13 13h8M13 20h8" />
  </svg>
)

export const Users = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

export const UserX = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <path d="M17 8l5 5M22 8l-5 5" />
  </svg>
)

export const TrendingUp = (p: IconProps) => (
  <svg {...base(p)}>
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </svg>
)

export const Wrench = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14.7 6.3a4.5 4.5 0 1 1 5.6 5.6L9.5 22.7 1.3 14.5l10.4-10.4a4.5 4.5 0 0 1 3-1.1z" />
  </svg>
)

export const Settings = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
)

export const Menu = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 12h18M3 6h18M3 18h18" />
  </svg>
)

export const Close = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export const LogOut = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

export const RefreshCw = (p: IconProps) => (
  <svg {...base(p)}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
)

export const Plus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const Minus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
)

export const Check = (p: IconProps) => (
  <svg {...base(p)}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export const Edit = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
)

export const Trash = (p: IconProps) => (
  <svg {...base(p)}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

export const AlertTriangle = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <circle cx="12" cy="17" r="0.5" />
  </svg>
)

export const Clock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
)

export const RotateCw = (p: IconProps) => (
  <svg {...base(p)}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
)

export const Sparkles = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" />
  </svg>
)

export const Stop = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5" y="5" width="14" height="14" rx="1.5" />
  </svg>
)

export const Play = (p: IconProps) => (
  <svg {...base(p)}>
    <polygon points="6 4 20 12 6 20 6 4" />
  </svg>
)

export const Crown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2 18h20l-2-10-5 4-5-7-5 7-5-4z" />
  </svg>
)

export const ChevronRight = (p: IconProps) => (
  <svg {...base(p)}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

export const Swap = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M16 3l4 4-4 4" />
    <path d="M20 7H4" />
    <path d="M8 21l-4-4 4-4" />
    <path d="M4 17h16" />
  </svg>
)

export const Mail = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22 6 12 13 2 6" />
  </svg>
)

export const Search = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

export const Wallet = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
  </svg>
)

export const Tag = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
)

export const DoorOpen = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 4h3a2 2 0 0 1 2 2v14" />
    <path d="M2 20h3" />
    <path d="M13 20h9" />
    <path d="M10 12v.01" />
    <path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561z" />
  </svg>
)

export const ArrowLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)
