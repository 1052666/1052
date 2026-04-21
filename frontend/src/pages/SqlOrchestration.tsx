import { useEffect, useRef, useState, useCallback } from 'react'
import { OrchestrationApi, type Orchestration, type OrchestrationNode, type OrchestrationExecution, type LogEntry } from '../api/orchestration'
import { SqlApi, type DataSource, type SqlFile } from '../api/sql'

const NODE_W = 280
const PORT_Y = 36
const THRESHOLD_OPTIONS = [
  { value: 'eq', label: '= 等于' }, { value: 'ne', label: '!= 不等于' },
  { value: 'gt', label: '> 大于' }, { value: 'gte', label: '>= 大于等于' },
  { value: 'lt', label: '< 小于' }, { value: 'lte', label: '<= 小于等于' },
]
function nid() { return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }
function eid() { return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }

export default function SqlOrchestration() {
  const [orchestrations, setOrchestrations] = useState<Orchestration[]>([])
  const [datasources, setDatasources] = useState<DataSource[]>([])
  const [sqlFiles, setSqlFiles] = useState<SqlFile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Orchestration | null>(null)
  const [saving, setSaving] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [execution, setExecution] = useState<OrchestrationExecution | null>(null)
  const [error, setError] = useState('')
  const logPanelRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  // connection state
  const [connecting, setConnecting] = useState<string | null>(null) // source node id
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [dragInfo, setDragInfo] = useState<{ nodeId: string; ox: number; oy: number } | null>(null)

  const load = async () => {
    try {
      const [orchs, ds, files] = await Promise.all([OrchestrationApi.list(), SqlApi.listDataSources(), SqlApi.listSqlFiles()])
      setOrchestrations(orchs); setDatasources(ds); setSqlFiles(files)
    } catch { setError('加载数据失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (execution && logPanelRef.current) logPanelRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [execution])

  // ─── Node / Edge helpers ──────────────────────────────

  const updateEditing = (updates: Partial<Orchestration>) => {
    if (!editing) return
    setEditing({ ...editing, ...updates })
  }
  const updateNode = (nodeId: string, updates: Partial<OrchestrationNode>) => {
    if (!editing) return
    updateEditing({ nodes: editing.nodes.map(n => n.id === nodeId ? { ...n, ...updates } : n) })
  }
  const addNode = (type: 'sql' | 'debug' | 'load' | 'wait') => {
    if (!editing) return
    const offset = editing.nodes.length * 60
    const nameMap: Record<string, string> = { sql: 'SQL 节点', debug: 'Debug 节点', load: '加载节点', wait: 'Wait 节点' }
    const node: OrchestrationNode = {
      id: nid(), name: nameMap[type], type,
      datasourceId: '', sql: '', enabled: true, position: { x: 60 + offset, y: 80 + offset },
      ...(type === 'load' ? { targetDatasourceId: '', targetTable: '', mode: 'insert' as const } : {}),
      ...(type === 'wait' ? { waitIntervalSec: 60, waitTimeoutSec: 1800, waitStableCount: 2 } : {}),
    }
    updateEditing({ nodes: [...editing.nodes, node] })
  }
  const removeNode = (nodeId: string) => {
    if (!editing) return
    updateEditing({
      nodes: editing.nodes.filter(n => n.id !== nodeId),
      edges: editing.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
    })
  }
  const addEdge = (source: string, target: string) => {
    if (!editing) return
    if (source === target) return
    if (editing.edges.some(e => e.source === source && e.target === target)) return
    updateEditing({ edges: [...editing.edges, { id: eid(), source, target }] })
  }
  const removeEdge = (edgeId: string) => {
    if (!editing) return
    updateEditing({ edges: editing.edges.filter(e => e.id !== edgeId) })
  }
  const importSqlFile = (nodeId: string, fileId: string) => {
    const file = sqlFiles.find(f => f.id === fileId)
    if (file) updateNode(nodeId, { sql: file.content, datasourceId: file.datasourceId, sqlFileId: fileId })
  }

  // ─── Drag ─────────────────────────────────────────────

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + canvasRef.current.scrollLeft
    const y = e.clientY - rect.top + canvasRef.current.scrollTop
    if (dragInfo) {
      updateNode(dragInfo.nodeId, { position: { x: x - dragInfo.ox, y: y - dragInfo.oy } })
    }
    if (connecting) setMousePos({ x, y })
  }, [dragInfo, connecting])

  const handleCanvasMouseUp = useCallback(() => {
    setDragInfo(null)
  }, [])

  const startDrag = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const node = editing?.nodes.find(n => n.id === nodeId)
    if (!node?.position) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left + canvasRef.current!.scrollLeft
    const my = e.clientY - rect.top + canvasRef.current!.scrollTop
    setDragInfo({ nodeId, ox: mx - node.position.x, oy: my - node.position.y })
  }

  // ─── Save / Execute ───────────────────────────────────

  const handleSave = async () => {
    if (!editing) return
    setSaving(true); setError('')
    try {
      if (editing.id) {
        const u = await OrchestrationApi.update(editing.id, editing); setEditing(u)
      } else {
        const c = await OrchestrationApi.create({ name: editing.name, description: editing.description })
        const u = await OrchestrationApi.update(c.id, { nodes: editing.nodes, edges: editing.edges })
        setEditing(u)
      }
      await load()
    } catch { setError('保存失败') }
    finally { setSaving(false) }
  }

  const handleExecute = async () => {
    if (!editing?.id) return
    try { await OrchestrationApi.update(editing.id, editing) } catch { /* */ }
    setExecuting(true); setExecution(null); setError('')
    try {
      const { executionId } = await OrchestrationApi.execute(editing.id)
      while (true) {
        const p = await OrchestrationApi.progress(editing.id, executionId)
        setExecution({
          id: executionId, orchestrationId: editing.id, orchestrationName: editing.name,
          status: p.status, logs: p.logs, startTime: p.startTime, endTime: p.endTime,
        })
        if (p.status !== 'running') break
        await new Promise(r => setTimeout(r, 1000))
      }
      const final = await OrchestrationApi.progress(editing.id, executionId)
      setExecution({
        id: executionId, orchestrationId: editing.id, orchestrationName: editing.name,
        status: final.status, logs: final.logs, startTime: final.startTime, endTime: final.endTime ?? Date.now(),
      })
      if (final.status === 'failed') setError('编排执行失败')
      else if (final.status === 'warning') setError('编排执行完成，但有阈值警告')
    } catch (e) { setError(e instanceof Error ? e.message : '执行失败') }
    finally { setExecuting(false) }
  }

  const handleStop = async () => {
    if (!editing?.id) return
    try {
      await OrchestrationApi.stop(editing.id)
      setError('正在停止...')
    } catch { setError('停止失败') }
  }

  const handleDelete = async (id: string) => {
    try { await OrchestrationApi.delete(id); if (editing?.id === id) setEditing(null); await load() }
    catch { setError('删除失败') }
  }

  // ─── SVG path for edge ────────────────────────────────

  const edgePath = (src: OrchestrationNode, tgt: OrchestrationNode) => {
    const x1 = (src.position?.x ?? 0) + NODE_W
    const y1 = (src.position?.y ?? 0) + PORT_Y
    const x2 = tgt.position?.x ?? 0
    const y2 = (tgt.position?.y ?? 0) + PORT_Y
    const cx = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`
  }

  const tempPath = () => {
    if (!connecting || !editing) return null
    const src = editing.nodes.find(n => n.id === connecting)
    if (!src?.position) return null
    const x1 = src.position.x + NODE_W
    const y1 = src.position.y + PORT_Y
    const cx = (x1 + mousePos.x) / 2
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${mousePos.y}, ${mousePos.x} ${mousePos.y}`
  }

  // ─── Render ───────────────────────────────────────────

  if (loading) return <div className="page"><p>加载中...</p></div>

  if (editing) return (
    <div className="page orch-editor-page" onMouseUp={handleCanvasMouseUp}>
      <div className="orch-page-header">
        <div className="page-header-left">
          <button className="chip" onClick={() => { setEditing(null); setExecution(null); setError('') }}>&larr; 返回</button>
          <input className="orch-name-input" type="text" placeholder="编排名称" value={editing.name}
            onChange={e => updateEditing({ name: e.target.value })} />
        </div>
        <div className="page-header-right">
          <button className="chip" onClick={() => addNode('sql')}>+ SQL</button>
          <button className="chip" onClick={() => addNode('debug')}>+ Debug</button>
          <button className="chip" onClick={() => addNode('load')}>+ 加载</button>
          <button className="chip" onClick={() => addNode('wait')}>+ Wait</button>
          <button className="chip primary" onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
          {editing.id && !executing && <button className="chip accent" onClick={handleExecute}>执行</button>}
          {editing.id && executing && <button className="chip danger" onClick={handleStop}>停止</button>}
        </div>
      </div>
      {error && <div className="orch-error">{error}</div>}

      {/* Canvas */}
      <div className="orch-canvas" ref={canvasRef} onMouseMove={handleCanvasMouseMove}
        onClick={e => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('orch-canvas-svg')) setConnecting(null) }}>
        <svg className="orch-canvas-svg">
          {editing.edges.map(edge => {
            const src = editing.nodes.find(n => n.id === edge.source)
            const tgt = editing.nodes.find(n => n.id === edge.target)
            if (!src?.position || !tgt?.position) return null
            return (
              <g key={edge.id} className="orch-edge-group" onClick={() => removeEdge(edge.id)}>
                <path d={edgePath(src, tgt)} stroke="var(--accent)" strokeWidth={8} fill="none" opacity={0} />
                <path d={edgePath(src, tgt)} stroke="var(--accent)" strokeWidth={2} fill="none" className="orch-edge-line" />
                <circle cx={tgt.position.x} cy={tgt.position.y + PORT_Y} r={4} fill="var(--accent)" />
              </g>
            )
          })}
          {connecting && tempPath() && (
            <path d={tempPath()!} stroke="var(--accent)" strokeWidth={2} fill="none" strokeDasharray="6 3" opacity={0.6} />
          )}
        </svg>
        <div className="orch-canvas-nodes">
          {editing.nodes.map(node => (
            <div key={node.id}
              className={`orch-flow-node ${node.type} ${!node.enabled ? 'disabled' : ''} ${connecting && connecting !== node.id ? 'connect-target' : ''}`}
              style={{ left: node.position?.x ?? 0, top: node.position?.y ?? 0, width: NODE_W }}
            >
              {/* Input port */}
              <div className={`node-port input ${connecting ? 'highlight' : ''}`}
                onClick={e => { e.stopPropagation(); if (connecting && connecting !== node.id) { addEdge(connecting, node.id); setConnecting(null) } }}
              />
              {/* Drag handle */}
              <div className="flow-node-header" onMouseDown={e => startDrag(node.id, e)}>
                <span className={`orch-node-type-badge ${node.type}`}>{node.type === 'sql' ? 'SQL' : node.type === 'debug' ? 'Debug' : node.type === 'wait' ? 'Wait' : '加载'}</span>
                <input className="flow-node-name" value={node.name} onChange={e => updateNode(node.id, { name: e.target.value })} onClick={e => e.stopPropagation()} />
                <button className={`chip small ${node.enabled ? '' : 'inactive'}`} onClick={e => { e.stopPropagation(); updateNode(node.id, { enabled: !node.enabled }) }}>
                  {node.enabled ? '开' : '关'}
                </button>
                <button className="chip small danger" onClick={e => { e.stopPropagation(); removeNode(node.id) }}>x</button>
              </div>
              <div className="flow-node-body">
                <div className="flow-node-row">
                  <select value={node.datasourceId} onChange={e => updateNode(node.id, { datasourceId: e.target.value })} onClick={e => e.stopPropagation()}>
                    <option value="">数据源</option>
                    {datasources.map(ds => <option key={ds.id} value={ds.id}>{ds.name}</option>)}
                  </select>
                  <select value="" onChange={e => { if (e.target.value) importSqlFile(node.id, e.target.value) }} onClick={e => e.stopPropagation()}>
                    <option value="">导入SQL文件</option>
                    {sqlFiles.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <textarea placeholder={node.type === 'debug' || node.type === 'wait' ? 'SELECT COUNT(*) ...' : 'SELECT col1, col2 FROM ...'} value={node.sql}
                  onChange={e => updateNode(node.id, { sql: e.target.value })} rows={2} onClick={e => e.stopPropagation()} />
                {node.type === 'load' && (
                  <div className="flow-node-load-config">
                    <div className="flow-node-row">
                      <label>目标数据源</label>
                      <select value={node.targetDatasourceId || ''} onChange={e => updateNode(node.id, { targetDatasourceId: e.target.value })} onClick={e => e.stopPropagation()}>
                        <option value="">选择目标</option>
                        {datasources.map(ds => <option key={ds.id} value={ds.id}>{ds.name}</option>)}
                      </select>
                    </div>
                    <div className="flow-node-row">
                      <label>目标表</label>
                      <input type="text" placeholder="table_name" value={node.targetTable || ''}
                        onChange={e => updateNode(node.id, { targetTable: e.target.value })} onClick={e => e.stopPropagation()} />
                    </div>
                    <div className="flow-node-row">
                      <label>写入模式</label>
                      <select value={node.mode || 'insert'} onChange={e => updateNode(node.id, { mode: e.target.value as 'insert' | 'replace' | 'truncate_insert' })} onClick={e => e.stopPropagation()}>
                        <option value="insert">INSERT 追加</option>
                        <option value="replace">REPLACE 替换</option>
                        <option value="truncate_insert">清空+INSERT</option>
                      </select>
                    </div>
                    <div className="flow-node-mapping-section">
                      <div className="flow-node-row">
                        <label>分区字段</label>
                        <input type="text" placeholder="如: dt, region (逗号分隔)" value={node.partitionColumns || ''}
                          onChange={e => updateNode(node.id, { partitionColumns: e.target.value })} onClick={e => e.stopPropagation()} />
                      </div>
                      <div className="flow-node-mapping-header">
                        <label>字段映射</label>
                        <button className="chip small" onClick={e => {
                          e.stopPropagation()
                          const current = node.columnMappings || []
                          updateNode(node.id, { columnMappings: [...current, { source: '', target: '' }] })
                        }}>+ 添加</button>
                      </div>
                      {(node.columnMappings || []).length === 0 && (
                        <div className="flow-node-mapping-hint">未配置时按同名自动映射，分区字段自动排末尾</div>
                      )}
                      {(node.columnMappings || []).map((m, idx) => (
                        <div key={idx} className={`flow-node-mapping-row ${m.isPartition ? 'partition' : ''}`}>
                          <input type="text" placeholder="源字段" value={m.source}
                            onChange={e => {
                              const mappings = [...(node.columnMappings || [])]
                              mappings[idx] = { ...mappings[idx], source: e.target.value }
                              updateNode(node.id, { columnMappings: mappings })
                            }} onClick={e => e.stopPropagation()} />
                          <span className="flow-node-mapping-arrow">&rarr;</span>
                          <input type="text" placeholder="目标字段" value={m.target}
                            onChange={e => {
                              const mappings = [...(node.columnMappings || [])]
                              mappings[idx] = { ...mappings[idx], target: e.target.value }
                              updateNode(node.id, { columnMappings: mappings })
                            }} onClick={e => e.stopPropagation()} />
                          <button className={`chip small ${m.isPartition ? 'accent' : ''}`} title="分区字段"
                            onClick={e => {
                              e.stopPropagation()
                              const mappings = [...(node.columnMappings || [])]
                              mappings[idx] = { ...mappings[idx], isPartition: !mappings[idx].isPartition }
                              updateNode(node.id, { columnMappings: mappings })
                            }}>P</button>
                          <button className="chip small danger" onClick={e => {
                            e.stopPropagation()
                            const mappings = (node.columnMappings || []).filter((_, i) => i !== idx)
                            updateNode(node.id, { columnMappings: mappings })
                          }}>x</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {node.type === 'debug' && (
                  <div className="flow-node-threshold">
                    <label className="flow-node-threshold-label">阈值检查</label>
                    <div className="flow-node-threshold-row">
                      <select value={node.thresholdOperator || ''} onChange={e => updateNode(node.id, { thresholdOperator: e.target.value as OrchestrationNode['thresholdOperator'] })} onClick={e => e.stopPropagation()}>
                        <option value="">不检查</option>
                        {THRESHOLD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <input type="text" placeholder="期望值" value={node.thresholdValue || ''}
                        onChange={e => updateNode(node.id, { thresholdValue: e.target.value })} onClick={e => e.stopPropagation()} />
                    </div>
                  </div>
                )}
                {node.type === 'wait' && (
                  <div className="flow-node-wait-config">
                    <div className="flow-node-threshold">
                      <label className="flow-node-threshold-label">阈值检查</label>
                      <div className="flow-node-threshold-row">
                        <select value={node.thresholdOperator || ''} onChange={e => updateNode(node.id, { thresholdOperator: e.target.value as OrchestrationNode['thresholdOperator'] })} onClick={e => e.stopPropagation()}>
                          <option value="">不检查</option>
                          {THRESHOLD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <input type="text" placeholder="期望值" value={node.thresholdValue || ''}
                          onChange={e => updateNode(node.id, { thresholdValue: e.target.value })} onClick={e => e.stopPropagation()} />
                      </div>
                    </div>
                    <div className="flow-node-row">
                      <label>轮询间隔(秒)</label>
                      <input type="number" min={5} value={node.waitIntervalSec || 60}
                        onChange={e => updateNode(node.id, { waitIntervalSec: Number(e.target.value) })} onClick={e => e.stopPropagation()} />
                    </div>
                    <div className="flow-node-row">
                      <label>超时(秒)</label>
                      <input type="number" min={10} value={node.waitTimeoutSec || 1800}
                        onChange={e => updateNode(node.id, { waitTimeoutSec: Number(e.target.value) })} onClick={e => e.stopPropagation()} />
                    </div>
                    <div className="flow-node-row">
                      <label>稳定次数</label>
                      <input type="number" min={2} value={node.waitStableCount || 2}
                        onChange={e => updateNode(node.id, { waitStableCount: Number(e.target.value) })} onClick={e => e.stopPropagation()} />
                    </div>
                  </div>
                )}
              </div>
              {/* Output port */}
              <div className="node-port output"
                onClick={e => { e.stopPropagation(); setConnecting(connecting === node.id ? null : node.id) }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Log panel */}
      {execution && (
        <div className="orch-log-panel" ref={logPanelRef}>
          <div className="orch-log-header">
            <h3>执行日志</h3>
            <span className={`orch-status-badge ${execution.status}`}>
              {execution.status === 'success' ? '成功' : execution.status === 'failed' ? '失败' : execution.status === 'running' ? '执行中' : '警告'}
            </span>
            {execution.endTime ? <span className="orch-log-duration">{((execution.endTime - execution.startTime) / 1000).toFixed(1)}s</span> : <span className="orch-log-duration">执行中...</span>}
          </div>
          <div className="orch-log-entries">
            {execution.logs.map(log => <LogEntryCard key={log.nodeId} log={log} />)}
          </div>
        </div>
      )}
    </div>
  )

  // ─── List view ────────────────────────────────────────
  return (
    <div className="page">
      <div className="orch-page-header">
        <h1>SQL 编排</h1>
        <button className="chip primary"
          onClick={() => setEditing({ id: '', name: '', description: '', nodes: [], edges: [], createdAt: 0, updatedAt: 0 })}>
          + 新建编排
        </button>
      </div>
      {orchestrations.length === 0 ? (
        <div className="sql-var-empty card"><p>暂无编排</p></div>
      ) : (
        <div className="orch-list">
          {orchestrations.map(orch => (
            <div key={orch.id} className="orch-card card">
              <div className="orch-card-header">
                <h3>{orch.name}</h3>
                <span className="orch-node-count">{orch.nodes.length} 节点</span>
              </div>
              {orch.description && <p className="orch-card-desc">{orch.description}</p>}
              <div className="orch-card-nodes">
                {orch.nodes.map(node => <span key={node.id} className={`orch-mini-node ${node.type}`}>{node.name}</span>)}
              </div>
              <div className="orch-card-actions">
                <button className="chip" onClick={() => { setEditing(orch); setExecution(null); setError('') }}>编辑</button>
                <button className="chip danger" onClick={() => handleDelete(orch.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Log Entry ──────────────────────────────────────────────

function LogEntryCard({ log }: { log: LogEntry }) {
  const [expanded, setExpanded] = useState(true)
  const icons: Record<string, string> = { success: '\u2713', failed: '\u2717', warning: '\u26A0', skipped: '\u2014', running: '\u23F3' }
  return (
    <div className={`orch-log-entry ${log.status}`} onClick={() => setExpanded(!expanded)}>
      <div className="orch-log-entry-header">
        <span className={`orch-log-status-icon ${log.status === 'running' ? 'spin' : ''}`}>{icons[log.status]}</span>
        <span className="orch-log-node-name">{log.nodeName}</span>
        <span className={`orch-node-type-badge small ${log.nodeType}`}>{log.nodeType === 'sql' ? 'SQL' : log.nodeType === 'debug' ? 'Debug' : log.nodeType === 'load' ? '加载' : '等待'}</span>
        <span className="orch-log-duration">{log.status === 'running' ? '等待中...' : `${(log.duration / 1000).toFixed(2)}s`}</span>
        {log.nodeType === 'debug' && log.thresholdPassed !== undefined && (
          <span className={`orch-threshold-result ${log.thresholdPassed ? 'pass' : 'fail'}`}>
            {log.thresholdPassed ? '通过' : '未通过'}
          </span>
        )}
      </div>
      {expanded && (
        <div className="orch-log-entry-body">
          <div className="orch-log-sql"><label>SQL:</label><code>{log.sql}</code></div>
          {log.affectedRows !== undefined && <div className="orch-log-detail"><label>影响行数:</label><span>{log.affectedRows}</span></div>}
          {log.result && (
            <div className="orch-log-detail"><label>结果:</label>
              <div className="orch-log-result-table"><table>
                <thead><tr>{log.result.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{log.result.rows.map((row, i) => <tr key={i}>{log.result!.columns.map(c => <td key={c}>{String(row[c] ?? '')}</td>)}</tr>)}</tbody>
              </table></div>
            </div>
          )}
          {log.nodeType === 'debug' && log.actualValue !== undefined && (
            <div className="orch-log-detail">
              <label>实际值:</label><span>{log.actualValue}</span>
              {log.expectedValue !== undefined && <><span className="orch-log-sep">|</span><label>期望:</label><span>{log.expectedValue}</span></>}
            </div>
          )}
          {log.nodeType === 'wait' && log.actualValue !== undefined && (
            <div className="orch-log-detail">
              <label>数据条数:</label><span>{log.actualValue}</span>
              {log.expectedValue !== undefined && <><span className="orch-log-sep">|</span><span>{log.expectedValue}</span></>}
            </div>
          )}
          {log.error && <div className="orch-log-error"><label>错误:</label><span>{log.error}</span></div>}
        </div>
      )}
    </div>
  )
}
