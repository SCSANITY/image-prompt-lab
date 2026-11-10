'use strict'

const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const sharp = require('sharp')

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForJson(url, timeoutMs = 15_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch { /* packaged app is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function waitForPageTarget(port, timeoutMs = 15_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, 2_000)
      const target = targets.find((item) => item.type === 'page' && item.title === 'YMI Image Prompt Lab')
      if (target) return target
    } catch { /* portable wrapper may need time to extract before DevTools starts */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Packaged Prompt Lab page target was not found.')
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 1
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  })
  socket.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('DevTools connection closed.'))
    pending.clear()
  })
  return {
    close: () => socket.close(),
    call(method, params = {}) {
      const id = nextId
      nextId += 1
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
  }
}

async function waitForPromptLabUi(page, timeoutMs = 10_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const evaluated = await page.call('Runtime.evaluate', {
      expression: `({
        title: document.title,
        brand: document.querySelector('.brand strong')?.textContent,
        brandIconLoaded: Boolean(document.querySelector('img.brand-icon')?.naturalWidth),
        bodyLength: document.body.innerText.trim().length,
        keyMissing: document.body.innerText.includes('Connect API'),
        navigationCount: document.querySelectorAll('nav button').length,
        inputRoles: Array.from(document.querySelectorAll('.slot-heading strong')).map(e => e.textContent),
        viteOverlays: document.querySelectorAll('.vite-error-overlay').length,
      })`,
      returnByValue: true,
    })
    if (evaluated.result.value?.brand === 'Prompt Lab' && evaluated.result.value.brandIconLoaded) return evaluated.result.value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Packaged Prompt Lab UI did not finish booting.')
}

async function waitForExit(child, timeoutMs = 8_000) {
  if (child.exitCode !== null) return child.exitCode
  return Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Packaged app did not exit cleanly.')), timeoutMs)),
  ])
}

async function main() {
  const executable = path.resolve(process.argv[2] || path.join(
    __dirname,
    '..',
    'release',
    'win-unpacked',
    'YMI Prompt Lab.exe',
  ))
  await fs.access(executable)
  const port = await availablePort()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ymi-prompt-lab-packaged-'))
  const fixturePath = path.join(profile, 'synthetic-input.png')
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#618570' } }).png().toFile(fixturePath)
  const screenshotPath = path.join(os.tmpdir(), 'ymi-prompt-lab-packaged-smoke.png')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.OPENAI_API_KEY
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
  ], { env, stdio: 'ignore', windowsHide: true })

  let browser
  let page
  try {
    const target = await waitForPageTarget(port)
    page = await connectCdp(target.webSocketDebuggerUrl)
    const state = await waitForPromptLabUi(page)
    assert.deepEqual(state, {
      title: 'YMI Image Prompt Lab',
      brand: 'Prompt Lab',
      brandIconLoaded: true,
      bodyLength: state.bodyLength,
      keyMissing: true,
      navigationCount: 3,
      inputRoles: ['Source image', 'Target image'],
      viteOverlays: 0,
    })
    assert.ok(state.bodyLength > 350)
    const evaluation = await page.call('Runtime.evaluate', {
      expression: `(async()=>{
        const api=window.promptLab;
        const inspected=await api.inspectImage(${JSON.stringify(fixturePath)});
        if(!inspected.ok) throw Error(inspected.error.message);
        const boot=await api.boot();
        const validated=await api.validate({prompt:'Synthetic offline packaged check',settings:boot.capabilities.defaults,imagePaths:[${JSON.stringify(fixturePath)}],expectedInputHashes:[inspected.image.sha256]});
        const stored=await api.savePrompt({title:'Packaged offline fixture',body:'Preserve the illustration',notes:'Synthetic test, no provider request'});
        const recovered=await api.workspace();
        return {imageWidth:inspected.image.width,preview:inspected.image.previewUrl.startsWith('data:image/'),valid:validated.ok,saved:stored.prompts.length===1&&recovered.prompts[0].body==='Preserve the illustration'};
      })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    assert.equal(evaluation.exceptionDetails, undefined)
    assert.deepEqual(evaluation.result.value, { imageWidth: 64, preview: true, valid: true, saved: true })
    const captured = await page.call('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(screenshotPath, Buffer.from(captured.data, 'base64'))

    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`)
    browser = await connectCdp(version.webSocketDebuggerUrl)
    await browser.call('Browser.close').catch(() => null)
    await waitForExit(child)
    process.stdout.write(`${JSON.stringify({ result: 'pass', executable, screenshotPath, state, offlineChecks: evaluation.result.value }, null, 2)}\n`)
  } finally {
    page?.close()
    browser?.close()
    if (child.exitCode === null) child.kill()
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 })
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
