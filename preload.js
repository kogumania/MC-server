const { contextBridge, ipcRenderer } = require('electron');

// レンダラープロセスに安全なAPIを公開
contextBridge.exposeInMainWorld('electronAPI', {
    // 既存の機能
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    getDefaultPath: () => ipcRenderer.invoke('get-default-path'),
    getVersions: (serverType) => ipcRenderer.invoke('get-versions', serverType),
    checkJava: (version) => ipcRenderer.invoke('check-java', version),
    
    createServer: (config, progressCallback) => {
        return new Promise((resolve, reject) => {
            ipcRenderer.on('creation-progress', (event, progress) => {
                if (progressCallback) {
                    progressCallback(progress);
                }
            });
            
            ipcRenderer.invoke('create-server', config)
                .then(result => {
                    ipcRenderer.removeAllListeners('creation-progress');
                    resolve(result);
                })
                .catch(error => {
                    ipcRenderer.removeAllListeners('creation-progress');
                    reject(error);
                });
        });
    },
    
    startServer: (serverPath) => ipcRenderer.invoke('start-server', serverPath),
    checkServerUpdates: (serverPath) => ipcRenderer.invoke('check-server-updates', serverPath),
    
    updateServer: (serverPath, updateConfig, progressCallback) => {
        return new Promise((resolve, reject) => {
            ipcRenderer.on('update-progress', (event, progress) => {
                if (progressCallback) {
                    progressCallback(progress);
                }
            });
            
            ipcRenderer.invoke('update-server', serverPath, updateConfig)
                .then(result => {
                    ipcRenderer.removeAllListeners('update-progress');
                    resolve(result);
                })
                .catch(error => {
                    ipcRenderer.removeAllListeners('update-progress');
                    reject(error);
                });
        });
    },
    
    enableAutoUpdateCheck: (serverPath, intervalMinutes) => 
        ipcRenderer.invoke('enable-auto-update-check', serverPath, intervalMinutes),
    
    onUpdateAvailable: (callback) => {
        ipcRenderer.on('update-available', (event, updateInfo) => callback(updateInfo));
    },
    
    removeUpdateListener: () => {
        ipcRenderer.removeAllListeners('update-available');
    },
    
    // アプリケーション自動アップデート機能
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    showAboutDialog: () => ipcRenderer.invoke('show-about-dialog'),
    showChangelog: () => ipcRenderer.invoke('show-changelog'),
    openReleaseNotes: (url) => ipcRenderer.invoke('open-release-notes', url),
    
    // アプリアップデートイベントリスナー
    onUpdateChecking: (callback) => {
        ipcRenderer.on('update-checking', callback);
    },
    
    onUpdateAvailableApp: (callback) => {
        ipcRenderer.on('update-available', (event, info) => callback(info));
    },
    
    onUpdateNotAvailable: (callback) => {
        ipcRenderer.on('update-not-available', callback);
    },
    
    onUpdateProgress: (callback) => {
        ipcRenderer.on('update-progress', (event, progress) => callback(progress));
    },
    
    onUpdateDownloaded: (callback) => {
        ipcRenderer.on('update-downloaded', (event, info) => callback(info));
    },
    
    onUpdateError: (callback) => {
        ipcRenderer.on('update-error', (event, error) => callback(error));
    },
    
    // アップデートイベントリスナーの削除
    removeAllUpdateListeners: () => {
        ipcRenderer.removeAllListeners('update-checking');
        ipcRenderer.removeAllListeners('update-available');
        ipcRenderer.removeAllListeners('update-not-available');
        ipcRenderer.removeAllListeners('update-progress');
        ipcRenderer.removeAllListeners('update-downloaded');
        ipcRenderer.removeAllListeners('update-error');
    },
    
    // プラットフォーム情報
    getPlatform: () => process.platform,
    getElectronVersion: () => process.versions.electron,
    getNodeVersion: () => process.versions.node,
    getChromeVersion: () => process.versions.chrome
});

// セキュリティ: Node.js APIへの直接アクセスを防ぐ
window.addEventListener('DOMContentLoaded', () => {
    // 開発環境でのみコンソールログを表示
    if (process.env.NODE_ENV === 'development') {
        console.log('Minecraft Server Creator が読み込まれました');
        console.log('プラットフォーム:', process.platform);
        console.log('Electronバージョン:', process.versions.electron);
        console.log('Node.jsバージョン:', process.versions.node);
        console.log('Chromeバージョン:', process.versions.chrome);
    }
    
    // CSPの設定を確認
    const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (!cspMeta && process.env.NODE_ENV === 'development') {
        console.warn('CSP (Content Security Policy) が設定されていません');
    }
});

// アプリケーション終了時のクリーンアップ
window.addEventListener('beforeunload', () => {
    // 全てのIPCリスナーを削除
    if (window.electronAPI && window.electronAPI.removeAllUpdateListeners) {
        window.electronAPI.removeAllUpdateListeners();
    }
    if (window.electronAPI && window.electronAPI.removeUpdateListener) {
        window.electronAPI.removeUpdateListener();
    }
});

// エラーハンドリング
process.on('uncaughtException', (error) => {
    console.error('未処理の例外:', error);
    if (process.env.NODE_ENV === 'development') {
        console.trace('スタックトレース:', error.stack);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未処理のPromise拒否:', reason);
    console.error('Promise:', promise);
    if (process.env.NODE_ENV === 'development') {
        console.trace('スタックトレース:', reason);
    }
});
