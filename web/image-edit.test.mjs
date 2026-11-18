import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_SETTINGS, ENDPOINT, MAX_IMAGE_BYTES } from '../core/contract.mjs'
import { generateImage, prepareImageFile } from './image-edit.mjs'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvS8AAAAASUVORK5CYII='
const bytes = Buffer.from(png, 'base64')
const input = {
  apiKey: 'test-only',
  source: new File([bytes], 'artwork.png', { type: 'image/png' }),
  target: new File([bytes], 'face.png'),
  prompt: 'Transfer the face from image2 into image1.',
  settings: { ...DEFAULT_SETTINGS, size: 'auto' },
}

test('posts source then reference to OpenAI once and preserves the returned bytes', async () => {
  let calls = 0
  const result = await generateImage(input, async (url, request) => {
    calls++
    assert.equal(url, ENDPOINT)
    assert.equal(request.method, 'POST')
    assert.equal(request.headers.Authorization, 'Bearer test-only')
    assert.equal(request.redirect, 'error')
    assert.deepEqual(request.body.getAll('image[]').map(file => [file.name, file.type]), [
      ['artwork.png', 'image/png'],
      ['face.png', 'image/png'],
    ])
    assert.equal(request.body.get('prompt'), input.prompt)
    assert.equal(request.body.get('model'), input.settings.model)
    assert.equal(request.body.get('size'), 'auto')
    assert.equal(request.body.get('output_format'), 'png')
    assert.equal(request.body.get('n'), '1')
    assert.equal(request.body.get('stream'), 'false')
    assert.equal(request.body.has('output_compression'), false)
    assert.equal(request.body.has('input_fidelity'), false)
    return Response.json({ data: [{ b64_json: png }] })
  })
  assert.equal(calls, 1)
  assert.equal(result.blob.type, 'image/png')
  assert.equal(result.extension, 'png')
  assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()), bytes)
})

test('rejects wrong files and fails before any provider request for invalid settings', async () => {
  await assert.rejects(prepareImageFile(new File(['wrong'], 'f.png', { type: 'image/png' })), /PNG, JPEG, or WebP/)
  await assert.rejects(prepareImageFile({ size: MAX_IMAGE_BYTES }), /smaller than 50 MB/)
  await assert.rejects(generateImage({ ...input, settings: { ...input.settings, size: '1101x1000' } },
    () => assert.fail('unexpected provider call')), /divisible by 16/)
})

test('does not resend on connection loss, failed response body, or quota error', async () => {
  const failures = [
    [() => { throw new Error('interrupted') }, /outcome is unknown/],
    [() => ({ ok: true, json: async () => { throw new Error('truncated') } }), /outcome is unknown/],
    [() => new Response(null, { status: 429 }), /rate limit or quota/],
  ]
  for (const [failure, message] of failures) {
    let calls = 0
    await assert.rejects(generateImage(input, () => { calls++; return failure() }), message)
    assert.equal(calls, 1)
  }
})
