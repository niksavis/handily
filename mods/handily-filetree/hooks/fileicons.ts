import type { ThemeKey } from 'claude-code'

export type IconFamily = 'code' | 'docs' | 'other'

export type FileType =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'shell'
  | 'markdown'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'image'
  | 'default'

export type TypeIcon = { icon: string; nerdName: string; family: IconFamily }

export const TYPE_ICONS: Readonly<Record<FileType, TypeIcon>> = {
  typescript: { icon: '\u{E628}', nerdName: 'nf-seti-typescript', family: 'code' },
  javascript: { icon: '\u{E60C}', nerdName: 'nf-seti-javascript', family: 'code' },
  python: { icon: '\u{E606}', nerdName: 'nf-seti-python', family: 'code' },
  shell: { icon: '\u{E691}', nerdName: 'nf-seti-shell', family: 'code' },
  markdown: { icon: '\u{E609}', nerdName: 'nf-seti-markdown', family: 'docs' },
  json: { icon: '\u{E60B}', nerdName: 'nf-seti-json', family: 'other' },
  yaml: { icon: '\u{E6A8}', nerdName: 'nf-seti-yml', family: 'other' },
  toml: { icon: '\u{E6B2}', nerdName: 'nf-custom-toml', family: 'other' },
  image: { icon: '\u{E60D}', nerdName: 'nf-seti-image', family: 'other' },
  default: { icon: '\u{EA7B}', nerdName: 'nf-cod-file', family: 'other' },
}

export const FAMILY_COLORS: Readonly<Record<IconFamily, ThemeKey>> = {
  code: 'suggestion',
  docs: 'merged',
  other: 'inactive',
}

const EXTENSIONS: Readonly<Record<string, FileType>> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  ico: 'image',
  bmp: 'image',
}

export function fileTypeOf(name: string): FileType {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'default'
  return EXTENSIONS[base.slice(dot + 1).toLowerCase()] ?? 'default'
}
