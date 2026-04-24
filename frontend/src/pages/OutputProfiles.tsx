import { useDeferredValue, useEffect, useState, type FormEvent } from 'react'
import {
  OutputProfilesApi,
  type OutputProfile,
  type OutputProfilePayload,
  type OutputProfilePriority,
  type OutputProfileRef,
  type OutputProfileRefType,
  type OutputProfileRuntimePreview,
  type OutputProfileSummary,
} from '../api/output-profiles'
import Markdown from '../components/Markdown'
import { IconEdit, IconPlus, IconRefresh, IconSearch, IconSparkle, IconTrash } from '../components/Icons'

type Notice = { type: 'success' | 'error'; message: string }

type Draft = {
  title: string
  description: string
  active: boolean
  isDefault: boolean
  priority: OutputProfilePriority
  modes: string
  tags: string
  cognitiveModels: string
  writingStyles: string
  materials: string
  instructions: string
  guardrails: string
  sampleOutput: string
}

const refTypes: OutputProfileRefType[] = ['memory', 'wiki', 'raw', 'resource', 'note', 'tag', 'freeform']

const emptyDraft: Draft = {
  title: '',
  description: '',
  active: true,
  isDefault: false,
  priority: 'normal',
  modes: 'analysis, essay',
  tags: '',
  cognitiveModels: '',
  writingStyles: '',
  materials: '',
  instructions: '',
  guardrails: '',
  sampleOutput: '',
}

const priorityLabels: Record<OutputProfilePriority, string> = {
  high: '高',
  normal: '中',
  low: '低',
}

function parseList(value: string) {
  return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))]
}

function parseRefs(value: string): OutputProfileRef[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [target = '', label = '', note = ''] = line.split('|').map((item) => item.trim())
      const colonIndex = target.indexOf(':')
      const rawType = colonIndex > 0 ? target.slice(0, colonIndex).trim() : 'freeform'
      const type = refTypes.includes(rawType as OutputProfileRefType)
        ? (rawType as OutputProfileRefType)
        : 'freeform'
      const ref = colonIndex > 0 ? target.slice(colonIndex + 1).trim() : target
      return { type, ref, label, note }
    })
}

function formatRefs(items: OutputProfileRef[]) {
  return items
    .map((item) => {
      const head = `${item.type}:${item.ref}`
      return [head, item.label, item.note].filter(Boolean).join(' | ')
    })
    .join('\n')
}

function toDraft(profile: OutputProfile): Draft {
  return {
    title: profile.title,
    description: profile.description,
    active: profile.active,
    isDefault: profile.isDefault,
    priority: profile.priority,
    modes: profile.modes.join(', '),
    tags: profile.tags.join(', '),
    cognitiveModels: formatRefs(profile.cognitiveModels),
    writingStyles: formatRefs(profile.writingStyles),
    materials: formatRefs(profile.materials),
    instructions: profile.instructions,
    guardrails: profile.guardrails.join('\n'),
    sampleOutput: profile.sampleOutput,
  }
}

function buildPayload(draft: Draft): OutputProfilePayload {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    active: draft.active,
    isDefault: draft.isDefault,
    priority: draft.priority,
    modes: parseList(draft.modes),
    tags: parseList(draft.tags),
    cognitiveModels: parseRefs(draft.cognitiveModels),
    writingStyles: parseRefs(draft.writingStyles),
    materials: parseRefs(draft.materials),
    instructions: draft.instructions.trim(),
    guardrails: parseList(draft.guardrails),
    sampleOutput: draft.sampleOutput.trim(),
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '')
    if (message) return message
  }
  return fallback
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function renderRefCount(label: string, items: OutputProfileRef[]) {
  return (
    <span>
      {label} {items.length}
    </span>
  )
}

export default function OutputProfiles() {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [summary, setSummary] = useState<OutputProfileSummary | null>(null)
  const [profiles, setProfiles] = useState<OutputProfile[]>([])
  const [preview, setPreview] = useState<OutputProfileRuntimePreview | null>(null)
  const [previewRequest, setPreviewRequest] = useState('')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const loadAll = async (keyword = deferredQuery, request = previewRequest) => {
    setLoading(true)
    try {
      const [summaryResult, profileResult, previewResult] = await Promise.all([
        OutputProfilesApi.summary(),
        OutputProfilesApi.list(keyword),
        OutputProfilesApi.runtimePreview(request),
      ])
      setSummary(summaryResult)
      setProfiles(profileResult)
      setPreview(previewResult)
      setNotice(null)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '输出配方加载失败') })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll(deferredQuery, previewRequest)
  }, [deferredQuery])

  const resetForm = () => {
    setEditingId(null)
    setDraft(emptyDraft)
    setShowForm(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = buildPayload(draft)
      const saved = editingId
        ? await OutputProfilesApi.update(editingId, payload)
        : await OutputProfilesApi.create(payload)
      setNotice({ type: 'success', message: `输出配方已保存：${saved.title}` })
      resetForm()
      await loadAll()
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '输出配方保存失败') })
    } finally {
      setSaving(false)
    }
  }

  const editProfile = (profile: OutputProfile) => {
    setEditingId(profile.id)
    setDraft(toDraft(profile))
    setShowForm(true)
  }

  const deleteProfile = async (profile: OutputProfile) => {
    if (!window.confirm(`删除输出配方“${profile.title}”？`)) return
    setDeletingId(profile.id)
    try {
      await OutputProfilesApi.delete(profile.id)
      setNotice({ type: 'success', message: `已删除输出配方：${profile.title}` })
      await loadAll()
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '输出配方删除失败') })
    } finally {
      setDeletingId(null)
    }
  }

  const refreshPreview = async () => {
    try {
      setPreview(await OutputProfilesApi.runtimePreview(previewRequest))
      setNotice(null)
    } catch (error) {
      setNotice({ type: 'error', message: getErrorMessage(error, '运行时预览失败') })
    }
  }

  return (
    <div className="page output-profiles-page">
      <header className="page-header">
        <div>
          <h1>输出配方</h1>
          <div className="muted">组合核心认知模型、写作风格和素材范围，形成可复用的输出方式。</div>
        </div>
        <div className="toolbar">
          <button className="chip" type="button" onClick={() => void loadAll()}>
            <IconRefresh size={14} /> 刷新
          </button>
          <button
            className="chip primary"
            type="button"
            onClick={() => {
              setDraft(emptyDraft)
              setEditingId(null)
              setShowForm(true)
            }}
          >
            <IconPlus size={14} /> 新建配方
          </button>
        </div>
      </header>

      {notice ? <div className={'banner' + (notice.type === 'error' ? ' error' : '')}>{notice.message}</div> : null}

      <div className="output-profile-stats">
        <div className="output-profile-stat"><span>全部</span><strong>{summary?.counts.total ?? 0}</strong></div>
        <div className="output-profile-stat"><span>启用</span><strong>{summary?.counts.active ?? 0}</strong></div>
        <div className="output-profile-stat"><span>默认</span><strong>{summary?.counts.defaultProfiles ?? 0}</strong></div>
        <div className="output-profile-stat"><span>高优先级</span><strong>{summary?.counts.highPriority ?? 0}</strong></div>
      </div>

      <div className="output-profile-layout">
        <main className="output-profile-main">
          <label className="memory-search output-profile-search">
            <IconSearch size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索配方、标签、素材引用" />
          </label>

          {showForm ? (
            <form className="output-profile-form memory-section" onSubmit={submit}>
              <div className="memory-section-head">
                <div>
                  <h2>{editingId ? '编辑输出配方' : '新建输出配方'}</h2>
                  <p>引用行格式：type:ref | 显示名 | 说明。type 可用 memory、wiki、raw、resource、note、tag、freeform。</p>
                </div>
                <div className="toolbar">
                  <button className="chip" type="button" onClick={resetForm}>取消</button>
                  <button className="chip primary" type="submit" disabled={saving || !draft.title.trim()}>
                    <IconEdit size={14} /> {saving ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>

              <div className="memory-form-grid">
                <label>
                  <span>标题</span>
                  <input className="settings-input" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
                </label>
                <label>
                  <span>优先级</span>
                  <select className="settings-input" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as OutputProfilePriority }))}>
                    <option value="high">高</option>
                    <option value="normal">中</option>
                    <option value="low">低</option>
                  </select>
                </label>
                <label className="memory-form-span-2">
                  <span>描述</span>
                  <input className="settings-input" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
                </label>
                <label>
                  <span>输出模式</span>
                  <input className="settings-input" value={draft.modes} onChange={(event) => setDraft((current) => ({ ...current, modes: event.target.value }))} />
                </label>
                <label>
                  <span>标签</span>
                  <input className="settings-input" value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} />
                </label>
              </div>

              <div className="output-profile-toggles">
                <label className="memory-toggle-row">
                  <span>启用后会进入运行时上下文</span>
                  <button
                    className={'switch' + (draft.active ? ' on' : '')}
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, active: !current.active }))}
                    aria-pressed={draft.active}
                  >
                    <span className="switch-thumb" />
                  </button>
                </label>
                <label className="memory-toggle-row">
                  <span>默认配方优先注入</span>
                  <button
                    className={'switch' + (draft.isDefault ? ' on' : '')}
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, isDefault: !current.isDefault }))}
                    aria-pressed={draft.isDefault}
                  >
                    <span className="switch-thumb" />
                  </button>
                </label>
              </div>

              <label>
                <span>组合说明</span>
                <textarea className="settings-input" rows={4} value={draft.instructions} onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))} />
              </label>
              <div className="output-profile-ref-grid">
                <label>
                  <span>核心认知模型</span>
                  <textarea className="settings-input" rows={6} value={draft.cognitiveModels} onChange={(event) => setDraft((current) => ({ ...current, cognitiveModels: event.target.value }))} />
                </label>
                <label>
                  <span>写作风格</span>
                  <textarea className="settings-input" rows={6} value={draft.writingStyles} onChange={(event) => setDraft((current) => ({ ...current, writingStyles: event.target.value }))} />
                </label>
                <label>
                  <span>素材范围</span>
                  <textarea className="settings-input" rows={6} value={draft.materials} onChange={(event) => setDraft((current) => ({ ...current, materials: event.target.value }))} />
                </label>
              </div>
              <label>
                <span>质量约束</span>
                <textarea className="settings-input" rows={4} value={draft.guardrails} onChange={(event) => setDraft((current) => ({ ...current, guardrails: event.target.value }))} />
              </label>
              <label>
                <span>偏好样例</span>
                <textarea className="settings-input" rows={5} value={draft.sampleOutput} onChange={(event) => setDraft((current) => ({ ...current, sampleOutput: event.target.value }))} />
              </label>
            </form>
          ) : null}

          <section className="output-profile-list">
            {loading && profiles.length === 0 ? <div className="memory-empty">加载中...</div> : null}
            {!loading && profiles.length === 0 ? <div className="memory-empty">暂无输出配方。</div> : null}
            {profiles.map((profile) => (
              <article key={profile.id} className={'output-profile-card' + (profile.active ? '' : ' inactive')}>
                <div className="memory-card-head">
                  <div>
                    <h3>{profile.title}</h3>
                    <div className="memory-card-meta">
                      <span>{profile.active ? '启用' : '停用'}</span>
                      {profile.isDefault ? <span>默认</span> : null}
                      <span>{priorityLabels[profile.priority]}优先级</span>
                      {profile.modes.map((mode) => <span key={mode}>{mode}</span>)}
                    </div>
                  </div>
                  <div className="memory-card-actions">
                    <button className="icon-btn ghost" type="button" title="编辑" onClick={() => editProfile(profile)}>
                      <IconEdit size={14} />
                    </button>
                    <button className="icon-btn ghost" type="button" title="删除" onClick={() => void deleteProfile(profile)} disabled={deletingId === profile.id}>
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
                {profile.description ? <p className="output-profile-desc">{profile.description}</p> : null}
                {profile.instructions ? <div className="output-profile-instructions">{profile.instructions}</div> : null}
                <div className="memory-card-meta">
                  {renderRefCount('模型', profile.cognitiveModels)}
                  {renderRefCount('文风', profile.writingStyles)}
                  {renderRefCount('素材', profile.materials)}
                  <span>更新 {formatTime(profile.updatedAt)}</span>
                </div>
                {profile.tags.length > 0 ? (
                  <div className="memory-tags">
                    {profile.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                  </div>
                ) : null}
              </article>
            ))}
          </section>
        </main>

        <aside className="output-profile-side">
          <section className="memory-section">
            <div className="memory-section-head">
              <div>
                <h2>运行时预览</h2>
                <p>查看当前请求下会注入给大模型的输出配方上下文。</p>
              </div>
            </div>
            <div className="memory-preview-form">
              <textarea className="settings-input" rows={4} value={previewRequest} onChange={(event) => setPreviewRequest(event.target.value)} placeholder="输入一个输出请求" />
              <button className="chip primary" type="button" onClick={() => void refreshPreview()}>
                <IconSparkle size={14} /> 预览
              </button>
            </div>
            <div className="output-profile-preview">
              {preview?.rendered ? <Markdown text={preview.rendered} /> : <div className="memory-empty">没有启用的输出配方。</div>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
