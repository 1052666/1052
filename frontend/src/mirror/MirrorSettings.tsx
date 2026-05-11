import { MirrorPageWrapper } from './MirrorPageWrapper'
import { MirrorPageHeader } from './MirrorPageHeader'

/**
 * Stub — PR2 will replace the body with the actual two-column mirror
 * Settings layout (model presets / image / agent / appearance left;
 * token usage / long-term memory right). For now this just renders
 * the page chrome so the route resolves and the smoke test passes.
 */
export function MirrorSettings() {
  return (
    <MirrorPageWrapper
      header={
        <MirrorPageHeader
          title="设置"
          subtitle="左侧管理模型、图像生成、Agent 行为和外观；右侧查看 Token 使用与长期记忆摘要。"
        />
      }
    >
      <div className="mr-todo">TODO: PR2 fills this</div>
    </MirrorPageWrapper>
  )
}
