import {mkdir, readdir, readFile, stat, writeFile} from 'node:fs/promises'
import path from 'node:path'

const projectDir = process.cwd()
const distDir = path.join(projectDir, 'dist')
const serverDir = path.join(distDir, 'server')

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
}

const cachePolicies = {
  '.css': 'public, max-age=31536000, immutable',
  '.html': 'no-store',
  '.js': 'public, max-age=31536000, immutable',
  '.json': 'no-store',
  '.png': 'public, max-age=31536000, immutable',
}

const embeddedEntries = []

const filesToEmbed = await collectFiles(distDir)

for (const relativePath of filesToEmbed) {
  const absolutePath = path.join(distDir, relativePath)
  const buffer = await readFile(absolutePath)
  const extension = path.extname(relativePath)
  const body = buffer.toString('base64')
  embeddedEntries.push({
    path: `/${relativePath}`.replace('/index.html', '/index.html'),
    body,
    mimeType: mimeTypes[extension] ?? 'application/octet-stream',
    cacheControl: cachePolicies[extension] ?? 'public, max-age=3600',
  })
}

const workerSource = `const embeddedFiles = new Map(${JSON.stringify(embeddedEntries, null, 2)});

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function serveFile(file) {
  return new Response(decodeBase64(file.body), {
    headers: {
      "content-type": file.mimeType,
      "cache-control": file.cacheControl,
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = embeddedFiles.get(pathname);
    if (file) {
      return serveFile(file);
    }
    return new Response("Not found", {status: 404});
  },
};
`

await mkdir(serverDir, {recursive: true})
await writeFile(path.join(serverDir, 'index.js'), workerSource, 'utf8')

async function collectFiles(rootDir) {
  const files = []

  async function walk(currentDir, prefix = '') {
    const entries = await readdir(currentDir)
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry)
      const relativePath = path.join(prefix, entry)
      const entryStat = await stat(absolutePath)

      if (entryStat.isDirectory()) {
        if (relativePath === 'server') continue
        await walk(absolutePath, relativePath)
        continue
      }

      files.push(relativePath)
    }
  }

  await walk(rootDir)
  return files.sort()
}
