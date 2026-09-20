import {
  Button,
  Codicon,
  EmptyState,
  ErrorState,
  GlyphSpinner,
  MessageTextContent,
  PALETTE_AREA,
  ROUTES_AREA,
  SearchField,
  SIDEBAR_NAV_AREA,
  host,
  useValue,
  useQuery
} from '@hermes/plugin-sdk'
import { useEffect, useMemo, useState } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

const ID = 'cron-bulletin'
const ROUTE = '/cron-bulletin'
const READ_KEY = 'read-report-ids'
const HIDDEN_KEY = 'hidden-cron-jobs'
let pluginContext = null

const CSS = `
.cron-bulletin{height:100%;overflow:auto;padding:24px 28px;color:var(--ui-text-primary)}
.cron-bulletin-inner{width:min(920px,100%);margin:0 auto}
.cron-bulletin-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
.cron-bulletin-header-actions{display:flex;gap:8px;align-items:center;flex-shrink:0}
.cron-bulletin-kicker{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ui-text-quaternary)}
.cron-bulletin-title{font-size:22px;line-height:1.25;font-weight:650;margin-top:3px}
.cron-bulletin-subtitle{font-size:12px;color:var(--ui-text-tertiary);margin-top:5px}
.cron-bulletin-controls{display:grid;grid-template-columns:minmax(220px,1fr) repeat(3,max-content);gap:8px;align-items:center;margin-bottom:16px}
.cron-bulletin-filter{height:30px;border:1px solid var(--ui-stroke-secondary);border-radius:5px;padding:0 26px 0 9px;background:transparent;color:var(--ui-text-primary);font-size:12px}
.cron-bulletin-actions{display:flex;gap:6px;align-items:center;margin-top:13px}
.cron-bulletin-action{border:1px solid var(--ui-stroke-secondary);border-radius:5px;padding:5px 8px;background:transparent;color:var(--ui-text-tertiary);font-size:11px;cursor:pointer}
.cron-bulletin-action:hover{background:var(--chrome-action-hover);color:var(--ui-text-primary)}
.cron-bulletin-action-danger:hover{color:var(--ui-danger,var(--ui-text-primary))}
.cron-bulletin-list{display:flex;flex-direction:column;gap:9px}
.cron-bulletin-card{border:1px solid var(--ui-stroke-secondary);border-radius:8px;overflow:hidden}
.cron-bulletin-card[data-unread=true]{border-left:2px solid var(--ui-accent)}
.cron-bulletin-card[data-status=failed]{border-color:var(--ui-danger-border,var(--ui-stroke-secondary))}
.cron-bulletin-row{width:100%;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:11px 12px;text-align:left;background:transparent;color:inherit;cursor:pointer}
.cron-bulletin-row:hover{background:var(--chrome-action-hover)}
.cron-bulletin-status{width:7px;height:7px;border-radius:999px;background:var(--ui-success,var(--ui-accent));box-shadow:0 0 0 3px color-mix(in srgb,var(--ui-accent) 13%,transparent)}
.cron-bulletin-card[data-status=failed] .cron-bulletin-status{background:var(--ui-danger,var(--ui-text-secondary));box-shadow:none}
.cron-bulletin-copy{min-width:0}
.cron-bulletin-name{font-size:13px;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cron-bulletin-meta{display:flex;gap:8px;margin-top:2px;font-size:10px;color:var(--ui-text-quaternary)}
.cron-bulletin-unread{color:var(--ui-accent)}
.cron-bulletin-body{border-top:1px solid var(--ui-stroke-secondary);padding:15px 16px 17px;font-size:13px;line-height:1.55;overflow:hidden}
.cron-bulletin-attachments{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.cron-bulletin-file{display:inline-flex;align-items:center;gap:5px;padding:4px 7px;border:1px solid var(--ui-stroke-secondary);border-radius:5px;font-size:10px;color:var(--ui-text-tertiary)}
.cron-bulletin-center{display:flex;min-height:220px;align-items:center;justify-content:center;color:var(--ui-text-tertiary)}
.cron-bulletin-chips{display:flex;gap:7px;overflow-x:auto;padding:2px 0 13px}
.cron-bulletin-chip{border:1px solid var(--ui-stroke-secondary);border-radius:999px;padding:5px 10px;background:transparent;color:var(--ui-text-tertiary);font-size:11px;white-space:nowrap;cursor:pointer}
.cron-bulletin-chip[data-active=true]{background:var(--ui-accent);border-color:var(--ui-accent);color:var(--ui-text-on-accent,var(--ui-text-primary))}
.cron-bulletin-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}
.cron-bulletin-stat{border:1px solid var(--ui-stroke-secondary);border-radius:7px;padding:9px 11px}.cron-bulletin-stat-value{font-size:18px;font-weight:650}.cron-bulletin-stat-label{font-size:10px;color:var(--ui-text-quaternary);margin-top:2px}
.cron-bulletin-inbox{display:grid;grid-template-columns:280px minmax(0,1fr);gap:12px;min-height:430px}
.cron-bulletin-groups{display:flex;flex-direction:column;gap:6px;overflow:auto;max-height:620px;padding-right:2px}
.cron-bulletin-group{border:1px solid var(--ui-stroke-secondary);border-radius:7px;padding:10px;background:transparent;color:inherit;text-align:left;cursor:pointer}.cron-bulletin-group[data-selected=true]{border-color:var(--ui-accent);background:color-mix(in srgb,var(--ui-accent) 8%,transparent)}
.cron-bulletin-group-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cron-bulletin-group-meta{font-size:10px;color:var(--ui-text-quaternary);margin-top:4px}
.cron-bulletin-detail{min-width:0}.cron-bulletin-history{margin-bottom:8px;color:var(--ui-text-tertiary);font-size:11px}
@media(max-width:680px){.cron-bulletin{padding:16px}.cron-bulletin-controls{grid-template-columns:minmax(0,1fr) repeat(2,max-content)}.cron-bulletin-controls>*:first-child{grid-column:1/-1}.cron-bulletin-filter{grid-column:auto}.cron-bulletin-header{align-items:center}.cron-bulletin-summary{grid-template-columns:repeat(3,1fr)}.cron-bulletin-inbox{grid-template-columns:1fr}.cron-bulletin-groups{max-height:220px}}
`

function jobKey(report) {
  return `${report.profile || 'active'}:${report.job_id || report.job_name || 'unknown'}`
}

function filterReports(reports, query, status, hiddenJobs = [], showHidden = false) {
  const needle = String(query || '').trim().toLocaleLowerCase()
  const hidden = new Set(Array.isArray(hiddenJobs) ? hiddenJobs : [])
  return (reports || []).filter(report => {
    if (!showHidden && hidden.has(jobKey(report))) return false
    if (status !== 'all' && report.status !== status) return false
    if (!needle) return true
    return [report.job_name, report.job_id, report.markdown]
      .join('\n')
      .toLocaleLowerCase()
      .includes(needle)
  })
}

function groupReports(reports) {
  const groups = new Map()
  for (const report of reports || []) {
    const key = `${report.profile || 'active'}:${report.job_id || report.job_name || report.id}`
    const current = groups.get(key) || {
      key,
      job_id: report.job_id,
      job_name: report.job_name,
      profile: report.profile || 'active',
      reports: []
    }
    current.reports.push(report)
    groups.set(key, current)
  }
  return [...groups.values()].map(group => ({
    ...group,
    reports: group.reports.sort((a, b) => String(b.run_time || b.modified_at || '').localeCompare(String(a.run_time || a.modified_at || ''))),
    latest: group.reports[0]
  }))
}

function unseenCount(reports, readIds) {
  const read = new Set(Array.isArray(readIds) ? readIds : [])
  return (reports || []).reduce((total, report) => total + (read.has(report.id) ? 0 : 1), 0)
}

function reportFromSession(session, history) {
  const title = String(session?.title || session?.name || 'Cron report')
  const failed = /\(FAILED\)\s*$/i.test(title) || (history?.messages || []).some(message =>
    /failed|error|timeout/i.test(String(message?.text || ''))
  )
  const message = [...(history?.messages || [])]
    .reverse()
    .find(row => row?.role === 'assistant' && row?.display_kind !== 'hidden' && String(row?.text || '').trim())
  return {
    id: String(session?.id || ''),
    job_id: String(session?.job_id || session?.id || ''),
    job_name: title.replace(/\s*\(FAILED\)\s*$/i, '').trim(),
    status: failed ? 'failed' : 'completed',
    markdown: String(message?.text || ''),
    attachments: [],
    modified_at: Number(session?.started_at || 0)
  }
}

function formatTime(report) {
  if (report.run_time) return report.run_time
  if (!report.modified_at) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(report.modified_at * 1000)
  )
}

function formatSize(bytes) {
  const value = Number(bytes || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function ReportCard({ report, initialOpen = false, isRead, isHidden, onRead, onHide, onArchive, onDelete }) {
  const [open, setOpen] = useState(initialOpen)
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !isRead) onRead(report.id)
  }
  return jsxs('article', {
    className: 'cron-bulletin-card',
    'data-status': report.status,
    'data-unread': String(!isRead),
    children: [
      jsxs('button', {
        className: 'cron-bulletin-row',
        type: 'button',
        onClick: toggle,
        'aria-expanded': open,
        children: [
          jsx('span', { className: 'cron-bulletin-status', 'aria-hidden': 'true' }),
          jsxs('span', {
            className: 'cron-bulletin-copy',
            children: [
              jsx('span', { className: 'cron-bulletin-name', children: report.job_name || report.job_id }),
              jsxs('span', {
                className: 'cron-bulletin-meta',
                children: [
                  jsx('span', { children: formatTime(report) }),
                  jsx('span', { children: report.status === 'failed' ? 'Failed' : 'Completed' }),
                  !isRead ? jsx('span', { className: 'cron-bulletin-unread', children: 'New' }) : null
                ]
              })
            ]
          }),
          jsx(Codicon, { name: open ? 'chevron-down' : 'chevron-right', size: '0.8rem' })
        ]
      }),
      open
        ? jsxs('div', {
            className: 'cron-bulletin-body',
            children: [
              jsx(MessageTextContent, { text: report.markdown || '', media: true }),
              report.attachments?.length
                ? jsx('div', {
                    className: 'cron-bulletin-attachments',
                    children: report.attachments.map(attachment =>
                      jsxs('a', {
                        className: 'cron-bulletin-file',
                        href: attachment.url,
                        target: '_blank',
                        rel: 'noreferrer',
                        children: [
                          jsx(Codicon, { name: attachment.kind === 'image' ? 'file-media' : 'file', size: '0.75rem' }),
                          jsx('span', { children: attachment.name }),
                          jsx('span', { children: formatSize(attachment.size) })
                        ],
                        key: attachment.id
                      })
                    )
                  })
                : null,
              jsxs('div', {
                className: 'cron-bulletin-actions',
                children: [
                  jsx('button', {
                    className: 'cron-bulletin-action',
                    type: 'button',
                    onClick: event => {
                      event.stopPropagation()
                      onArchive(report.id, !report.archived)
                    },
                    children: report.archived ? 'Unarchive' : 'Archive'
                  }),
                  jsx('button', {
                    className: 'cron-bulletin-action',
                    type: 'button',
                    onClick: event => {
                      event.stopPropagation()
                      onHide(report)
                    },
                    children: isHidden ? 'Show job' : 'Hide job'
                  }),
                  jsx('button', {
                    className: 'cron-bulletin-action cron-bulletin-action-danger',
                    type: 'button',
                    onClick: event => {
                      event.stopPropagation()
                      onDelete(report.id)
                    },
                    children: 'Delete record'
                  })
                ]
              })
            ]
          })
        : null
    ]
  })
}

function BulletinPage() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [profile, setProfile] = useState('all')
  const [archived, setArchived] = useState('exclude')
  const [showHidden, setShowHidden] = useState(false)
  const [selectedGroupKey, setSelectedGroupKey] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [readIds, setReadIds] = useState(() => pluginContext.storage.get(READ_KEY, []))
  const [hiddenJobs, setHiddenJobs] = useState(() => pluginContext.storage.get(HIDDEN_KEY, []))
  const profilesQuery = useQuery({
    queryKey: [ID, 'profiles'],
    queryFn: () => pluginContext.rest('/profiles'),
    staleTime: 60000
  })
  const reportsQuery = useQuery({
    queryKey: [ID, 'reports', profile, archived],
    queryFn: () => pluginContext.rest(`/reports?limit=200&profile=${encodeURIComponent(profile)}&archived=${archived}`),
    refetchInterval: 15000
  })
  const reports = reportsQuery.data?.reports || []
  const visible = useMemo(() => filterReports(reports, query, status, hiddenJobs, showHidden), [reports, query, status, hiddenJobs, showHidden])
  const groups = useMemo(() => groupReports(visible), [visible])
  const selectedGroup = groups.find(group => group.key === selectedGroupKey) || groups[0]
  const selectedReports = selectedGroup ? (showHistory ? selectedGroup.reports : selectedGroup.reports.slice(0, 1)) : []
  const unread = unseenCount(reports, readIds)
  const readSet = useMemo(() => new Set(readIds), [readIds])

  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.cronBulletin = 'true'
    style.textContent = CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, [])

  useEffect(() => {
    if (selectedGroupKey && groups.some(group => group.key === selectedGroupKey)) return
    setSelectedGroupKey(groups[0]?.key || null)
  }, [groups, selectedGroupKey])

  const markRead = id => {
    setReadIds(current => {
      if (current.includes(id)) return current
      const next = [...current, id].slice(-2000)
      pluginContext.storage.set(READ_KEY, next)
      return next
    })
  }
  const markAllRead = () => {
    const next = reports.map(report => report.id).slice(-2000)
    pluginContext.storage.set(READ_KEY, next)
    setReadIds(next)
  }
  const toggleHidden = report => {
    const key = jobKey(report)
    setHiddenJobs(current => {
      const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key]
      pluginContext.storage.set(HIDDEN_KEY, next)
      return next
    })
  }
  const archiveReport = async (id, shouldArchive) => {
    const report = reports.find(item => item.id === id)
    const reportProfile = report?.profile || profile
    await pluginContext.rest(`/reports/${encodeURIComponent(id)}/archive?archived=${shouldArchive}&profile=${encodeURIComponent(reportProfile)}`, { method: 'POST' })
    await reportsQuery.refetch()
  }
  const deleteReport = async id => {
    if (!window.confirm('Delete this bulletin record? The original cron output will be preserved.')) return
    const report = reports.find(item => item.id === id)
    const reportProfile = report?.profile || profile
    await pluginContext.rest(`/reports/${encodeURIComponent(id)}?profile=${encodeURIComponent(reportProfile)}`, { method: 'DELETE' })
    await reportsQuery.refetch()
  }

  return jsx('main', {
    className: 'cron-bulletin',
    children: jsxs('div', {
      className: 'cron-bulletin-inner',
      children: [
        jsxs('header', {
          className: 'cron-bulletin-header',
          children: [
            jsxs('div', {
              children: [
                jsx('div', { className: 'cron-bulletin-kicker', children: 'Automation reports' }),
                jsx('h1', { className: 'cron-bulletin-title', children: 'Cron Bulletin' }),
                jsx('p', {
                  className: 'cron-bulletin-subtitle',
                  children: `${reports.length} reports · ${unread} unread · ${archived === 'only' ? 'archived' : 'local delivery'}`
                })
              ]
            }),
            jsxs('div', {
              className: 'cron-bulletin-header-actions',
              children: [
                unread
                  ? jsx(Button, { size: 'sm', variant: 'ghost', onClick: markAllRead, children: 'Mark all read' })
                  : null,
                jsx(Button, {
                  size: 'sm',
                  variant: 'ghost',
                  onClick: () => reportsQuery.refetch(),
                  disabled: reportsQuery.isFetching,
                  children: reportsQuery.isFetching ? 'Refreshing…' : 'Refresh'
                })
              ]
            })
          ]
        }),
        jsx('div', {
          className: 'cron-bulletin-chips',
          role: 'tablist',
          children: (reportsQuery.data?.profiles || profilesQuery.data?.profiles || [{ id: 'all', label: 'All profiles' }]).map(option =>
            jsx('button', {
              className: 'cron-bulletin-chip',
              type: 'button',
              role: 'tab',
              'aria-selected': profile === option.id,
              'data-active': profile === option.id,
              onClick: () => setProfile(option.id),
              children: option.label
            }, option.id)
          )
        }),
        jsxs('div', {
          className: 'cron-bulletin-summary',
          children: [
            jsxs('div', { className: 'cron-bulletin-stat', children: [jsx('div',{className:'cron-bulletin-stat-value',children:groups.length}), jsx('div',{className:'cron-bulletin-stat-label',children:'Jobs'})] }),
            jsxs('div', { className: 'cron-bulletin-stat', children: [jsx('div',{className:'cron-bulletin-stat-value',children:visible.length}), jsx('div',{className:'cron-bulletin-stat-label',children:'Visible runs'})] }),
            jsxs('div', { className: 'cron-bulletin-stat', children: [jsx('div',{className:'cron-bulletin-stat-value',children:unread}), jsx('div',{className:'cron-bulletin-stat-label',children:'Unread'})] })
          ]
        }),
        jsxs('div', {
          className: 'cron-bulletin-controls',
          children: [
            jsx(SearchField, {
              value: query,
              onChange: setQuery,
              placeholder: 'Search reports…',
              'aria-label': 'Search reports'
            }),
            jsxs('select', {
              className: 'cron-bulletin-filter',
              value: status,
              onChange: event => setStatus(event.target.value),
              'aria-label': 'Filter by status',
              children: [
                jsx('option', { value: 'all', children: 'All statuses' }),
                jsx('option', { value: 'completed', children: 'Completed' }),
                jsx('option', { value: 'failed', children: 'Failed' })
              ]
            }),
            jsxs('select', {
              className: 'cron-bulletin-filter',
              value: archived,
              onChange: event => setArchived(event.target.value),
              'aria-label': 'Filter archived reports',
              children: [
                jsx('option', { value: 'exclude', children: 'Active reports' }),
                jsx('option', { value: 'only', children: 'Archived only' }),
                jsx('option', { value: 'all', children: 'Active + archived' })
              ]
            }),
            jsxs('select', {
              className: 'cron-bulletin-filter',
              value: showHidden ? 'all' : 'visible',
              onChange: event => setShowHidden(event.target.value === 'all'),
              'aria-label': 'Filter hidden jobs',
              children: [
                jsx('option', { value: 'visible', children: hiddenJobs.length ? `Visible jobs (${hiddenJobs.length} hidden)` : 'Visible jobs' }),
                jsx('option', { value: 'all', children: 'Include hidden jobs' })
              ]
            })
          ]
        }),
        reportsQuery.isPending
          ? jsx('div', { className: 'cron-bulletin-center', children: jsx(GlyphSpinner, {}) })
          : reportsQuery.isError
            ? jsx(ErrorState, {
                title: 'Could not load cron reports',
                description: reportsQuery.error?.message || 'The Cron Bulletin backend is unavailable.',
                action: jsx(Button, { onClick: () => reportsQuery.refetch(), children: 'Try again' })
              })
            : visible.length === 0
              ? jsx(EmptyState, {
                  title: reports.length ? 'No matching reports' : 'No cron reports yet',
                  description: reports.length
                    ? 'Change the search or status filter.'
                    : 'Cron jobs using local delivery will appear here after their first run.'
                })
              : jsx('div', {
                  className: 'cron-bulletin-inbox',
                  children: [
                    jsx('div', {
                      className: 'cron-bulletin-groups',
                      children: groups.map(group =>
                        jsxs('button', {
                          className: 'cron-bulletin-group',
                          type: 'button',
                          'data-selected': selectedGroup?.key === group.key,
                          onClick: () => {
                            setSelectedGroupKey(group.key)
                            setShowHistory(false)
                          },
                          children: [
                            jsx('div', { className: 'cron-bulletin-group-name', children: group.job_name || group.job_id }),
                            jsx('div', { className: 'cron-bulletin-group-meta', children: `${group.profile} · ${group.reports.length} run${group.reports.length === 1 ? '' : 's'}` })
                          ]
                        }, group.key)
                      )
                    }),
                    jsx('section', {
                      className: 'cron-bulletin-detail',
                      children: selectedGroup
                        ? jsxs(Fragment, {
                            children: [
                              selectedGroup.reports.length > 1
                                ? jsx(Button, {
                                    size: 'sm',
                                    variant: 'ghost',
                                    onClick: () => setShowHistory(value => !value),
                                    children: showHistory ? 'Show latest only' : `Show ${selectedGroup.reports.length} run history`
                                  })
                                : null,
                              !showHistory && selectedGroup.reports.length > 1
                                ? jsx('div', { className: 'cron-bulletin-history', children: 'Showing the latest run. Expand to view history.' })
                                : null,
                              jsx('div', {
                                className: 'cron-bulletin-list',
                                children: selectedReports.map(report =>
                                  jsx(ReportCard, {
                                    report,
                                    initialOpen: report.id === selectedGroup.latest?.id,
                                    isRead: readSet.has(report.id),
                                    isHidden: hiddenJobs.includes(jobKey(report)),
                                    onRead: markRead,
                                    onHide: toggleHidden,
                                    onArchive: archiveReport,
                                    onDelete: deleteReport
                                  }, report.id)
                                )
                              })
                            ]
                          })
                        : null
                    })
                  ]
                })
      ]
    })
  })
}

export default {
  id: ID,
  name: 'Cron Bulletin',
  register(ctx) {
    pluginContext = ctx
    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: ROUTE },
        render: () => jsx(BulletinPage, {})
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: ROUTE, label: 'Cron Bulletin', codicon: 'inbox' }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'cron-bulletin.open',
          label: 'Open Cron Bulletin',
          keywords: ['cron', 'reports', 'bulletin', 'automation'],
          run: () => host.navigate(ROUTE)
        }
      }
    ])
  }
}
