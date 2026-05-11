import { MirrorPageWrapper } from './MirrorPageWrapper'
import { MirrorPageHeader } from './MirrorPageHeader'

/**
 * Stub — PR3 will replace the body with the actual mirror Chat layout
 * (conversation stream, composer, side panel). For now this just renders
 * the page chrome so the route resolves and the smoke test passes.
 */
export function MirrorChat() {
  return (
    <MirrorPageWrapper
      header={<MirrorPageHeader title="聊天" subtitle="与本地与远端模型对话。" />}
    >
      <div className="mr-todo">TODO: PR3 fills this</div>
    </MirrorPageWrapper>
  )
}
