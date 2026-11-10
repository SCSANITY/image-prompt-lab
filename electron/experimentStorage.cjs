'use strict'

const fs = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const RECORD_FILES = new Set(['request.json', 'REQUEST_STARTED.json', 'response.json', 'evidence.json', 'local-inputs.json', 'local-history.json'])
const ID = /^[A-Za-z0-9_-]{1,160}$/
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)
const inside = (parent, child) => { const relative = path.relative(parent, child); return !relative.startsWith('..') && !path.isAbsolute(relative) }
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const error = message => new Error(message)

async function regular(target, directory = false) {
  const stat = await fs.lstat(target)
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (!directory && stat.nlink !== 1)) throw error('Linked or unexpected files cannot be moved or deleted.')
  if (!samePath(await fs.realpath(target), target)) throw error('Linked storage paths cannot be moved or deleted.')
  return stat
}
async function optionalStat(target, directory = false) {
  try { return await regular(target, directory) } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}
async function hashFile(target) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of createReadStream(target)) hash.update(chunk)
  return hash.digest('hex')
}
async function fileInfo(target) {
  const stat = await regular(target)
  return { path: target, bytes: stat.size, hash: await hashFile(target) }
}
async function jsonFile(target, optional = false) {
  const stat = await optionalStat(target)
  if (!stat && optional) return null
  if (!stat || stat.size > 512 * 1024) throw error('Experiment metadata is missing or too large.')
  return JSON.parse(await fs.readFile(target, 'utf8'))
}
async function unchanged(file) {
  try { const current = await fileInfo(file.path); return current.hash === file.hash && current.bytes === file.bytes } catch { return false }
}

function createExperimentStorage({ profileRoot, defaultOutputRoot, copyFile = fs.copyFile, unlink = fs.unlink, protectedInputPaths = async () => [] }) {
  const configPath = path.join(profileRoot, 'experiment-storage.json')
  const ownershipRoot = path.join(profileRoot, 'owned-experiment-outputs')
  let roots = { evidenceRoot: path.join(profileRoot, 'prompt-lab-run-records'), outputRoot: defaultOutputRoot }
  let active = false
  const plans = new Map()
  const selectedInputs = new Set()
  const receiptPath = (runId, file) => path.join(ownershipRoot, `${digest([runId, process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)])}.json`)
  async function owns(runId, file) {
    const receipt = await jsonFile(receiptPath(runId, file.path), true)
    return !!receipt && receipt.schemaVersion === 1 && receipt.runId === runId && samePath(receipt.path || '', file.path) && receipt.hash === file.hash && receipt.bytes === file.bytes
  }
  async function recordOwnership(runId, files) {
    if (!ID.test(runId)) throw error('Invalid ownership identity.')
    await fs.mkdir(ownershipRoot, { recursive: true })
    await regular(ownershipRoot, true)
    for (const file of files) {
      if (await owns(runId, file)) continue
      await fs.writeFile(receiptPath(runId, file.path), JSON.stringify({ schemaVersion: 1, runId, path: file.path, bytes: file.bytes, hash: file.hash }), { flag: 'wx' })
    }
  }
  // Main-process runner callback only; never exposed through preload or import.
  async function recordGeneratedOutputs(result) {
    const runId = String(result.evidence?.run_id || '')
    const directory = path.resolve(result.evidenceDirectory || '')
    const outputDirectory = path.resolve(result.outputDirectory || '')
    if (!ID.test(runId) || !samePath(path.dirname(directory), roots.evidenceRoot) || !path.basename(directory).startsWith(`${runId}_`) || path.basename(outputDirectory) !== path.basename(directory)) throw error('Invalid generated output identity.')
    const files = []
    for (const output of [...(result.evidence.outputs || []), ...(result.evidence.partial_outputs || [])]) {
      if (!/^(output|partial)-\d{2}\.(png|jpg|webp)$/.test(output.file || '')) throw error('Invalid generated output filename.')
      const info = await fileInfo(path.join(outputDirectory, output.file))
      if (info.hash !== String(output.sha256 || '').toLowerCase() || info.bytes !== output.byte_count) throw error('Generated output verification failed.')
      files.push(info)
    }
    await recordOwnership(runId, files)
  }

  async function init() {
    const saved = await jsonFile(configPath, true)
    if (saved) {
      if (saved.schemaVersion !== 1 || !path.isAbsolute(saved.evidenceRoot || '') || !path.isAbsolute(saved.outputRoot || '')) throw error('Experiment storage settings are invalid. Original data has not been changed.')
      roots = { evidenceRoot: path.resolve(saved.evidenceRoot), outputRoot: path.resolve(saved.outputRoot) }
      await regular(roots.evidenceRoot, true)
      await regular(roots.outputRoot, true)
    }
    return { ...roots }
  }
  async function exclusive(operation) {
    if (active) throw error('Wait for the current generation or storage operation to finish.')
    active = true
    try { return await operation() } finally { active = false }
  }
  async function inventory() {
    if (!await optionalStat(roots.evidenceRoot, true)) return { records: [], protectedPaths: [], fingerprint: digest([]) }
    const records = []
    for (const entry of await fs.readdir(roots.evidenceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw error('Unexpected items in the experiment records folder. Nothing has been removed.')
      const directory = path.join(roots.evidenceRoot, entry.name)
      await regular(directory, true)
      const request = await jsonFile(path.join(directory, 'request.json'))
      const evidence = await jsonFile(path.join(directory, 'evidence.json'), true)
      const id = String(request.run_id || '')
      if (!ID.test(id) || !entry.name.startsWith(`${id}_`) || (evidence && evidence.run_id !== id) || records.some(r => r.runId === id)) throw error('An experiment record has an ambiguous identity. Storage changes are paused.')
      const files = []
      for (const name of (await fs.readdir(directory)).sort()) {
        if (!RECORD_FILES.has(name)) throw error('An experiment folder contains unrecognized files. Nothing has been removed.')
        const info = await fileInfo(path.join(directory, name))
        if (info.bytes > 512 * 1024) throw error('Experiment metadata is too large for safe storage management.')
        files.push(info)
      }
      const inputs = await jsonFile(path.join(directory, 'local-inputs.json'), true)
      const protectedPaths = [...(inputs?.images || []).map(v => v.path), inputs?.mask?.path].filter(p => typeof p === 'string' && path.isAbsolute(p)).map(p => path.resolve(p))
      const locator = await jsonFile(path.join(directory, 'local-history.json'), true)
      if (locator && (locator.run_id !== id || locator.schema_version !== 1 || !path.isAbsolute(locator.output_directory || ''))) throw error('An experiment output locator is invalid.')
      const outputDirectory = locator ? path.resolve(locator.output_directory) : path.join(roots.outputRoot, entry.name)
      const imageRecords = [...(evidence?.outputs || []), ...(evidence?.partial_outputs || [])]
      const images = []
      let missingImages = 0
      let blockedImages = 0
      // Only the app-created per-run directory can be a cleanup target.
      const ownedDirectory = path.basename(outputDirectory) === entry.name && !inside(directory, outputDirectory) && !inside(outputDirectory, directory)
      if (imageRecords.length && ownedDirectory) {
        const exists = await optionalStat(outputDirectory, true)
        for (const output of imageRecords) {
          if (!FILE.test(output.file || '') || output.file === '.' || output.file === '..') throw error('Unsafe output filename in experiment metadata.')
          const target = path.join(outputDirectory, output.file)
          if (!exists || !await optionalStat(target)) { missingImages++; continue }
          const info = await fileInfo(target)
          if (!/^[a-f0-9]{64}$/i.test(output.sha256 || '') || info.hash !== output.sha256.toLowerCase() || info.bytes !== output.byte_count) { blockedImages++; continue }
          if (!images.some(v => samePath(v.path, info.path))) images.push({ ...info, owned: await owns(id, info) })
        }
      } else if (imageRecords.length) blockedImages += imageRecords.length
      records.push({ runId: id, name: entry.name, title: String(request.experiment_name || 'Untitled experiment'), directory, files, images, outputDirectory, protectedPaths, missingImages, blockedImages })
    }
    const protectedPaths = [...records.flatMap(r => r.protectedPaths), ...await protectedInputPaths(), ...selectedInputs].filter(p => typeof p === 'string' && path.isAbsolute(p))
    // A selected input may refer to a generated image through a directory link.
    const resolvedInputs = await Promise.all(protectedPaths.map(p => fs.realpath(p).catch(() => p)))
    // A previous generated result may now be an input to another experiment.
    for (const record of records) {
      record.images = record.images.map(image => ({ ...image, protected: [...protectedPaths, ...resolvedInputs].some(p => samePath(p, image.path)) }))
    }
    records.sort((a, b) => a.name.localeCompare(b.name))
    return { records, protectedPaths, fingerprint: digest(records) }
  }
  const summary = records => ({
    runCount: records.length,
    recordBytes: records.reduce((n, r) => n + r.files.reduce((s, f) => s + f.bytes, 0), 0),
    imageBytes: records.reduce((n, r) => n + r.images.reduce((s, f) => s + f.bytes, 0), 0),
    reclaimableImageBytes: records.reduce((n, r) => n + r.images.filter(f => f.owned && !f.protected).reduce((s, f) => s + f.bytes, 0), 0),
    imageCount: records.reduce((n, r) => n + r.images.length, 0),
    missingImages: records.reduce((n, r) => n + r.missingImages, 0),
    protectedImages: records.reduce((n, r) => n + r.blockedImages + r.images.filter(f => f.protected || !f.owned).length, 0),
  })
  async function status() {
    const state = { ...roots, profileRoot, busy: active }
    try { return { ...state, ...summary((await inventory()).records) } }
    catch (e) { return { ...state, error: e.message } }
  }
  function remember(plan) {
    plans.clear()
    const token = crypto.randomUUID()
    plans.set(token, { ...plan, expires: Date.now() + 10 * 60 * 1000 })
    return token
  }
  async function prepareDelete(runId) {
    const scan = await inventory()
    const record = scan.records.find(r => r.runId === runId)
    if (!record) throw error('This experiment no longer exists.')
    const token = remember({ kind: 'delete', scan, runId })
    return { token, title: record.title, ...summary([record]) }
  }
  async function take(token, kind) {
    const plan = plans.get(token)
    plans.delete(token)
    if (!plan || plan.kind !== kind || plan.expires < Date.now()) throw error('This confirmation expired. Review the operation again.')
    if ((await inventory()).fingerprint !== plan.scan.fingerprint) throw error('Experiment files changed after the preview. Review the operation again.')
    return plan
  }
  async function removeFiles(files, copies = null) {
    let removedBytes = 0
    const retained = []
    for (const file of files) {
      if (!await unchanged(file) || (copies && !await unchanged(copies.get(file.path)))) { retained.push(file.path); continue }
      try { await unlink(file.path); removedBytes += file.bytes } catch { retained.push(file.path) }
    }
    return { removedBytes, retained }
  }
  async function removeMetadata(files) {
    // At most six bounded JSON files. Restore removed metadata on a cleanup
    // failure so the experiment remains discoverable and retryable.
    const backup = new Map()
    for (const file of files) {
      const data = await fs.readFile(file.path)
      if (data.length !== file.bytes || crypto.createHash('sha256').update(data).digest('hex') !== file.hash) throw error('Experiment metadata changed. Review deletion again.')
      backup.set(file.path, data)
    }
    const removed = []
    for (const file of files) {
      try {
        if (!await unchanged(file)) throw error('Metadata changed during deletion.')
        await unlink(file.path)
        removed.push(file)
      } catch {
        let unrestored = 0
        for (const old of removed) {
          try { await fs.writeFile(old.path, backup.get(old.path), { flag: 'wx' }) }
          catch { if (!await unchanged(old)) unrestored += old.bytes }
        }
        return { removedBytes: unrestored, retained: [file.path], message: unrestored ? 'Metadata cleanup and recovery could not finish. Remaining files were kept; check storage before retrying.' : 'Metadata cleanup failed. The record was restored; review and retry.' }
      }
    }
    return { removedBytes: removed.reduce((n, f) => n + f.bytes, 0), retained: [] }
  }
  async function deleteRun(token, withImages) {
    if (typeof withImages !== 'boolean') throw error('Choose what to delete.')
    return exclusive(async () => {
      const { scan, runId } = await take(token, 'delete')
      const record = scan.records.find(r => r.runId === runId)
      const images = withImages ? await removeFiles(record.images.filter(f => f.owned && !f.protected)) : { removedBytes: 0, retained: [] }
      if (images.retained.length) return { deleted: false, removedBytes: images.removedBytes, retainedFiles: images.retained.length, message: 'Some image files could not be removed. The history record was kept; review and retry.' }
      // Remove request.json last, and restore metadata if any removal fails.
      const files = [...record.files].sort((a, b) => Number(path.basename(a.path) === 'request.json') - Number(path.basename(b.path) === 'request.json'))
      const metadata = await removeMetadata(files)
      await fs.rmdir(record.directory).catch(() => {})
      if (images.removedBytes) await fs.rmdir(record.outputDirectory).catch(() => {})
      return { deleted: metadata.retained.length === 0, runId, removedBytes: images.removedBytes + metadata.removedBytes, retainedFiles: metadata.retained.length, message: metadata.message, protectedImages: record.blockedImages + record.images.filter(f => f.protected || !f.owned).length }
    })
  }
  async function prepareMigration(parent) {
    await regular(parent, true)
    const scan = await inventory()
    if (scan.records.some(r => r.blockedImages)) throw error('Some images are modified or outside an owned run folder. Resolve these records before moving storage; no files have been changed.')
    const destination = path.join(path.resolve(parent), `image-prompt-lab-data-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)
    if (inside(roots.evidenceRoot, destination) || inside(roots.outputRoot, destination) || inside(profileRoot, destination)) throw error('Choose a directory outside the current experiment folders and app profile.')
    const token = remember({ kind: 'migration', scan, destination })
    return { token, destination, ...summary(scan.records) }
  }
  async function migrate(token) {
    return exclusive(async () => {
      const plan = await take(token, 'migration')
      await regular(path.dirname(plan.destination), true)
      const next = { evidenceRoot: path.join(plan.destination, 'records'), outputRoot: path.join(plan.destination, 'images') }
      await fs.mkdir(plan.destination) // Never merge with or overwrite an existing directory.
      await fs.mkdir(next.evidenceRoot)
      await fs.mkdir(next.outputRoot)
      const copies = new Map()
      try {
        for (const record of plan.scan.records) {
          const newRecord = path.join(next.evidenceRoot, record.name)
          const newImages = path.join(next.outputRoot, record.name)
          await fs.mkdir(newRecord)
          await fs.mkdir(newImages)
          for (const file of [...record.files.filter(f => path.basename(f.path) !== 'local-history.json'), ...record.images]) {
            const target = path.join(record.images.includes(file) ? newImages : newRecord, path.basename(file.path))
            await copyFile(file.path, target, require('node:fs').constants.COPYFILE_EXCL)
            const copied = await fileInfo(target)
            if (copied.bytes !== file.bytes || copied.hash !== file.hash) throw error('Copied file verification failed.')
            copies.set(file.path, copied)
          }
          const newLocator = path.join(newRecord, 'local-history.json')
          await fs.writeFile(newLocator, JSON.stringify({ schema_version: 1, run_id: record.runId, output_directory: newImages }), { flag: 'wx' })
          const oldLocator = record.files.find(f => path.basename(f.path) === 'local-history.json')
          if (oldLocator) copies.set(oldLocator.path, await fileInfo(newLocator))
          // These are newly created, verified copies, not ownership adoption
          // of the imported/legacy paths. Import cannot write these receipts.
          await recordOwnership(record.runId, record.images.map(f => copies.get(f.path)))
        }
        if ((await inventory()).fingerprint !== plan.scan.fingerprint) throw error('Original files changed during migration.')
        for (const copy of copies.values()) if (!await unchanged(copy)) throw error('A destination file changed during migration.')
        const temporary = `${configPath}.${crypto.randomUUID()}.tmp`
        await fs.mkdir(profileRoot, { recursive: true })
        try {
          await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, ...next }), { flag: 'wx' })
          await fs.rename(temporary, configPath)
        } finally { await fs.unlink(temporary).catch(() => {}) }
      } catch (e) {
        throw error(`Storage was not switched; originals are untouched. An incomplete copy remains at ${plan.destination}. ${e.message}`)
      }
      roots = next
      let removedBytes = 0
      let retainedFiles = 0
      for (const record of plan.scan.records) {
        const result = await removeFiles([...record.images.filter(f => f.owned && !f.protected), ...record.files], copies)
        removedBytes += result.removedBytes
        retainedFiles += result.retained.length + record.images.filter(f => f.protected || !f.owned).length
        await fs.rmdir(record.directory).catch(() => {})
        if (record.images.some(f => f.owned && !f.protected)) await fs.rmdir(record.outputDirectory).catch(() => {})
      }
      return { ...next, removedBytes, retainedFiles, missingImages: plan.scan.records.reduce((n, r) => n + r.missingImages, 0) }
    })
  }
  return { init, exclusive, status, prepareDelete, deleteRun, prepareMigration, migrate, recordGeneratedOutputs, protectInput: p => { if (path.isAbsolute(p || '')) selectedInputs.add(path.resolve(p)) }, roots: () => ({ ...roots }) }
}

module.exports = { createExperimentStorage }
