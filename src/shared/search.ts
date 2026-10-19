/** Google search for a piece of selected text (whitespace collapsed, kept to a sane length). */
export const googleUrl = (text: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(text.replace(/\s+/g, ' ').trim().slice(0, 500))}`
