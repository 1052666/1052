import { useEffect, useState, useCallback } from 'react'
import { PkmApi, type PkmSummary, type PkmSearchResponse, type PkmThesaurusEntry, type PkmSop, type PkmCategory, type PkmSource } from '../api/pkm'

const CATEGORIES: { value: PkmCategory; label: string }[] = [
  { value: 'knowledge', label: '知识' },
  { value: 'experience', label: '经验' },
  { value: 'skill', label: '技能' },
  { value: 'memory', label: '记忆' },
  { value: 'resource', label: '资源' },
  { value: 'action', label: '行动' },
]

const SOURCES: { value: PkmSource; label: string }[] = [
  { value: 'wiki', label: 'Wiki' },
  { value: 'memory', label: '记忆' },
  { value: 'skill', label: '技能' },
  { value: 'resource', label: '资源' },
  { value: 'calendar-event', label: '日历事件' },
  { value: 'calendar-task', label: '定时任务' },
]

const SOURCE_COLORS: Record<string, string> = {
  wiki: '#4f46e5',
  memory: '#059669',
  skill: '#d97706',
  resource: '#dc2626',
  'calendar-event': '#7c3aed',
  'calendar-task': '#db2777',
}

type TabKey = 'search' | 'thesaurus' | 'sop'

export default function Pkm() {
  const [summary, setSummary] = useState<PkmSummary | null>(null)
  const [tab, setTab] = useState<TabKey>('search')
  const [loading, setLoading] = useState(false)

  // Search state
  const [expression, setExpression] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<PkmCategory[]>([])
  const [selectedSources, setSelectedSources] = useState<PkmSource[]>([])
  const [searchResponse, setSearchResponse] = useState<PkmSearchResponse | null>(null)
  const [searching, setSearching] = useState(false)

  // Thesaurus state
  const [thesaurusEntries, setThesaurusEntries] = useState<PkmThesaurusEntry[]>([])
  const [newTerm, setNewTerm] = useState('')
  const [newSynonyms, setNewSynonyms] = useState('')
  const [thesaurusFilter, setThesaurusFilter] = useState('')
  const [savingThesaurus, setSavingThesaurus] = useState(false)

  // SOP state
  const [storeSop, setStoreSop] = useState<PkmSop | null>(null)
  const [retrieveSop, setRetrieveSop] = useState<PkmSop | null>(null)
  const [sopTab, setSopTab] = useState<'store' | 'retrieve'>('store')

  useEffect(() => {
    PkmApi.getSummary().then(setSummary).catch(() => {})
  }, [])

  const handleSearch = useCallback(async () => {
    if (!expression.trim()) return
    setSearching(true)
    try {
      const res = await PkmApi.search(
        expression,
        selectedCategories.length > 0 ? selectedCategories : undefined,
        selectedSources.length > 0 ? selectedSources : undefined,
      )
      setSearchResponse(res)
    } catch {
      setSearchResponse(null)
    } finally {
      setSearching(false)
    }
  }, [expression, selectedCategories, selectedSources])

  const handleReindex = useCallback(async () => {
    setLoading(true)
    try {
      const result = await PkmApi.reindex()
      const s = await PkmApi.getSummary()
      setSummary(s)
      alert(`索引重建完成，共 ${result.totalEntries} 条`)
    } catch {
      alert('重建索引失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadThesaurus = useCallback(async () => {
    try {
      const entries = await PkmApi.listThesaurus()
      setThesaurusEntries(entries)
    } catch {}
  }, [])

  const handleSaveThesaurus = useCallback(async () => {
    if (!newTerm.trim()) return
    setSavingThesaurus(true)
    try {
      await PkmApi.upsertThesaurus(
        newTerm.trim(),
        newSynonyms.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      )
      setNewTerm('')
      setNewSynonyms('')
      await loadThesaurus()
    } catch {
      alert('保存失败')
    } finally {
      setSavingThesaurus(false)
    }
  }, [newTerm, newSynonyms, loadThesaurus])

  const handleDeleteThesaurus = useCallback(async (term: string) => {
    if (!confirm(`确定删除词条"${term}"？`)) return
    try {
      await PkmApi.deleteThesaurus(term)
      await loadThesaurus()
    } catch {}
  }, [loadThesaurus])

  useEffect(() => {
    if (tab === 'thesaurus') loadThesaurus()
    if (tab === 'sop') {
      PkmApi.getStoreSop().then(setStoreSop).catch(() => {})
      PkmApi.getRetrieveSop().then(setRetrieveSop).catch(() => {})
    }
  }, [tab, loadThesaurus])

  const toggleCategory = (cat: PkmCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    )
  }

  const toggleSource = (src: PkmSource) => {
    setSelectedSources((prev) =>
      prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src],
    )
  }

  const filteredThesaurus = thesaurusEntries.filter(
    (e) => !thesaurusFilter || e.term.includes(thesaurusFilter) || e.synonyms.some((s) => s.includes(thesaurusFilter)),
  )

  return (
    <div className="pkm-page">
      <div className="pkm-header">
        <h1>PKM 知识管理</h1>
        <div className="pkm-header-actions">
          {summary && (
            <span className="pkm-summary-badge">
              {summary.totalEntries} 条 | {summary.thesaurusSize} 词
            </span>
          )}
          <button className="btn btn-secondary" onClick={handleReindex} disabled={loading}>
            {loading ? '重建中...' : '重建索引'}
          </button>
        </div>
      </div>

      <div className="pkm-tabs">
        <button className={`pkm-tab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
          搜索
        </button>
        <button className={`pkm-tab ${tab === 'thesaurus' ? 'active' : ''}`} onClick={() => setTab('thesaurus')}>
          词表管理
        </button>
        <button className={`pkm-tab ${tab === 'sop' ? 'active' : ''}`} onClick={() => setTab('sop')}>
          SOP 引导
        </button>
      </div>

      {tab === 'search' && (
        <div className="pkm-search-panel">
          <div className="pkm-search-bar">
            <input
              type="text"
              className="pkm-search-input"
              placeholder="输入搜索表达式（支持 AND OR NOT 和引号精确匹配）"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button className="btn btn-primary" onClick={handleSearch} disabled={searching}>
              {searching ? '搜索中...' : '搜索'}
            </button>
          </div>

          <div className="pkm-filters">
            <div className="pkm-filter-group">
              <span className="pkm-filter-label">分类:</span>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  className={`pkm-chip ${selectedCategories.includes(cat.value) ? 'active' : ''}`}
                  onClick={() => toggleCategory(cat.value)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <div className="pkm-filter-group">
              <span className="pkm-filter-label">来源:</span>
              {SOURCES.map((src) => (
                <button
                  key={src.value}
                  className={`pkm-chip ${selectedSources.includes(src.value) ? 'active' : ''}`}
                  onClick={() => toggleSource(src.value)}
                >
                  {src.label}
                </button>
              ))}
            </div>
          </div>

          {searchResponse && (
            <div className="pkm-results">
              <div className="pkm-results-header">
                <span>共 {searchResponse.total} 条结果</span>
                {searchResponse.fallbackUsed && (
                  <span className="pkm-fallback-hint">
                    已使用{searchResponse.fallbackUsed === 'prefix' ? '前缀匹配' : '模糊搜索'}兜底
                  </span>
                )}
              </div>
              {searchResponse.results.map((result) => (
                <div key={result.entry.id} className="pkm-result-card">
                  <div className="pkm-result-header">
                    <span
                      className="pkm-source-badge"
                      style={{ backgroundColor: SOURCE_COLORS[result.entry.source] ?? '#6b7280' }}
                    >
                      {result.sourceLabel}
                    </span>
                    <span className="pkm-score">
                      {'★'.repeat(Math.min(5, Math.ceil(result.score / 3)))}
                    </span>
                    <span className="pkm-category-badge">{result.entry.category}</span>
                  </div>
                  <div className="pkm-result-title">{result.entry.title}</div>
                  <div className="pkm-result-summary">{result.entry.summary.slice(0, 200)}</div>
                  {result.matches.length > 0 && (
                    <div className="pkm-result-matches">
                      {result.matches.map((m, i) => (
                        <span key={i} className="pkm-match-snippet">
                          [{m.field}] {m.snippet}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="pkm-result-footer">
                    {result.entry.tags.length > 0 && (
                      <div className="pkm-result-tags">
                        {result.entry.tags.slice(0, 5).map((tag) => (
                          <span key={tag} className="pkm-tag">{tag}</span>
                        ))}
                      </div>
                    )}
                    <a href={result.navigateUrl} className="pkm-result-link" target="_blank" rel="noopener noreferrer">
                      查看原文
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'thesaurus' && (
        <div className="pkm-thesaurus-panel">
          <div className="pkm-thesaurus-form">
            <input
              type="text"
              className="pkm-input"
              placeholder="词条"
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
            />
            <input
              type="text"
              className="pkm-input"
              placeholder="同义词（逗号分隔）"
              value={newSynonyms}
              onChange={(e) => setNewSynonyms(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleSaveThesaurus} disabled={savingThesaurus}>
              {savingThesaurus ? '保存中...' : '添加/更新'}
            </button>
          </div>
          <input
            type="text"
            className="pkm-input pkm-thesaurus-filter"
            placeholder="搜索词条..."
            value={thesaurusFilter}
            onChange={(e) => setThesaurusFilter(e.target.value)}
          />
          <div className="pkm-thesaurus-list">
            {filteredThesaurus.map((entry) => (
              <div key={entry.term} className="pkm-thesaurus-item">
                <div className="pkm-thesaurus-term">{entry.term}</div>
                <div className="pkm-thesaurus-synonyms">
                  {entry.synonyms.map((s) => (
                    <span key={s} className="pkm-tag">{s}</span>
                  ))}
                </div>
                <div className="pkm-thesaurus-meta">
                  <span className="pkm-category-badge">{entry.category}</span>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDeleteThesaurus(entry.term)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
            {filteredThesaurus.length === 0 && (
              <div className="pkm-empty">暂无词表数据</div>
            )}
          </div>
        </div>
      )}

      {tab === 'sop' && (
        <div className="pkm-sop-panel">
          <div className="pkm-sop-tabs">
            <button
              className={`pkm-tab ${sopTab === 'store' ? 'active' : ''}`}
              onClick={() => setSopTab('store')}
            >
              存储引导
            </button>
            <button
              className={`pkm-tab ${sopTab === 'retrieve' ? 'active' : ''}`}
              onClick={() => setSopTab('retrieve')}
            >
              检索引导
            </button>
          </div>
          {(sopTab === 'store' ? storeSop : retrieveSop)?.steps.map((step, i) => (
            <div key={i} className="pkm-sop-card">
              <div className="pkm-sop-card-header">
                <span className="pkm-sop-step-number">{i + 1}</span>
                <h3>{step.title}</h3>
              </div>
              <p className="pkm-sop-description">{step.description}</p>
              {step.tips.length > 0 && (
                <ul className="pkm-sop-tips">
                  {step.tips.map((tip, j) => (
                    <li key={j}>{tip}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
