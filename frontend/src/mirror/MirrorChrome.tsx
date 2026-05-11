import { useEffect, lazy, Suspense, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { MirrorSidebar } from './MirrorSidebar'
import { MirrorPageWrapper } from './MirrorPageWrapper'
import { MirrorPageHeader } from './MirrorPageHeader'
import { attachCursorTracking } from './cursorTracking'

// Lazy mirror pages — PR2/PR3 fill the stubs.
const MirrorChat = lazy(() =>
  import('./MirrorChat').then((m) => ({ default: m.MirrorChat })),
)
const MirrorSettings = lazy(() =>
  import('./MirrorSettings').then((m) => ({ default: m.MirrorSettings })),
)

// Lazy classic pages — wrapped in MirrorPageWrapper so the mirror page
// chrome (title + scroll region) renders before the classic body. PR2/
// PR3 replace these one at a time with native mirror equivalents.
const Calendar = lazy(() => import('../pages/Calendar'))
const Notifications = lazy(() => import('../pages/Notifications'))
const Repository = lazy(() => import('../pages/Repository'))
const Notes = lazy(() => import('../pages/Notes'))
const Wiki = lazy(() => import('../pages/Wiki'))
const Pkm = lazy(() => import('../pages/Pkm'))
const OutputProfiles = lazy(() => import('../pages/OutputProfiles'))
const Resources = lazy(() => import('../pages/Resources'))
const Memory = lazy(() => import('../pages/Memory'))
const SocialChannels = lazy(() => import('../pages/SocialChannels'))
const Toolbox = lazy(() => import('../pages/Toolbox'))
const SqlWorkbench = lazy(() => import('../pages/SqlWorkbench'))
const SqlDataSources = lazy(() => import('../pages/SqlDataSources'))
const SqlFiles = lazy(() => import('../pages/SqlFiles'))
const SqlVariables = lazy(() => import('../pages/SqlVariables'))
const SqlOrchestration = lazy(() => import('../pages/SqlOrchestration'))
const SqlLoads = lazy(() => import('../pages/SqlLoads'))
const SqlServers = lazy(() => import('../pages/SqlServers'))
const SqlShellFiles = lazy(() => import('../pages/SqlShellFiles'))
const SearchSources = lazy(() => import('../pages/SearchSources'))
const Skills = lazy(() => import('../pages/Skills'))

function Wrap(title: string, child: ReactNode) {
  return (
    <MirrorPageWrapper header={<MirrorPageHeader title={title} />}>
      {child}
    </MirrorPageWrapper>
  )
}

export function MirrorChrome() {
  useEffect(() => attachCursorTracking(), [])
  return (
    <div className="mr-shell">
      <MirrorSidebar />
      <Suspense fallback={<div className="mr-page-loading" />}>
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<MirrorChat />} />
          <Route path="/settings" element={<MirrorSettings />} />

          <Route path="/calendar" element={Wrap('日历', <Calendar />)} />
          <Route
            path="/notifications"
            element={Wrap('通知中心', <Notifications />)}
          />
          <Route path="/repository" element={Wrap('仓库', <Repository />)} />
          <Route path="/repository/:id" element={Wrap('仓库', <Repository />)} />
          <Route path="/notes" element={Wrap('笔记', <Notes />)} />
          <Route path="/wiki" element={Wrap('Wiki', <Wiki />)} />
          <Route path="/pkm" element={Wrap('PKM', <Pkm />)} />
          <Route
            path="/output-profiles"
            element={Wrap('输出配方', <OutputProfiles />)}
          />
          <Route path="/resources" element={Wrap('资源列表', <Resources />)} />
          <Route path="/memory" element={Wrap('记忆中心', <Memory />)} />
          <Route
            path="/social-channels"
            element={Wrap('社交通道', <SocialChannels />)}
          />
          <Route
            path="/social-channels/:channel"
            element={Wrap('社交通道', <SocialChannels />)}
          />
          <Route path="/toolbox" element={Wrap('工具箱', <Toolbox />)} />
          <Route
            path="/toolbox/:provider"
            element={Wrap('工具箱', <Toolbox />)}
          />
          <Route path="/sql" element={Wrap('SQL 工作台', <SqlWorkbench />)} />
          <Route
            path="/sql/datasources"
            element={Wrap('SQL 工作台', <SqlDataSources />)}
          />
          <Route
            path="/sql/files"
            element={Wrap('SQL 工作台', <SqlFiles />)}
          />
          <Route
            path="/sql/variables"
            element={Wrap('SQL 工作台', <SqlVariables />)}
          />
          <Route
            path="/sql/orchestration"
            element={Wrap('SQL 工作台', <SqlOrchestration />)}
          />
          <Route
            path="/sql/loads"
            element={Wrap('SQL 工作台', <SqlLoads />)}
          />
          <Route
            path="/sql/servers"
            element={Wrap('SQL 工作台', <SqlServers />)}
          />
          <Route
            path="/sql/shell-files"
            element={Wrap('SQL 工作台', <SqlShellFiles />)}
          />
          <Route
            path="/search-sources"
            element={Wrap('搜索源', <SearchSources />)}
          />
          <Route path="/skills" element={Wrap('Skill 中心', <Skills />)} />
        </Routes>
      </Suspense>
    </div>
  )
}
