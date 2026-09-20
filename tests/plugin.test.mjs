import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginPath = path.join(root, 'desktop', 'plugin.js')

function loadPluginInternals() {
  let source = fs.readFileSync(pluginPath, 'utf8')
  source = source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  source = source.replace('export default', 'globalThis.__plugin =')
  source += '\nglobalThis.__test = { filterReports, groupReports, unseenCount, reportFromSession }\n'
  const context = {
    console,
    globalThis: null,
    URLSearchParams,
    window: { setInterval() {}, clearInterval() {} },
  }
  context.globalThis = context
  vm.runInNewContext(source, context, { filename: pluginPath })
  return context.__test
}

const reports = [
  { id: '1', job_id: 'weather', job_name: 'Morning Weather', markdown: 'Sunny', status: 'completed' },
  { id: '2', job_id: 'deploy', job_name: 'Deploy Check', markdown: 'TLS failed', status: 'failed' },
]

test('filterReports filters by status and case-insensitive report text', () => {
  const { filterReports } = loadPluginInternals()

  assert.deepEqual(filterReports(reports, 'FAILED', 'all').map(row => row.id), ['2'])
  assert.deepEqual(filterReports(reports, '', 'failed').map(row => row.id), ['2'])
  assert.deepEqual(filterReports(reports, 'morning', 'completed').map(row => row.id), ['1'])
})

test('filterReports hides configured jobs but can reveal them', () => {
  const { filterReports } = loadPluginInternals()
  const rows = reports.map(row => ({ ...row, profile: 'active' }))

  assert.deepEqual(filterReports(rows, '', 'all', ['active:deploy']).map(row => row.id), ['1'])
  assert.deepEqual(filterReports(rows, '', 'all', ['active:deploy'], true).map(row => row.id), ['1', '2'])
})

test('groupReports keeps runs together by profile and job', () => {
  const { groupReports } = loadPluginInternals()
  const groups = groupReports([
    { ...reports[0], profile: 'alpha', modified_at: 1 },
    { ...reports[0], id: '3', profile: 'alpha', modified_at: 2 },
    { ...reports[0], id: '4', profile: 'beta', modified_at: 3 }
  ])

  assert.equal(groups.length, 2)
  assert.equal(groups.find(group => group.profile === 'alpha').reports.length, 2)
  assert.equal(groups.find(group => group.profile === 'alpha').reports[0].id, '3')
})

test('unseenCount counts only report ids absent from persisted read state', () => {
  const { unseenCount } = loadPluginInternals()

  assert.equal(unseenCount(reports, ['1']), 1)
  assert.equal(unseenCount(reports, ['1', '2']), 0)
  assert.equal(unseenCount(reports, null), 2)
})

test('reportFromSession uses the last visible assistant message', () => {
  const { reportFromSession } = loadPluginInternals()
  const report = reportFromSession(
    { id: 'cron-1', title: 'Daily Finance', source: 'cron', started_at: 123 },
    {
      messages: [
        { role: 'user', text: 'Run the report' },
        { role: 'assistant', text: 'intermediate', display_kind: 'hidden' },
        { role: 'assistant', text: '# Results\n\nProfit is up.' }
      ]
    }
  )

  assert.equal(report.id, 'cron-1')
  assert.equal(report.job_name, 'Daily Finance')
  assert.equal(report.markdown, '# Results\n\nProfit is up.')
  assert.equal(report.status, 'completed')
  assert.equal(report.modified_at, 123)
})

test('reportFromSession marks failed cron sessions', () => {
  const { reportFromSession } = loadPluginInternals()
  const report = reportFromSession(
    { id: 'cron-2', title: 'Deploy (FAILED)', source: 'cron', started_at: 456 },
    { messages: [{ role: 'assistant', text: '## Error\n\nTimeout' }] }
  )

  assert.equal(report.job_name, 'Deploy')
  assert.equal(report.status, 'failed')
})
