// One-off batch remap of hardcoded hex color classes -> semantic tokens.
// Neutral/accent colors are mapped; unrecognized hexes are reported (not changed).
import fs from 'fs'

const files = [
  'src/renderer/src/components/Toolbar.tsx',
  'src/renderer/src/components/Sidebar.tsx',
  'src/renderer/src/components/SoundGrid.tsx',
  'src/renderer/src/components/DetailPanel.tsx',
  'src/renderer/src/components/TagTree.tsx',
  'src/renderer/src/components/FloatingQuickBar.tsx',
  'src/renderer/src/components/SimilarSoundsBar.tsx',
  'src/renderer/src/components/EmptyState.tsx',
  'src/renderer/src/components/ErrorBoundary.tsx',
  'src/renderer/src/components/ScanDialog.tsx',
  'src/renderer/src/components/GeneratePanel.tsx',
  'src/renderer/src/components/CollectionsManager.tsx',
  'src/renderer/src/components/SmartFolderBuilder.tsx',
  'src/renderer/src/components/RecycleBin.tsx',
  'src/renderer/src/components/SoundTools.tsx',
]

// hex (lowercased key handled in code) -> semantic token
const map = {
  '#1a1a18': 'surface', '#1f1f1d': 'surface-panel', '#222220': 'surface-panel',
  '#1d1d1b': 'surface-panel', '#2a2a28': 'surface-panel', '#252524': 'surface-card',
  '#2c2c2a': 'surface-card', '#353533': 'surface-hover', '#3e3e3c': 'surface-border',
  '#333': 'surface-border', '#3a3a38': 'surface-border',
  '#e8e8e4': 'fg', '#e8e6df': 'fg', '#d3d1c7': 'fg-muted', '#c8c8c4': 'fg-muted',
  '#888780': 'muted', '#8a8a82': 'muted', '#9a9a92': 'muted', '#9a978d': 'muted',
  '#6a6a64': 'muted-light', '#5a5a54': 'muted-light',
  '#534ab7': 'accent', '#6358d0': 'accent', '#7c72e6': 'accent-light',
  '#7f77dd': 'accent-light', '#9d86ff': 'accent-light', '#7c5cff': 'accent-light',
  '#3c3489': 'accent-muted',
  '#232321': 'surface-panel', '#f0ede6': 'fg', '#252522': 'surface-panel',
  '#1e1e1c': 'surface-panel', '#b8b8b4': 'muted-light', '#9c92f6': 'accent-light',
  '#141412': 'surface', '#2f2f2c': 'surface-hover', '#6b5ed4': 'accent-light',
  '#4a4a48': 'surface-border', '#151513': 'surface', '#555': 'muted', '#6258c9': 'accent',
}
const accentHexes = new Set(['#534ab7', '#6358d0', '#9c92f6'])

for (const f of files) {
  let s = fs.readFileSync(f, 'utf8')
  let count = 0
  const unknown = new Set()
  s = s.replace(
    /(bg|text|border|placeholder|ring|from|to|via|divide|outline|fill|stroke|shadow)-\[#([0-9a-fA-F]{3,6})\](?:\/(\d+))?/g,
    (m, prefix, hex, alpha) => {
      const key = '#' + hex.toLowerCase()
      if (accentHexes.has(key) && alpha) {
        count++
        return `${prefix}-accent/${alpha}`
      }
      const tok = map[key]
      if (!tok) { unknown.add(key); return m }
      count++
      return alpha ? `${prefix}-${tok}/${alpha}` : `${prefix}-${tok}`
    }
  )
  if (count > 0 || unknown.size > 0) {
    fs.writeFileSync(f, s)
    console.log(`${f}: replaced ${count}, unknown: ${[...unknown].join(', ') || 'none'}`)
  }
}
