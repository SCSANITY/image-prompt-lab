import {
  DEFAULT_SETTINGS,
  ENDPOINT,
  MAX_IMAGE_BYTES,
  validatePrompt,
  validateSettings,
} from '../core/contract.mjs'

const PNG = [137, 80, 78, 71, 13, 10, 26, 10]
const JPEG = [255, 216, 255]
const RIFF = [82, 73, 70, 70]
const WEBP = [87, 69, 66, 80]

async function imageFormat(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  const matches = (prefix, offset = 0) =>
    prefix.every((byte, i) => bytes[offset + i] === byte)
  if (matches(PNG)) return 'png'
  if (matches(JPEG)) return 'jpeg'
  if (matches(RIFF) && matches(WEBP, 8)) return 'webp'
  return null
}

export async function prepareImageFile(file) {
  if (!file?.size) throw new Error('Choose a non-empty image.')
  if (file.size >= MAX_IMAGE_BYTES) throw new Error('Each image must be smaller than 50 MB.')
  const format = await imageFormat(file)
  if (!format) throw new Error('Choose a PNG, JPEG, or WebP image.')
  const type = 'image/' + format
  return file.type === type ? file : new File([file], file.name, { type })
}

function requestError(status) {
  if (status === 400 || status === 422) return 'OpenAI rejected the images, prompt, or settings. Review them before trying again.'
  if (status === 401) return 'OpenAI did not accept this API key. Check the key and try again.'
  if (status === 403 || status === 404) return 'This key or project may not have access to the selected OpenAI model.'
  if (status === 429) return 'OpenAI reported a rate limit or quota issue. Check your project before trying again.'
  return 'OpenAI returned HTTP ' + status + '. The app did not resend the request.'
}

export async function generateImage({ apiKey, source, target, prompt, settings }, fetchImpl = fetch) {
  const key = apiKey.trim()
  if (!key) throw new Error('Enter your OpenAI API key.')
  const text = validatePrompt(prompt)
  const options = validateSettings({
    model: settings.model,
    size: settings.size,
    quality: settings.quality,
    output_format: settings.output_format,
  })

  const [sourceFile, targetFile] = await Promise.all([
    prepareImageFile(source),
    prepareImageFile(target),
  ])
  const form = new FormData()
  form.append('image[]', sourceFile)
  form.append('image[]', targetFile)
  form.set('prompt', text)
  for (const field of ['model', 'size', 'quality', 'output_format', 'background', 'n', 'stream']) {
    form.set(field, String(options[field]))
  }
  if (options.output_format === 'jpeg' || options.output_format === 'webp') {
    form.set('output_compression', String(options.output_compression))
  }

  const signal = AbortSignal.timeout(DEFAULT_SETTINGS.timeout_ms)
  let response
  let result
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: form,
      signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    })
    if (response.ok) result = await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('OpenAI returned an unreadable response.')
    throw new Error('The request timed out or the connection was interrupted. The outcome is unknown. Check before trying again.')
  }
  if (!response.ok) throw new Error(requestError(response.status))

  const encoded = result?.data?.[0]?.b64_json
  if (result?.data?.length !== 1 || typeof encoded !== 'string' || !encoded) {
    throw new Error('OpenAI did not return the expected single image.')
  }
  let bytes
  try {
    bytes = Uint8Array.fromBase64
      ? Uint8Array.fromBase64(encoded)
      : Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
  } catch {
    throw new Error('OpenAI returned damaged image data.')
  }
  const format = options.output_format
  const blob = new Blob([bytes], { type: 'image/' + format })
  if (await imageFormat(blob) !== format) throw new Error('OpenAI returned an unexpected image format.')

  return {
    blob,
    extension: format === 'jpeg' ? 'jpg' : format,
    size: options.size_metadata,
  }
}
