// The app used to be called aimux; copy its localStorage keys to the new prefix once.
// Imported first in main.tsx so the stores read the migrated values.
try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('aimux.')) continue
    const renamed = 'mymux.' + key.slice('aimux.'.length)
    if (localStorage.getItem(renamed) === null) localStorage.setItem(renamed, localStorage.getItem(key)!)
  }
} catch { /* storage unavailable */ }

export {}
