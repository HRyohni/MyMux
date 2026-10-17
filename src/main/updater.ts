import { app, Notification } from 'electron'
import electronUpdater from 'electron-updater'

/**
 * Checks the release feed configured under `build.publish` in package.json, downloads a newer
 * version in the background and installs it the next time the app quits.
 */
export function initAutoUpdate() {
  // Dev runs and unpacked builds have no update feed.
  if (!app.isPackaged || process.env.MYMUX_NO_UPDATE) return
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (err) => console.error('[update]', err.message))
  autoUpdater.on('update-downloaded', (info) => {
    if (!Notification.isSupported()) return
    new Notification({ title: 'mymux', body: `Verzija ${info.version} je preuzeta i instalirat će se pri zatvaranju aplikacije.` }).show()
  })
  void autoUpdater.checkForUpdates().catch((err) => console.error('[update]', String(err)))
}
