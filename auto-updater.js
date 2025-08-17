const { app, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs').promises;

class AutoUpdateManager {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.updateAvailable = false;
        this.setupAutoUpdater();
    }

    setupAutoUpdater() {
        // アップデート設定
        autoUpdater.checkForUpdatesAndNotify();
        
        // 開発環境での設定
        if (process.env.NODE_ENV === 'development') {
            autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml');
        }

        // イベントハンドラー
        autoUpdater.on('checking-for-update', () => {
            console.log('Checking for update...');
            this.sendToRenderer('update-checking');
        });

        autoUpdater.on('update-available', (info) => {
            console.log('Update available:', info.version);
            this.updateAvailable = true;
            this.sendToRenderer('update-available', {
                version: info.version,
                releaseDate: info.releaseDate,
                releaseNotes: info.releaseNotes
            });
        });

        autoUpdater.on('update-not-available', (info) => {
            console.log('Update not available');
            this.sendToRenderer('update-not-available');
        });

        autoUpdater.on('error', (err) => {
            console.error('Auto updater error:', err);
            this.sendToRenderer('update-error', err.message);
        });

        autoUpdater.on('download-progress', (progressObj) => {
            const message = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
            console.log(message);
            this.sendToRenderer('update-progress', {
                percent: Math.round(progressObj.percent),
                message: `ダウンロード中... ${Math.round(progressObj.percent)}%`
            });
        });

        autoUpdater.on('update-downloaded', (info) => {
            console.log('Update downloaded');
            this.sendToRenderer('update-downloaded', {
                version: info.version
            });
            
            // ユーザーに再起動を促す
            this.promptRestart(info.version);
        });
    }

    async promptRestart(version) {
        const response = await dialog.showMessageBox(this.mainWindow, {
            type: 'info',
            title: 'アップデート完了',
            message: `バージョン ${version} のダウンロードが完了しました`,
            detail: 'アプリケーションを再起動して更新を適用しますか？',
            buttons: ['今すぐ再起動', '後で再起動'],
            defaultId: 0,
            cancelId: 1
        });

        if (response.response === 0) {
            autoUpdater.quitAndInstall();
        }
    }

    sendToRenderer(event, data = null) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(event, data);
        }
    }

    // 手動アップデートチェック
    async checkForUpdates() {
        try {
            const result = await autoUpdater.checkForUpdatesAndNotify();
            return result;
        } catch (error) {
            console.error('Update check failed:', error);
            throw error;
        }
    }

    // 現在のバージョン情報取得
    getCurrentVersion() {
        return app.getVersion();
    }
}

// IPCハンドラー
function setupUpdateIPCHandlers(updateManager) {
    // 手動アップデートチェック
    ipcMain.handle('check-for-updates', async () => {
        try {
            await updateManager.checkForUpdates();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 現在のバージョン取得
    ipcMain.handle('get-app-version', () => {
        return updateManager.getCurrentVersion();
    });

    // アップデートのインストール
    ipcMain.handle('install-update', () => {
        if (updateManager.updateAvailable) {
            autoUpdater.quitAndInstall();
            return { success: true };
        }
        return { success: false, error: 'No update available' };
    });

    // リリースノート表示
    ipcMain.handle('open-release-notes', async (event, url) => {
        await shell.openExternal(url);
    });
}

module.exports = { AutoUpdateManager, setupUpdateIPCHandlers };
