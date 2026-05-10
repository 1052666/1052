import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as unzipper from 'unzipper'
import { config } from '../../config.js'
import { httpError } from '../../http-error.js'
import type {
  GitHubCommitResponse,
  PendingUpdate,
  UpdateCommitInfo,
  UpdateInstallInput,
  UpdateInstallMode,
  UpdateRestartResponse,
  UpdateRun,
  UpdateStatus,
} from './updates.types.js'

const REPO_OWNER = '1052666'
const REPO_NAME = '1052-OS'
const REPO_BRANCH = 'main'
const GITHUB_API_COMMIT_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/${REPO_BRANCH}`
const GITHUB_ZIP_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${REPO_BRANCH}.zip`
const UPDATER_DIR = path.join(config.dataDir, 'updater')
const RUNS_DIR = path.join(UPDATER_DIR, 'runs')
const DOWNLOAD_DIR = path.join(UPDATER_DIR, 'downloads')
const EXTRACT_DIR = path.join(UPDATER_DIR, 'extract')
const BACKUP_DIR = path.join(config.dataDir, 'update-backups')
const LOG_DIR = path.join(config.dataDir, 'logs')
const STAGED_DIR = path.join(UPDATER_DIR, 'staged')
const STATE_FILE = path.join(UPDATER_DIR, 'state.json')
const PENDING_FILE = path.join(UPDATER_DIR, 'pending-update.json')
const INSTALL_BLOCKLIST = new Set([
  '.git',
  '.env',
  '.env.local',
  'AGENTS.md',
  'CHANGELOG.md',
  'data',
  'dist',
  'node_modules',
])
const PRESERVED_APP_CHILDREN = new Set([
  '.env',
  '.env.local',
  '.env.development.local',
  '.env.production.local',
  'dist',
  'node_modules',
])
const LOG_TAIL_LIMIT = 12000

type StoredUpdateState = {
  installedCommit?: string
  installedAt?: string
  baselineCommit?: string
  baselineAt?: string
  latest?: UpdateCommitInfo
  lastCheckedAt?: string
  mode?: UpdateInstallMode
}

type LocalSourceState = {
  mode: UpdateInstallMode
  commit: string
  branch: string
  source: 'git' | 'state' | 'unknown'
  dirty: boolean
  dirtyFiles: string[]
}

type UpdateInstallOptions = {
  force: boolean
}

type UpdateInstallPreflight =
  | { action: 'blocked'; message: string }
  | { action: 'noop' }
  | { action: 'install'; latest: UpdateCommitInfo; forcedArchiveReinstallCommit?: string }

const runs = new Map<string, UpdateRun>()

/**
 * Called once at startup to recover stale runs.
 * Any persisted run still in 'running' or 'queued' means the previous
 * process died mid-update — mark them 'failed' so the UI doesn't get stuck.
 */
export async function initUpdaterState() {
  try {
    const files = await fs.readdir(RUNS_DIR).catch(() => [])
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(path.join(RUNS_DIR, file), 'utf-8')
        const run = JSON.parse(raw) as UpdateRun
        if (run.status === 'running' || run.status === 'queued') {
          run.status = 'failed'
          run.phase = 'failed'
          run.phaseLabel = '更新中断'
          run.message = '上次更新在执行过程中因进程退出而中断。'
          run.error = run.message
          run.finishedAt = run.finishedAt ?? new Date().toISOString()
          await fs.writeFile(path.join(RUNS_DIR, file), JSON.stringify(run, null, 2), 'utf-8')
        }
        runs.set(run.id, run)
      } catch { /* skip corrupt files */ }
    }
  } catch { /* RUNS_DIR may not exist yet */ }
}

export function normalizeUpdateInstallInput(input: UpdateInstallInput = {}): UpdateInstallOptions {
  return {
    force: input.force === true,
  }
}

export function shouldRunUpdateInstall(status: UpdateStatus, options: UpdateInstallOptions) {
  return Boolean(
    status.updateAvailable ||
      (status.mode === 'archive' && options.force && status.latest),
  )
}

export function planUpdateInstall(status: UpdateStatus, options: UpdateInstallOptions): UpdateInstallPreflight {
  if (!status.latest) return { action: 'blocked', message: '无法获取 GitHub 最新版本。' }
  if (!status.canInstall) {
    return {
      action: 'blocked',
      message: status.warnings[0] ?? '当前环境暂不满足自动更新条件。',
    }
  }
  if (!shouldRunUpdateInstall(status, options)) return { action: 'noop' }
  return {
    action: 'install',
    latest: status.latest,
    forcedArchiveReinstallCommit:
      options.force && status.mode === 'archive' && !status.updateAvailable
        ? status.latest.commit
        : undefined,
  }
}

export async function getUpdateStatus(refreshRemote = true): Promise<UpdateStatus> {
  const workspaceRoot = await resolveWorkspaceRoot()
  const state = await readStoredState()
  const local = await getLocalSourceState(workspaceRoot, state)
  const latest = refreshRemote ? await fetchLatestCommit() : state.latest ?? null
  let currentCommit = local.commit
  let currentSource = local.source
  const warnings: string[] = []
  let archiveBaselineCommit = state.baselineCommit
  let archiveBaselineAt = state.baselineAt

  if (local.mode === 'git' && local.branch !== REPO_BRANCH) {
    warnings.push(`当前 Git 分支是 ${local.branch || '未知'}，自动更新仅支持 ${REPO_BRANCH}。`)
  }
  if (local.mode === 'git' && local.dirty) {
    warnings.push('当前 Git 工作区有未提交改动，自动更新前需要先处理这些改动。')
  }
  if (local.mode === 'archive' && !currentCommit && latest) {
    currentCommit = latest.commit
    currentSource = 'state'
    archiveBaselineCommit = latest.commit
    archiveBaselineAt = state.baselineAt ?? new Date().toISOString()
    warnings.push('当前运行目录不是 Git 仓库，已将本次检查到的远端版本记录为本机版本基线；如果本地代码不是最新版，可以重新安装最新版。')
  } else if (local.mode === 'archive' && !currentCommit) {
    warnings.push('当前运行目录不是 Git 仓库，尚未建立本机版本基线；检查更新后会持久化当前版本显示。')
  } else if (local.mode === 'archive') {
    warnings.push('当前运行目录不是 Git 仓库，当前版本来自本地持久化基线；手动改文件不会自动改变该版本。')
  }

  const canInstall =
    local.mode === 'archive' || (!local.dirty && (!local.branch || local.branch === REPO_BRANCH))
  const updateAvailable = latest ? !currentCommit || latest.commit !== currentCommit : false
  const status: UpdateStatus = {
    workspaceRoot,
    dataDir: config.dataDir,
    mode: local.mode,
    current: {
      commit: currentCommit,
      shortCommit: currentCommit ? currentCommit.slice(0, 7) : '',
      branch: local.branch,
      source: currentSource,
    },
    latest,
    updateAvailable,
    canInstall,
    dirty: local.dirty,
    dirtyFiles: local.dirtyFiles,
    warnings,
    lastCheckedAt: new Date().toISOString(),
  }

  await writeStoredState({
    ...state,
    latest: latest ?? state.latest,
    lastCheckedAt: status.lastCheckedAt,
    mode: local.mode,
    baselineCommit: archiveBaselineCommit,
    baselineAt: archiveBaselineAt,
  })
  return status
}

export async function startUpdateInstall(input: UpdateInstallInput = {}): Promise<UpdateRun> {
  const activeRun = [...runs.values()].find(
    (run) => run.status === 'queued' || run.status === 'running' || run.status === 'handed_off',
  )
  if (activeRun) {
    throw httpError(409, '已有更新任务正在执行，请等待当前任务结束。')
  }
  const options = normalizeUpdateInstallInput(input)

  await fs.mkdir(LOG_DIR, { recursive: true })
  await fs.mkdir(RUNS_DIR, { recursive: true })

  const id = randomUUID()
  const run: UpdateRun = {
    id,
    status: 'queued',
    phase: 'queued',
    phaseLabel: '等待开始',
    progress: 0,
    message: '更新任务已创建。',
    logPath: path.join(LOG_DIR, `updater-${id}.log`),
    logTail: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    statusSnapshot: null,
  }
  runs.set(id, run)
  await persistRun(run)

  queueMicrotask(() => {
    void executeUpdate(run, options)
  })

  return cloneRun(run)
}

export async function getUpdateRun(id: string): Promise<UpdateRun> {
  const run = runs.get(id) ?? (await readRunFile(id))
  if (!run) throw httpError(404, '更新任务不存在。')
  return cloneRun(run)
}

export async function scheduleUpdateRestart(): Promise<UpdateRestartResponse> {
  const workspaceRoot = await resolveWorkspaceRoot()
  await fs.mkdir(UPDATER_DIR, { recursive: true })
  await fs.mkdir(LOG_DIR, { recursive: true })
  if (process.platform === 'win32') {
    return scheduleWindowsRestart(workspaceRoot)
  }
  return schedulePosixRestart(workspaceRoot)
}

async function executeUpdate(run: UpdateRun, options: UpdateInstallOptions) {
  try {
    await setRun(run, {
      status: 'running',
      phase: 'preflight',
      phaseLabel: '检查版本',
      progress: 5,
      message: '正在检查本地状态和 GitHub 最新版本。',
    })

    const status = await getUpdateStatus(true)
    await setRun(run, { statusSnapshot: status })
    const installPlan = planUpdateInstall(status, options)
    if (installPlan.action === 'blocked') throw new Error(installPlan.message)
    if (installPlan.action === 'noop') {
      await setRun(run, {
        status: 'success',
        phase: 'complete',
        phaseLabel: '无需更新',
        progress: 100,
        message: '当前已经是最新版本。',
        finishedAt: new Date().toISOString(),
      })
      return
    }
    if (installPlan.forcedArchiveReinstallCommit) {
      await appendRunLog(
        run,
        `[preflight] archive reinstall forced for ${installPlan.forcedArchiveReinstallCommit}${os.EOL}`,
      )
    }

    // Stage phase: download and extract to a staging directory (safe — never touches running code)
    const stagedDir = await stageUpdate(run, status)

    // Write pending-update.json for the external updater script
    const pending: PendingUpdate = {
      runId: run.id,
      mode: status.mode,
      workspaceRoot: status.workspaceRoot,
      stagedDir,
      latest: installPlan.latest,
      logPath: run.logPath,
      nodePid: process.pid,
      createdAt: new Date().toISOString(),
    }
    await fs.mkdir(path.dirname(PENDING_FILE), { recursive: true })
    await fs.writeFile(PENDING_FILE, JSON.stringify(pending, null, 2), 'utf-8')
    await appendRunLog(run, `[handoff] pending-update.json written${os.EOL}`)

    // Update stored state before handing off
    const state = await readStoredState()
    await writeStoredState({
      ...state,
      installedCommit: installPlan.latest.commit,
      installedAt: new Date().toISOString(),
      latest: installPlan.latest,
      mode: status.mode,
    })

    // Hand off to external updater script (runs detached, survives Node exit)
    await setRun(run, {
      phase: 'handoff',
      phaseLabel: '移交外部更新器',
      progress: 55,
      message: '正在启动外部更新脚本，Node 进程即将退出，更新将在后台继续。',
    })

    const updaterResult = await launchExternalUpdater(pending)
    await appendRunLog(run, `[handoff] updater script: ${updaterResult.scriptPath}${os.EOL}`)

    await setRun(run, {
      status: 'handed_off',
      phase: 'handoff',
      phaseLabel: '已移交外部更新器',
      progress: 60,
      message: '更新已交由外部脚本执行。脚本将停止当前服务、覆盖文件、安装依赖、构建并重启。请稍后刷新页面。',
      finishedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendRunLog(run, `${os.EOL}[failed] ${message}${os.EOL}`)
    await setRun(run, {
      status: 'failed',
      phase: 'failed',
      phaseLabel: '更新失败',
      progress: Math.max(run.progress, 1),
      message,
      error: message,
      finishedAt: new Date().toISOString(),
    })
  }
}

/**
 * Stage the update: download/fetch + extract into a clean staging directory.
 * Returns the path to the staged source root.
 */
async function stageUpdate(run: UpdateRun, status: UpdateStatus): Promise<string> {
  if (status.mode === 'git') {
    return stageWithGit(run, status)
  }
  return stageWithArchive(run, status)
}

/**
 * Git mode staging: fetch + pull into the workspace, then copy installable
 * entries into STAGED_DIR so the external updater can apply from there.
 * The git operations happen in-place (safe — they only update .git and
 * working tree source files; the running dist/ is blocklisted).
 */
async function stageWithGit(run: UpdateRun, status: UpdateStatus): Promise<string> {
  const workspaceRoot = status.workspaceRoot
  await setRun(run, {
    phase: 'fetch',
    phaseLabel: '拉取代码',
    progress: 15,
    message: '正在从 origin/main 拉取最新代码。',
  })
  await runLogged(run, 'git', ['fetch', 'origin', '--prune'], workspaceRoot, 28)
  await runLogged(run, 'git', ['pull', '--ff-only', 'origin', REPO_BRANCH], workspaceRoot, 45)

  // For git mode, the workspace *is* the staged source (git already updated it)
  await setRun(run, {
    phase: 'staged',
    phaseLabel: '代码已就绪',
    progress: 50,
    message: 'Git 拉取完成，代码已就绪。',
  })
  return workspaceRoot
}

/**
 * Archive mode staging: download zip → extract → find root → stage.
 * Nothing in the running workspace is modified.
 */
async function stageWithArchive(run: UpdateRun, _status: UpdateStatus): Promise<string> {
  const zipPath = path.join(DOWNLOAD_DIR, `${REPO_NAME}-${Date.now()}.zip`)
  const extractTarget = path.join(EXTRACT_DIR, run.id)

  await fs.mkdir(DOWNLOAD_DIR, { recursive: true })
  await fs.rm(extractTarget, { recursive: true, force: true })
  await fs.mkdir(extractTarget, { recursive: true })

  await setRun(run, {
    phase: 'fetch',
    phaseLabel: '下载更新',
    progress: 18,
    message: '正在下载 GitHub main 分支源码包。',
  })
  await downloadFile(GITHUB_ZIP_URL, zipPath, run)

  await setRun(run, {
    phase: 'fetch',
    phaseLabel: '解压更新',
    progress: 35,
    message: '正在解压源码包。',
  })
  await createReadStream(zipPath).pipe(unzipper.Extract({ path: extractTarget })).promise()
  await appendRunLog(run, `[extract] ${zipPath} -> ${extractTarget}${os.EOL}`)

  const sourceRoot = await findExtractedRoot(extractTarget)

  // Copy installable entries into a clean staged directory
  const staged = path.join(STAGED_DIR, run.id)
  await fs.rm(staged, { recursive: true, force: true })
  await fs.mkdir(staged, { recursive: true })
  const names = await listInstallableNames(sourceRoot)
  for (const name of names) {
    const src = path.join(sourceRoot, name)
    const dst = path.join(staged, name)
    const stats = await fs.stat(src)
    if (stats.isDirectory()) {
      await copyRecursive(src, dst)
    } else if (stats.isFile()) {
      await fs.mkdir(path.dirname(dst), { recursive: true })
      await fs.copyFile(src, dst)
    }
  }
  await appendRunLog(run, `[staged] ${names.length} entries staged to ${staged}${os.EOL}`)

  await setRun(run, {
    phase: 'staged',
    phaseLabel: '源码已暂存',
    progress: 50,
    message: '源码已下载并暂存，准备移交外部更新器。',
  })
  return staged
}

async function copyRecursive(source: string, target: string) {
  await fs.mkdir(target, { recursive: true })
  const entries = await fs.readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const src = path.join(source, entry.name)
    const dst = path.join(target, entry.name)
    if (entry.isDirectory()) {
      await copyRecursive(src, dst)
    } else if (entry.isFile()) {
      await fs.copyFile(src, dst)
    }
  }
}

/**
 * Launch the external updater script (detached, survives Node exit).
 * The script reads pending-update.json, stops Node, applies files,
 * runs npm install + build, and restarts the services.
 */
async function launchExternalUpdater(pending: PendingUpdate): Promise<{ scriptPath: string }> {
  await fs.mkdir(UPDATER_DIR, { recursive: true })
  await fs.mkdir(LOG_DIR, { recursive: true })
  if (process.platform === 'win32') {
    return launchWindowsUpdater(pending)
  }
  return launchPosixUpdater(pending)
}

async function launchWindowsUpdater(pending: PendingUpdate): Promise<{ scriptPath: string }> {
  const scriptPath = path.join(UPDATER_DIR, `updater-${pending.runId.slice(0, 8)}.ps1`)
  const logFile = path.join(LOG_DIR, `updater-${pending.runId.slice(0, 8)}.log`)
  const blocklist = [...INSTALL_BLOCKLIST].map((n) => `'${n}'`).join(',')
  const preserved = [...PRESERVED_APP_CHILDREN].map((n) => `'${n}'`).join(',')
  const script = `
$ErrorActionPreference = 'Stop'
$pendingFile = '${escapePowerShell(PENDING_FILE)}'
$logFile = '${escapePowerShell(logFile)}'
$nodePid = ${pending.nodePid}
$root = '${escapePowerShell(pending.workspaceRoot)}'
$staged = '${escapePowerShell(pending.stagedDir)}'
$mode = '${pending.mode}'
$blocklist = @(${blocklist})
$preserved = @(${preserved})

function Log($msg) { Add-Content -Path $logFile -Value "$(Get-Date -Format o) $msg" }

Log "[updater] starting, waiting for Node PID $nodePid to exit"

# Wait for the Node process to exit (max 30s)
$waited = 0
while ($waited -lt 30) {
  try { $p = Get-Process -Id $nodePid -ErrorAction SilentlyContinue } catch { $p = $null }
  if (-not $p) { break }
  Start-Sleep -Seconds 1
  $waited++
}
if ($waited -ge 30) {
  Log "[updater] Node PID $nodePid did not exit in 30s, killing"
  try { Stop-Process -Id $nodePid -Force -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Seconds 2
}

# Also kill any leftover processes on ports 10052/10053
$ports = @(10052, 10053)
$portPids = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($pid in $portPids) {
  if ($pid -and $pid -ne $PID) {
    Log "[updater] killing port process $pid"
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Milliseconds 500

if ($mode -eq 'archive') {
  Log "[updater] applying staged files from $staged"
  # Backup + apply
  $backupDir = Join-Path '${escapePowerShell(BACKUP_DIR)}' (Get-Date -Format 'yyyy-MM-ddTHH-mm-ss')
  New-Item -ItemType Directory -Force $backupDir | Out-Null

  $entries = Get-ChildItem -Path $staged -ErrorAction SilentlyContinue
  foreach ($entry in $entries) {
    $name = $entry.Name
    if ($blocklist -contains $name) { continue }
    $target = Join-Path $root $name
    # Backup existing
    if (Test-Path $target) {
      Log "[updater] backup $target"
      Copy-Item -Path $target -Destination (Join-Path $backupDir $name) -Recurse -Force
    }
    # Apply — for backend/frontend, preserve dist/node_modules/.env*
    if (Test-Path $target) {
      if ($name -eq 'backend' -or $name -eq 'frontend') {
        # Remove files not in preserved list, then copy new
        Get-ChildItem -Path $target | Where-Object { $preserved -notcontains $_.Name } | Remove-Item -Recurse -Force
      } else {
        Remove-Item -Path $target -Recurse -Force
      }
    }
    Log "[updater] apply $name"
    Copy-Item -Path $entry.FullName -Destination $target -Recurse -Force
  }
}

# Install dependencies and build
Log "[updater] installing dependencies and building"
$npmCmd = 'npm.cmd'
$packages = @(
  @{ Name = 'backend'; Dir = Join-Path $root 'backend' },
  @{ Name = 'frontend'; Dir = Join-Path $root 'frontend' }
)
foreach ($pkg in $packages) {
  $pkgJson = Join-Path $pkg.Dir 'package.json'
  if (-not (Test-Path $pkgJson)) { continue }
  Log "[updater] npm install in $($pkg.Name)"
  $proc = Start-Process -FilePath $npmCmd -ArgumentList 'install','--no-audit','--no-fund' -WorkingDirectory $pkg.Dir -NoNewWindow -Wait -PassThru -RedirectStandardOutput (Join-Path $logFile "..$($pkg.Name)-install.log") 2>&1
  if ($proc.ExitCode -ne 0) { Log "[updater] WARNING: npm install for $($pkg.Name) exited $($proc.ExitCode)" }
  Log "[updater] npm run build in $($pkg.Name)"
  $proc = Start-Process -FilePath $npmCmd -ArgumentList 'run','build' -WorkingDirectory $pkg.Dir -NoNewWindow -Wait -PassThru -RedirectStandardOutput (Join-Path $logFile "..$($pkg.Name)-build.log") 2>&1
  if ($proc.ExitCode -ne 0) { Log "[updater] WARNING: npm build for $($pkg.Name) exited $($proc.ExitCode)" }
}

# Clean up pending file
Remove-Item -Path $pendingFile -Force -ErrorAction SilentlyContinue

# Restart services
Log "[updater] restarting services"
$logDir = '${escapePowerShell(LOG_DIR)}'
New-Item -ItemType Directory -Force $logDir | Out-Null
Start-Process -FilePath $npmCmd -ArgumentList 'run','dev' -WorkingDirectory (Join-Path $root 'backend') -WindowStyle Minimized -RedirectStandardOutput (Join-Path $logDir 'backend-dev.out.log') -RedirectStandardError (Join-Path $logDir 'backend-dev.err.log')
Start-Process -FilePath $npmCmd -ArgumentList 'run','dev' -WorkingDirectory (Join-Path $root 'frontend') -WindowStyle Minimized -RedirectStandardOutput (Join-Path $logDir 'frontend-dev.out.log') -RedirectStandardError (Join-Path $logDir 'frontend-dev.err.log')
Log "[updater] done"
`
  await fs.writeFile(scriptPath, script.trimStart(), 'utf-8')
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { detached: true, stdio: 'ignore', windowsHide: true },
  )
  child.unref()
  return { scriptPath }
}

async function launchPosixUpdater(pending: PendingUpdate): Promise<{ scriptPath: string }> {
  const scriptPath = path.join(UPDATER_DIR, `updater-${pending.runId.slice(0, 8)}.sh`)
  const logFile = path.join(LOG_DIR, `updater-${pending.runId.slice(0, 8)}.log`)
  const blocklistItems = [...INSTALL_BLOCKLIST].map((n) => `"${n}"`).join(' ')
  const preservedItems = [...PRESERVED_APP_CHILDREN].map((n) => `"${n}"`).join(' ')
  const script = `#!/bin/sh
set -e
pendingFile='${escapeSingleQuote(PENDING_FILE)}'
logFile='${escapeSingleQuote(logFile)}'
nodePid=${pending.nodePid}
root='${escapeSingleQuote(pending.workspaceRoot)}'
staged='${escapeSingleQuote(pending.stagedDir)}'
mode='${pending.mode}'
blocklist="${blocklistItems}"
preserved="${preservedItems}"

log() { echo "$(date -Iseconds) $1" >> "$logFile"; }

log "[updater] starting, waiting for Node PID $nodePid to exit"

# Wait for Node to exit (max 30s)
waited=0
while [ $waited -lt 30 ]; do
  if ! kill -0 $nodePid 2>/dev/null; then break; fi
  sleep 1
  waited=$((waited+1))
done
if [ $waited -ge 30 ]; then
  log "[updater] Node PID $nodePid did not exit in 30s, killing"
  kill -9 $nodePid 2>/dev/null || true
  sleep 2
fi

# Kill leftover port listeners
if command -v lsof >/dev/null 2>&1; then
  for port in 10052 10053; do
    pids=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$pids" ]; then kill -9 $pids 2>/dev/null || true; fi
  done
fi

if [ "$mode" = "archive" ]; then
  log "[updater] applying staged files from $staged"
  backupDir='${escapeSingleQuote(BACKUP_DIR)}'"/$(date +%Y-%m-%dT%H-%M-%S)"
  mkdir -p "$backupDir"

  for entry in "$staged"/*; do
    [ -e "$entry" ] || continue
    name=$(basename "$entry")
    skip=0
    for bl in $blocklist; do
      if [ "$name" = "$bl" ]; then skip=1; break; fi
    done
    [ $skip -eq 1 ] && continue

    target="$root/$name"
    # Backup existing
    if [ -e "$target" ]; then
      log "[updater] backup $target"
      cp -a "$target" "$backupDir/$name" 2>/dev/null || true
    fi
    # Apply — for backend/frontend, preserve dist/node_modules/.env*
    if [ -d "$target" ] && { [ "$name" = "backend" ] || [ "$name" = "frontend" ]; }; then
      for child in "$target"/*; do
        [ -e "$child" ] || continue
        childName=$(basename "$child")
        keep=0
        for p in $preserved; do
          if [ "$childName" = "$p" ]; then keep=1; break; fi
        done
        [ $keep -eq 0 ] && rm -rf "$child"
      done
    elif [ -e "$target" ]; then
      rm -rf "$target"
    fi
    log "[updater] apply $name"
    cp -a "$entry" "$target"
  done
fi

# Install dependencies and build
log "[updater] installing dependencies and building"
for pkg in backend frontend; do
  pkgDir="$root/$pkg"
  if [ ! -f "$pkgDir/package.json" ]; then continue; fi
  log "[updater] npm install in $pkg"
  (cd "$pkgDir" && npm install --no-audit --no-fund >> "$logFile" 2>&1) || log "[updater] WARNING: npm install for $pkg failed"
  log "[updater] npm run build in $pkg"
  (cd "$pkgDir" && npm run build >> "$logFile" 2>&1) || log "[updater] WARNING: npm build for $pkg failed"
done

# Clean up pending file
rm -f "$pendingFile"

# Restart services
log "[updater] restarting services"
logDir='${escapeSingleQuote(LOG_DIR)}'
mkdir -p "$logDir"
(cd "$root/backend" && nohup npm run dev > "$logDir/backend-dev.out.log" 2> "$logDir/backend-dev.err.log" &)
(cd "$root/frontend" && nohup npm run dev > "$logDir/frontend-dev.out.log" 2> "$logDir/frontend-dev.err.log" &)
log "[updater] done"
`
  await fs.writeFile(scriptPath, script, 'utf-8')
  await fs.chmod(scriptPath, 0o755).catch(() => undefined)
  const child = spawn('sh', [scriptPath], { detached: true, stdio: 'ignore' })
  child.unref()
  return { scriptPath }
}

async function downloadFile(url: string, target: string, run: UpdateRun) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/zip',
        'User-Agent': '1052-OS-Updater',
      },
    })
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`)
    }
    const total = Number(response.headers.get('content-length') ?? 0)
    let received = 0
    const progressStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.byteLength
        if (total > 0) {
          const pct = 18 + Math.min(14, Math.round((received / total) * 14))
          void setRun(run, {
            progress: pct,
            message: `正在下载更新：${formatBytes(received)} / ${formatBytes(total)}`,
          })
        }
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body), progressStream, createWriteStream(target))
    await appendRunLog(run, `[download] ${url} -> ${target} (${formatBytes(received)})${os.EOL}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendRunLog(run, `[download] node fetch failed, fallback to system downloader: ${message}${os.EOL}`)
    await downloadFileWithSystemTool(url, target, run)
  }
}

async function downloadFileWithSystemTool(url: string, target: string, run: UpdateRun) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  await setRun(run, {
    progress: 32,
    message: 'Node 网络访问失败，正在使用系统下载器继续下载。',
  })
  if (process.platform === 'win32') {
    await runLogged(
      run,
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Invoke-WebRequest -UseBasicParsing -Uri '${escapePowerShell(url)}' -OutFile '${escapePowerShell(target)}'`,
      ],
      await resolveWorkspaceRoot(),
      34,
    )
    return
  }
  await runLogged(run, 'curl', ['-L', '--fail', '--output', target, url], await resolveWorkspaceRoot(), 34)
}

async function listInstallableNames(sourceRoot: string): Promise<string[]> {
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true })
  return entries
    .filter((entry) => !INSTALL_BLOCKLIST.has(entry.name))
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => entry.name)
}

async function findExtractedRoot(extractTarget: string): Promise<string> {
  const entries = await fs.readdir(extractTarget, { withFileTypes: true })
  const root = entries.find((entry) => entry.isDirectory())
  if (!root) throw new Error('源码包解压后没有找到项目目录。')
  return path.join(extractTarget, root.name)
}

async function getLocalSourceState(
  workspaceRoot: string,
  state: StoredUpdateState,
): Promise<LocalSourceState> {
  if (await pathExists(path.join(workspaceRoot, '.git'))) {
    const commit = await runCapture('git', ['rev-parse', 'HEAD'], workspaceRoot).catch(() => '')
    const branch = await runCapture('git', ['branch', '--show-current'], workspaceRoot).catch(() => '')
    const status = await runCapture('git', ['status', '--porcelain'], workspaceRoot).catch(() => '')
    const dirtyFiles = status
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    return {
      mode: 'git',
      commit: commit.trim(),
      branch: branch.trim(),
      source: 'git',
      dirty: dirtyFiles.length > 0,
      dirtyFiles,
    }
  }

  return {
    mode: 'archive',
    commit: state.installedCommit ?? state.baselineCommit ?? '',
    branch: '',
    source: state.installedCommit || state.baselineCommit ? 'state' : 'unknown',
    dirty: false,
    dirtyFiles: [],
  }
}

async function fetchLatestCommit(): Promise<UpdateCommitInfo> {
  try {
    const response = await fetch(GITHUB_API_COMMIT_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': '1052-OS-Updater',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as GitHubCommitResponse
    const commit = data.sha
    if (!commit) throw new Error('GitHub 响应缺少 commit。')
    const message = data.commit?.message?.split(/\r?\n/)[0]?.trim() || 'No commit message'
    const date = data.commit?.committer?.date ?? data.commit?.author?.date ?? ''
    return {
      commit,
      shortCommit: commit.slice(0, 7),
      date,
      message,
      url: data.html_url ?? `https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${commit}`,
    }
  } catch {
    return fetchLatestCommitWithGit()
  }
}

async function fetchLatestCommitWithGit(): Promise<UpdateCommitInfo> {
  const output = await runCapture(
    'git',
    ['ls-remote', `https://github.com/${REPO_OWNER}/${REPO_NAME}.git`, `refs/heads/${REPO_BRANCH}`],
    await resolveWorkspaceRoot(),
  ).catch(() => '')
  const commit = output.split(/\s+/)[0]?.trim()
  if (!commit) throw new Error('检查更新失败：无法访问 GitHub，也无法通过 git ls-remote 获取最新提交。')
  return {
    commit,
    shortCommit: commit.slice(0, 7),
    date: '',
    message: `${REPO_BRANCH} 分支最新提交`,
    url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${commit}`,
  }
}

async function resolveWorkspaceRoot(): Promise<string> {
  const cwd = process.cwd()
  if ((await pathExists(path.join(cwd, 'backend'))) && (await pathExists(path.join(cwd, 'frontend')))) {
    return cwd
  }
  const parent = path.dirname(cwd)
  if (
    path.basename(cwd).toLowerCase() === 'backend' &&
    (await pathExists(path.join(parent, 'frontend')))
  ) {
    return parent
  }
  const grandParent = path.dirname(parent)
  if (
    path.basename(cwd).toLowerCase() === 'dist' &&
    path.basename(parent).toLowerCase() === 'backend' &&
    (await pathExists(path.join(grandParent, 'frontend')))
  ) {
    return grandParent
  }
  return cwd
}

async function runLogged(
  run: UpdateRun,
  command: string,
  args: string[],
  cwd: string,
  progressAfterSuccess: number,
) {
  await appendRunLog(run, `${os.EOL}$ ${command} ${args.join(' ')}${os.EOL}`)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      shell: false,
    })
    child.stdout.on('data', (chunk: Buffer) => {
      void appendRunLog(run, chunk.toString('utf-8'))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      void appendRunLog(run, chunk.toString('utf-8'))
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        void setRun(run, { progress: progressAfterSuccess })
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} 退出码 ${code ?? 'unknown'}`))
      }
    })
  })
}

async function runCapture(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false })
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf-8').trim()
      if (code === 0) resolve(output)
      else reject(new Error(output || `${command} ${args.join(' ')} failed`))
    })
  })
}

async function setRun(run: UpdateRun, patch: Partial<UpdateRun>) {
  Object.assign(run, patch)
  runs.set(run.id, run)
  await persistRun(run)
}

async function appendRunLog(run: UpdateRun, text: string) {
  run.logTail = trimLogTail(run.logTail + text)
  runs.set(run.id, run)
  await fs.mkdir(path.dirname(run.logPath), { recursive: true })
  await fs.appendFile(run.logPath, text, 'utf-8').catch(() => undefined)
  await persistRun(run)
}

function trimLogTail(text: string): string {
  if (text.length <= LOG_TAIL_LIMIT) return text
  return text.slice(text.length - LOG_TAIL_LIMIT)
}

async function persistRun(run: UpdateRun) {
  await fs.mkdir(RUNS_DIR, { recursive: true })
  await fs.writeFile(path.join(RUNS_DIR, `${run.id}.json`), JSON.stringify(run, null, 2), 'utf-8')
}

async function readRunFile(id: string): Promise<UpdateRun | null> {
  const file = path.join(RUNS_DIR, `${id}.json`)
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as UpdateRun
  } catch {
    return null
  }
}

function cloneRun(run: UpdateRun): UpdateRun {
  return JSON.parse(JSON.stringify(run)) as UpdateRun
}

async function readStoredState(): Promise<StoredUpdateState> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf-8')) as StoredUpdateState
  } catch {
    return {}
  }
}

async function writeStoredState(state: StoredUpdateState) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true })
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

async function scheduleWindowsRestart(workspaceRoot: string): Promise<UpdateRestartResponse> {
  const scriptPath = path.join(UPDATER_DIR, `restart-${Date.now()}.ps1`)
  const nodePid = process.pid
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Start-Sleep -Milliseconds 900
$root = '${escapePowerShell(workspaceRoot)}'
$logDir = '${escapePowerShell(LOG_DIR)}'
$callerNodePid = ${nodePid}
New-Item -ItemType Directory -Force $logDir | Out-Null
$ports = @(10052, 10053)
$portPids = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($processId in $portPids) {
  if ($processId -and $processId -ne $PID) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
}
$escapedRoot = [regex]::Escape($root)
$projectProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and
  $_.CommandLine -match $escapedRoot -and
  $_.CommandLine -match '(npm|vite|tsx|node)'
}
foreach ($proc in $projectProcesses) {
  if ($proc.ProcessId -and $proc.ProcessId -ne $PID -and $proc.ProcessId -ne $callerNodePid) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Milliseconds 600
Start-Process -FilePath npm.cmd -ArgumentList 'run','dev' -WorkingDirectory (Join-Path $root 'backend') -WindowStyle Minimized -RedirectStandardOutput (Join-Path $logDir 'backend-dev.out.log') -RedirectStandardError (Join-Path $logDir 'backend-dev.err.log')
Start-Process -FilePath npm.cmd -ArgumentList 'run','dev' -WorkingDirectory (Join-Path $root 'frontend') -WindowStyle Minimized -RedirectStandardOutput (Join-Path $logDir 'frontend-dev.out.log') -RedirectStandardError (Join-Path $logDir 'frontend-dev.err.log')
`
  await fs.writeFile(scriptPath, script.trimStart(), 'utf-8')
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { detached: true, stdio: 'ignore', windowsHide: true },
  )
  child.unref()
  return {
    scheduled: true,
    message: '已安排重启前后端服务，请稍后刷新页面。',
    scriptPath,
  }
}

async function schedulePosixRestart(workspaceRoot: string): Promise<UpdateRestartResponse> {
  const scriptPath = path.join(UPDATER_DIR, `restart-${Date.now()}.sh`)
  const script = `#!/bin/sh
set +e
sleep 1
root='${escapeSingleQuote(workspaceRoot)}'
logDir='${escapeSingleQuote(LOG_DIR)}'
mkdir -p "$logDir"
if command -v lsof >/dev/null 2>&1; then
  for port in 10052 10053; do
    pids=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null)
    if [ -n "$pids" ]; then kill -9 $pids 2>/dev/null; fi
  done
fi
if command -v pkill >/dev/null 2>&1; then
  pkill -f "$root.*\\(npm run dev\\|vite\\|tsx watch\\|node\\)" 2>/dev/null
fi
(cd "$root/backend" && nohup npm run dev > "$logDir/backend-dev.out.log" 2> "$logDir/backend-dev.err.log" &)
(cd "$root/frontend" && nohup npm run dev > "$logDir/frontend-dev.out.log" 2> "$logDir/frontend-dev.err.log" &)
`
  await fs.writeFile(scriptPath, script, 'utf-8')
  await fs.chmod(scriptPath, 0o755).catch(() => undefined)
  const child = spawn('sh', [scriptPath], { detached: true, stdio: 'ignore' })
  child.unref()
  return {
    scheduled: true,
    message: '已安排重启前后端服务，请稍后刷新页面。',
    scriptPath,
  }
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''")
}

function escapeSingleQuote(value: string): string {
  return value.replace(/'/g, "'\\''")
}
