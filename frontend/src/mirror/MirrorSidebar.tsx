import { Link, useLocation } from 'react-router-dom'
import { NAV_ITEMS } from './nav'
import { MirrorText, MirrorChip } from './primitives'

export function MirrorSidebar() {
  const loc = useLocation()
  return (
    <aside className="mr-sidebar">
      <div className="mr-sidebar-brand">
        <MirrorText role="title" as="span">1052 OS</MirrorText>
        <button className="mr-sidebar-collapse" type="button" aria-label="折叠">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M9 3L5 7L9 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <MirrorText role="label" as="div" className="mr-sidebar-section">导航</MirrorText>
      <nav className="mr-nav">
        {NAV_ITEMS.map((item) => {
          const active =
            loc.pathname === item.path ||
            (item.path !== '/' && loc.pathname.startsWith(item.path + '/'))
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`mr-nav-item${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <item.Icon size={16} className="mr-nav-icon" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
      <div className="mr-sidebar-footer">
        <div className="mr-chip-row">
          <MirrorChip active>1052</MirrorChip>
          <MirrorChip>01</MirrorChip>
          <MirrorChip>02</MirrorChip>
          <MirrorChip>03</MirrorChip>
          <MirrorChip>04</MirrorChip>
          <MirrorChip>05</MirrorChip>
          <MirrorChip>06</MirrorChip>
        </div>
        <div className="mr-user-row">
          <div className="mr-avatar" />
          <div className="mr-user-info">
            <MirrorText role="title" as="div">本地用户</MirrorText>
            <MirrorText role="meta" as="div">● 在线</MirrorText>
          </div>
        </div>
      </div>
    </aside>
  )
}
