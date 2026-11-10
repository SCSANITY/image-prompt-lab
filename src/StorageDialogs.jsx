import React, { useEffect, useState } from 'react'
import { bytes } from './ExperimentDetails'

export function DeleteExperiment({ plan, api, Dialog, close, completed, onBusy }) {
  const [withImages, setWithImages] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const remove = async () => {
    setPending(true); onBusy(true); setError('')
    try {
      const result = await api.deleteRun(plan.token, withImages)
      await completed(result)
    } catch (e) { setError(`${e.message} Close this dialog and review the deletion again.`) }
    finally { setPending(false); onBusy(false) }
  }
  return <Dialog title="Delete experiment" close={() => !pending && close()}>
    <p><strong>{plan.title}</strong></p>
    <fieldset disabled={pending} className="storage-options">
      <label><input type="radio" name="delete-mode" checked={!withImages} onChange={() => setWithImages(false)} /><span><strong>Only delete the record</strong><small>Remove history and its assessment. Keep generated images on disk.</small></span></label>
      <label><input type="radio" name="delete-mode" checked={withImages} onChange={() => setWithImages(true)} /><span><strong>Delete record and generated images</strong><small>Also remove verified generated files belonging to this experiment.</small></span></label>
    </fieldset>
    <div className="storage-total"><span>Estimated space released</span><strong>{bytes(plan.recordBytes + (withImages ? plan.reclaimableImageBytes : 0))}</strong></div>
    <p className="muted">Source / Target originals and saved Prompt library versions are never deleted. This action does not use a recycle bin.</p>
    {!!plan.protectedImages && <p>{plan.protectedImages} shared, changed or unverified image(s) will be kept.</p>}
    {!!plan.missingImages && <p>{plan.missingImages} image(s) are already missing.</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="actions"><button disabled={pending} onClick={close}>Cancel</button><button className="danger" disabled={pending || !!error} onClick={remove}>{pending ? 'Deleting…' : 'Delete selected data'}</button></div>
  </Dialog>
}

export default function StorageDialog({ api, Dialog, close, changed, onBusy, disabled }) {
  const [state, setState] = useState(null)
  const [plan, setPlan] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let alive = true
    api.storageStatus().then(v => { if (alive) setState(v) }).catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [])
  const choose = async () => {
    setPending(true); setError(''); setNotice(''); setPlan(null)
    try { setPlan(await api.pickStorage()) } catch (e) { setError(e.message) }
    finally { setPending(false) }
  }
  const migrate = async () => {
    setPending(true); onBusy(true); setError('')
    try {
      const result = await api.migrateStorage(plan.token)
      setPlan(null)
      setNotice(`Storage moved and verified. Released ${bytes(result.removedBytes)} at the old locations.${result.retainedFiles ? ` ${result.retainedFiles} original file(s) were retained (protected inputs or cleanup could not finish).` : ''}${result.missingImages ? ` ${result.missingImages} missing image(s) remain unavailable.` : ''}`)
      setState(await api.storageStatus())
      await changed(result)
    } catch (e) { setPlan(null); setError(e.message) }
    finally { setPending(false); onBusy(false) }
  }
  return <Dialog title="Data & storage" close={() => !pending && close()}>
    <p className="muted">Move experiment records and generated images to another drive. Input originals stay where they are.</p>
    {!state ? <p role="status">Measuring experiment data…</p> : <>
      <dl className="storage-paths"><dt>Experiment records</dt><dd>{state.evidenceRoot}</dd><dt>Default image destination</dt><dd>{state.outputRoot}</dd></dl>
      {state.error ? <p className="notice error">{state.error}</p> : <div className="storage-total"><span>{state.runCount} experiments · {state.imageCount} verified images</span><strong>{bytes(state.recordBytes + state.imageBytes)}</strong></div>}
      <p className="muted">Totals cover all stored experiments, not just the latest 50 shown in the gallery. No automatic cleanup runs. Images saved to a custom destination are included when their records can verify them.</p>
      <details><summary>Small app profile stays in Windows</summary><p className="path-text">{state.profileRoot}</p><p>Prompt library, notes, UI settings and the encrypted API key stay in this small profile. This move targets experiment records and generated image files.</p></details>
      {!plan && <button disabled={pending || disabled || !!state.error} onClick={choose}>{pending ? 'Preparing…' : 'Choose data folder…'}</button>}
    </>}
    {plan && <section className="migration-preview">
      <h3>Review the move</h3><p className="path-text">{plan.destination}</p>
      <p>{plan.runCount} experiments · {plan.imageCount} images · {bytes(plan.recordBytes + plan.imageBytes)} to copy.</p>
      <ol><li>Copy files to a new, separate data folder.</li><li>Verify every copied file before switching storage.</li><li>Remove only verified originals. Keep source / target inputs.</li></ol>
      {!!plan.missingImages && <p>{plan.missingImages} missing image(s) cannot be recovered; their records will be preserved.</p>}
      {!!plan.protectedImages && <p>{plan.protectedImages} shared input image(s) will also remain at their original paths.</p>}
      <div className="actions"><button disabled={pending} onClick={() => setPlan(null)}>Cancel move</button><button className="primary" disabled={pending || disabled} onClick={migrate}>{pending ? 'Copying & verifying…' : 'Move verified data'}</button></div>
      <p className="muted">Keep the app open until the operation finishes. A failed copy does not remove originals.</p>
    </section>}
    {notice && <p role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </Dialog>
}
