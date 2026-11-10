import React, { useEffect, useState } from 'react'

export const bytes = value => {
  if (!Number.isFinite(value)) return 'Not reported'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = value, unit = 0
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++ }
  return `${n.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

export default function ExperimentDetails({ run, api, Dialog, close, reuse, remove, disabled }) {
  const [index, setIndex] = useState(0)
  const [image, setImage] = useState(null)
  const [zoom, setZoom] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const output = run.outputs?.[index]
  useEffect(() => {
    let alive = true
    setImage(null); setZoom(null); setError(''); setNotice('')
    if (!output) return () => { alive = false }
    setLoading(true)
    api.viewOriginal(run.runId, output.file).then(value => {
      if (alive) setImage(value)
    }).catch(e => { if (alive) setError(e.message || 'Original file is unavailable.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [run.runId, output?.file])
  const save = async () => {
    setSaving(true); setError(''); setNotice('')
    try { if (await api.saveOutput(run.runId, output.file)) setNotice('Original image saved as a new file.') }
    catch (e) { setError(e.message || 'Could not save. Choose a new filename; existing files are not overwritten.') }
    finally { setSaving(false) }
  }
  return <Dialog title={run.experimentName} close={() => !saving && close()} wide>
    <div className="experiment-detail">
      <section className="detail-artwork">
        <div className="detail-image-toolbar">
          <span>{run.outputs?.length || 0} image{run.outputs?.length === 1 ? '' : 's'}</span>
          <div className="actions">
            <button disabled={!image} onClick={() => setZoom(null)}>Fit image</button>
            <button disabled={!image} onClick={() => setZoom(1)}>100%</button>
            <button disabled={!image} aria-label="Zoom image out" onClick={() => setZoom(v => Math.max(.1, (v ?? .5) / 1.25))}>−</button>
            <button disabled={!image} aria-label="Zoom image in" onClick={() => setZoom(v => Math.min(4, (v ?? .5) * 1.25))}>＋</button>
          </div>
        </div>
        <div className={`detail-image-stage ${zoom === null ? 'fit' : 'zoomed'}`}>
          {loading ? <p role="status">Loading original image…</p> : image ?
            <img src={image.url} alt={`Generated output ${index + 1}`} draggable={false} style={zoom === null ? undefined : { width: image.width * zoom, height: image.height * zoom }} /> :
            <p>{output ? 'Original file unavailable. Experiment details are still available.' : `No completed image · ${run.result}`}</p>}
        </div>
        {run.outputs?.length > 1 && <div className="detail-thumbnails" aria-label="Generated images">
          {run.outputs.map((item, i) => <button key={item.file} aria-label={`View output ${i + 1}`} aria-pressed={index === i} onClick={() => setIndex(i)}>
            {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span>{i + 1}</span>}
          </button>)}
        </div>}
        <button className="primary" disabled={!image || saving || disabled} onClick={save}>{saving ? 'Saving…' : 'Save image as…'}</button>
        <p className="muted">Saves the original file at full resolution, without re-generating or recompressing it.</p>
        {notice && <p role="status">{notice}</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
      </section>
      <aside className="detail-metadata">
        <span className="eyebrow">EXPERIMENT DETAILS</span>
        <dl className="detail-facts">
          <dt>Status</dt><dd>{run.result}</dd>
          <dt>Created</dt><dd>{run.createdAt || run.completedAt ? new Date(run.createdAt || run.completedAt).toLocaleString() : 'Not reported'}</dd>
          <dt>Model</dt><dd>{run.model || 'Not reported'}</dd>
          <dt>Response + decoding</dt><dd>{Number.isFinite(run.providerTimingMs) ? `${(run.providerTimingMs / 1000).toFixed(2)} s` : 'Not reported'}</dd>
          <dt>Resolution</dt><dd>{output?.width && output?.height ? `${output.width} × ${output.height}` : 'Not reported'}</dd>
          <dt>File size</dt><dd>{bytes(output?.byte_count)}</dd>
          <dt>Format / quality</dt><dd>{output?.format || run.outputFormat || output?.file?.split('.').at(-1) || '—'} · {run.quality || '—'}</dd>
          <dt>Estimated cost</dt><dd>{Number.isFinite(run.calculatedChargeUsd) ? `$${run.calculatedChargeUsd.toFixed(4)}` : 'Not reported'}</dd>
        </dl>
        <p className="muted">Time covers response/download and decoding, not time spent confirming. Cost is an estimate for the whole request.</p>
        <details open><summary>Prompt used</summary><pre className="detail-prompt">{run.prompt || 'Not recorded'}</pre></details>
        <details><summary>Parameters & request identity</summary><pre>{JSON.stringify({ runId: run.runId, providerRequestId: run.providerRequestId, transportCalls: run.transportCalls, settings: run.settings }, null, 2)}</pre></details>
        <div className="detail-footer">
          <button disabled={disabled || saving} onClick={() => reuse(run)}>Use as next experiment</button>
          <button className="danger" disabled={disabled || saving} onClick={() => remove(run)}>Delete experiment…</button>
        </div>
      </aside>
    </div>
  </Dialog>
}
