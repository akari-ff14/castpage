import type { ReactNode } from 'react'
import { ChevronRight } from '../icons'
import './StatusCard.css'

interface Props {
  title: string
  icon?: ReactNode
  accent?: 'teal' | 'gold' | 'green' | 'purple' | 'red'
  onClick?: () => void
  actionLabel?: string
  children: ReactNode
  emphasized?: boolean
}

export default function StatusCard({
  title,
  icon,
  accent = 'teal',
  onClick,
  actionLabel,
  children,
  emphasized,
}: Props) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`status-card accent-${accent} ${emphasized ? 'emphasized' : ''} ${onClick ? 'clickable' : ''}`}
      onClick={onClick}
    >
      <div className="status-card-header">
        {icon && <span className="status-card-icon">{icon}</span>}
        <h3 className="status-card-title">{title}</h3>
        {onClick && actionLabel && (
          <span className="status-card-action">
            {actionLabel}
            <ChevronRight size={14} />
          </span>
        )}
      </div>
      <div className="status-card-body">{children}</div>
    </Tag>
  )
}
