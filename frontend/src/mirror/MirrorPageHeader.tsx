import { ReactNode } from 'react'
import { MirrorText } from './primitives'

export interface MirrorPageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

export function MirrorPageHeader({ title, subtitle, actions }: MirrorPageHeaderProps) {
  return (
    <header className="mr-page-header">
      <div className="mr-page-header-text">
        <h1 className="mr-page-title">{title}</h1>
        {subtitle && (
          <MirrorText role="body" as="p" className="mr-page-subtitle">
            {subtitle}
          </MirrorText>
        )}
      </div>
      {actions && <div className="mr-page-actions">{actions}</div>}
    </header>
  )
}
