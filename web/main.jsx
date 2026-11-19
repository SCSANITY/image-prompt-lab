import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  DEFAULT_SETTINGS,
  MODELS,
  OUTPUT_FORMATS,
  QUALITY_VALUES,
} from '../core/contract.mjs'
import InputSlots from '../src/InputSlots.jsx'
import SizeSelect from './SizeSelect.jsx'
import { generateImage, prepareImageFile } from './image-edit.mjs'
import './styles.css'

function useImageAsset() {
  const [image, setImage] = useState(null)
  const url = image?.previewUrl
  useEffect(() => {
    if (url) return () => URL.revokeObjectURL(url)
  }, [url])
  return [image, setImage]
}

async function readImagePreview(blob) {
  const previewUrl = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = previewUrl
    await image.decode()
    return { previewUrl, width: image.naturalWidth, height: image.naturalHeight }
  } catch {
    URL.revokeObjectURL(previewUrl)
    throw new Error('This image could not be opened. Check that the file is valid.')
  }
}

function App() {
  const [source, setSource] = useImageAsset()
  const [target, setTarget] = useImageAsset()
  const [result, setResult] = useImageAsset()
  const images = [source, target]
  const setters = [setSource, setTarget]
  const [settings, setSettings] = useState({
    ...DEFAULT_SETTINGS,
    model: MODELS.find(model => model.pinned && model.family === 'sunburst').id,
    size: '2048x2048',
  })
  const [prompt, setPrompt] = useState('')
  const [reading, setReading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [viewingSlot, setViewingSlot] = useState(null)
  const keyInput = useRef(null)
  const pickers = useRef([])
  const inFlight = useRef(false)
  const readingFile = useRef(false)
  const viewer = useRef(null)
  const busy = reading || generating

  async function chooseFile(slot, files) {
    if (readingFile.current || inFlight.current || !files.length) return
    if (files.length !== 1) {
      setError('Choose one image for this slot.')
      return
    }
    readingFile.current = true
    setReading(true)
    setError('')
    try {
      const file = await prepareImageFile(files[0])
      const preview = await readImagePreview(file)
      setters[slot]({ ...preview, file, name: file.name })
      setResult(null)
    } catch (error) {
      setError(error.message)
    } finally {
      readingFile.current = false
      setReading(false)
    }
  }

  useEffect(() => {
    if (viewingSlot !== null) viewer.current.showModal()
  }, [viewingSlot])

  async function submit(event) {
    event.preventDefault()
    if (inFlight.current || readingFile.current) return
    inFlight.current = true
    setGenerating(true)
    setError('')
    setResult(null)
    try {
      const edited = await generateImage({
        apiKey: keyInput.current.value,
        source: source?.file,
        target: target?.file,
        prompt,
        settings,
      })
      const preview = await readImagePreview(edited.blob)
      if (edited.size.width &&
          (edited.size.width !== preview.width || edited.size.height !== preview.height)) {
        URL.revokeObjectURL(preview.previewUrl)
        throw new Error('OpenAI returned a different image size than requested.')
      }
      const stem = source.name.replace(/\.[^.]+$/, '')
      setResult({ ...preview, name: stem + '-edited.' + edited.extension })
    } catch (error) {
      setError(error.message)
    } finally {
      inFlight.current = false
      setGenerating(false)
    }
  }

  function setting(name) {
    return {
      value: settings[name],
      onChange: event => {
        const value = event.target.value
        setSettings(previous => ({ ...previous, [name]: value }))
      },
    }
  }

  return (
    <main className="app">
      <header className="page-title">
        <h1>Prompt Lab</h1>
        <p>Edit a story illustration with a face reference and download the generated image.</p>
      </header>
      <div className="workspace">
        <section className="panel editor" aria-label="Image editor">
          <h2>Images</h2>
          <InputSlots
            images={images}
            busy={busy}
            select={slot => pickers.current[slot].click()}
            drop={chooseFile}
            remove={slot => {
              setters[slot](null)
              setResult(null)
            }}
            view={image => setViewingSlot(images.indexOf(image))}
          />
          {[0, 1].map(slot => (
            <input
              key={slot}
              ref={input => { pickers.current[slot] = input }}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={slot === 0 ? 'Story artwork file' : 'Face reference file'}
              hidden
              onChange={event => {
                const files = Array.from(event.target.files)
                event.target.value = ''
                void chooseFile(slot, files)
              }}
            />
          ))}
          <form className="edit-form" onSubmit={submit} autoComplete="off">
            <label>Prompt
              <textarea
                value={prompt}
                onChange={event => setPrompt(event.target.value)}
                placeholder="Describe how to transfer the face from image2 to image1."
                rows={4}
                required
                disabled={busy}
              />
            </label>
            <fieldset className="settings" disabled={busy}>
              <legend>Output settings</legend>
              <label>Model
                <select {...setting('model')}>
                  {MODELS.filter(model => model.pinned).map(model =>
                    <option key={model.id} value={model.id}>{model.family === 'flare' ? 'GPT Image 2.5 Flare' : 'GPT Image 2.5 Sunburst'}</option>
                  )}
                </select>
              </label>
              <SizeSelect
                value={settings.size}
                onChange={size => setSettings(previous => ({ ...previous, size }))}
              />
              <label>Quality
                <select {...setting('quality')}>
                  {QUALITY_VALUES.map(quality => <option key={quality}>{quality}</option>)}
                </select>
              </label>
              <label>Format
                <select {...setting('output_format')}>
                  {OUTPUT_FORMATS.map(format => <option key={format} value={format}>{format.toUpperCase()}</option>)}
                </select>
              </label>
            </fieldset>
            <label>Your OpenAI API key
              <input type="password" ref={keyInput} autoComplete="off" spellCheck={false} required disabled={busy} />
              <small>Sent directly to OpenAI with each edit. This page does not save the key.</small>
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" className="primary" disabled={busy || !source || !target}>
              {generating ? 'Generating…' : 'Generate image'}
            </button>
          </form>
        </section>
        <section className="panel result" aria-busy={generating}>
          <h2>Result</h2>
          {result ? (
            <>
              <div className="result-preview"><img src={result.previewUrl} alt="Generated image" /></div>
              <div className="result-actions">
                <span>{result.width} × {result.height} px</span>
                <a href={result.previewUrl} download={result.name} className="primary">Download original</a>
              </div>
            </>
          ) : (
            <div className="placeholder" role="status">
              {generating ? 'Waiting for OpenAI. Keep this page open.' : 'Your generated image will appear here.'}
            </div>
          )}
        </section>
      </div>
      {viewingSlot !== null && images[viewingSlot] && (
        <dialog
          ref={viewer}
          aria-label="Input image preview"
          onClose={() => setViewingSlot(null)}
        >
          <button type="button" onClick={() => viewer.current.close()} autoFocus>Close</button>
          <img src={images[viewingSlot].previewUrl} alt={images[viewingSlot].name} />
        </dialog>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')).render(<App />)
