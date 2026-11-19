// What a piece of pasted text is: a web link, a file path, or just words.
export const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim())

export const isPath = (s: string) => {
  const t = s.trim().replace(/^"(.*)"$/, '$1')
  return !t.includes('\n') && (/^[a-zA-Z]:[\\/]/.test(t) || /^\\\\/.test(t) || /^~[\\/]/.test(t))
}

export const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1')
