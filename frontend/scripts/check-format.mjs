import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const targets = ['src', 'index.html', 'vite.config.js', 'package.json']
const allowedExtensions = new Set(['.css', '.html', '.js', '.json', '.ts', '.vue'])
const ignoredDirectories = new Set(['dist', 'node_modules'])
const errors = []

async function collectFiles(target) {
  const absolutePath = path.join(root, target)
  const entries = await readdir(absolutePath, { withFileTypes: true }).catch(async () => {
    return [{ isDirectory: () => false, isFile: () => true, name: path.basename(target) }]
  })

  if (entries.length === 1 && entries[0].name === path.basename(target) && entries[0].isFile()) {
    return [absolutePath]
  }

  const files = []
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) {
      continue
    }

    const entryPath = path.join(absolutePath, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path.relative(root, entryPath)))
    } else if (entry.isFile() && allowedExtensions.has(path.extname(entry.name))) {
      files.push(entryPath)
    }
  }
  return files
}

function report(file, line, message) {
  const relativePath = path.relative(root, file).replaceAll(path.sep, '/')
  errors.push(`${relativePath}:${line} ${message}`)
}

for (const target of targets) {
  for (const file of await collectFiles(target)) {
    const content = await readFile(file, 'utf8')
    const lines = content.split(/\r?\n/)

    if (content.length > 0 && !content.endsWith('\n')) {
      report(file, lines.length, 'missing trailing newline')
    }

    lines.forEach((line, index) => {
      if (/[ \t]+$/.test(line)) {
        report(file, index + 1, 'trailing whitespace')
      }
    })
  }
}

if (errors.length > 0) {
  console.error(`Format check failed with ${errors.length} issue(s):`)
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Format check passed.')
