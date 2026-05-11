import { ReactNode } from 'react'

export interface MirrorPageWrapperProps {
  header: ReactNode
  children: ReactNode
}

export function MirrorPageWrapper({ header, children }: MirrorPageWrapperProps) {
  return (
    <div className="mr-page">
      {header}
      <main className="mr-page-scroll">{children}</main>
    </div>
  )
}
