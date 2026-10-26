// Deterministic per-asset, so the same property or person always lands on the
// same hue instead of flickering between colors on every render.
function hashString(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  // Spread into code points: slicing or indexing a string cuts an emoji in half.
  if (parts.length === 1) return [...parts[0]].slice(0, 2).join("").toUpperCase()
  return ([...parts[0]][0] + [...parts[parts.length - 1]][0]).toUpperCase()
}

export function firstNameOf(name: string) {
  return name.trim().split(/\s+/)[0] ?? name
}

export function softColorOf(seed: string) {
  const hue = hashString(seed) % 360
  return { background: `hsl(${hue} 60% 88%)`, color: `hsl(${hue} 45% 32%)` }
}
