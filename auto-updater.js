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
        // 開発環境では自動更新を無効化
        if (process.env.NODE_ENV === 'development') {
            autoUpdater.checkForUpdatesAndNotify = () => {
                console.log('Auto-update disabled in development mode');
                return Promise.resolve();
            };
            return;
        }

        // 自動アップデート設定
        autoUpdater.autoDownload = false; // 手動ダウンロードに変更
        autoUpdater.autoInstallOnAppQuit = false;
        
        // GitHub リリースの設定
        autoUpdater.setFeedURL({
            provider: 'github',
            owner: 'kogumania',
            repo: 'MC-server'
        });

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
            console.error('Auto updater error:', err.message);
            
            // より詳細なエラー処理
            let errorMessage = err.message;
            if (err.message && err.message.includes('Cannot find latest.yml')) {
                errorMessage = 'アップデート設定ファイルが見つかりません。開発者に問題を報告してください。';
            } else if (err.message && err.message.includes('404')) {
                errorMessage = 'アップデートサーバーに接続できません。ネットワーク接続を確認してください。';
            }
            
            this.sendToRenderer('update-error', errorMessage);
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
            // 開発環境では何もしない
            if (process.env.NODE_ENV === 'development') {
                this.sendToRenderer('update-not-available');
                return { success: true, message: 'Development mode - updates disabled' };
            }

            console.log('Manual update check initiated');
            const result = await autoUpdater.checkForUpdates();
            return { success: true, result };
        } catch (error) {
            console.error('Update check failed:', error);
            
            // エラーハンドリングを改善
            if (error.message && error.message.includes('Cannot find latest.yml')) {
                throw new Error('アップデート機能は現在利用できません。手動でGitHubから最新版をダウンロードしてください。');
            }
            
            throw error;
        }
    }

    // 手動ダウンロード開始
    async downloadUpdate() {
        try {
            if (!this.updateAvailable) {
                throw new Error('利用可能なアップデートがありません');
            }
            
            console.log('Starting manual update download');
            await autoUpdater.downloadUpdate();
            return { success: true };
        } catch (error) {
            console.error('Update download failed:', error);
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
            const result = await updateManager.checkForUpdates();
            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 手動ダウンロード
    ipcMain.handle('download-update', async () => {
        try {
            const result = await updateManager.downloadUpdate();
            return result;
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
        return { success: false, error: 'インストール可能なアップデートがありません' };
    });

    // リリースノート表示
    ipcMain.handle('open-release-notes', async (event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
}

module.exports = { AutoUpdateManager, setupUpdateIPCHandlers };
