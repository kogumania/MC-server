const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const { spawn, exec } = require('child_process');
const os = require('os');

// 自動アップデート機能をインポート
const { AutoUpdateManager, setupUpdateIPCHandlers } = require('./auto-updater');

let mainWindow, updateManager;

// サーバータイプ別設定
const SERVER_CONFIGS = {
    vanilla: {
        getVersions: () => fetchJSON('https://launchermeta.mojang.com/mc/game/version_manifest.json')
            .then(data => data.versions.filter(v => v.type === 'release').map(v => v.id)),
        getDownloadUrl: async (version) => {
            const manifest = await fetchJSON('https://launchermeta.mojang.com/mc/game/version_manifest.json');
            const versionData = manifest.versions.find(v => v.id === version);
            const versionInfo = await fetchJSON(versionData.url);
            return versionInfo.downloads.server.url;
        }
    },
    paper: {
        getVersions: () => fetchJSON('https://api.papermc.io/v2/projects/paper').then(data => data.versions.reverse()),
        getDownloadUrl: async (version) => {
            const versionData = await fetchJSON(`https://api.papermc.io/v2/projects/paper/versions/${version}`);
            const latestBuild = versionData.builds[versionData.builds.length - 1];
            return `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latestBuild}/downloads/paper-${version}-${latestBuild}.jar`;
        }
    },
    spigot: {
        getVersions: () => Promise.resolve(['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.19.2', '1.18.2', '1.17.1', '1.16.5']),
        getDownloadUrl: () => null // 手動ビルド必要
    },
    fabric: {
        getVersions: () => fetchJSON('https://meta.fabricmc.net/v2/versions/game')
            .then(data => data.filter(v => v.stable).map(v => v.version)),
        getDownloadUrl: async (version) => {
            const [loaders, installers] = await Promise.all([
                fetchJSON('https://meta.fabricmc.net/v2/versions/loader'),
                fetchJSON('https://meta.fabricmc.net/v2/versions/installer')
            ]);
            const latestLoader = loaders.find(l => l.stable);
            const latestInstaller = installers.find(i => i.stable);
            return `https://meta.fabricmc.net/v2/versions/loader/${version}/${latestLoader.version}/${latestInstaller.version}/server/jar`;
        }
    },
    forge: {
        getVersions: () => fetchJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')
            .then(data => Object.keys(data.promos)
                .filter(key => key.endsWith('-recommended') || key.endsWith('-latest'))
                .map(key => key.replace(/-recommended|-latest/, ''))
                .filter((v, i, arr) => arr.indexOf(v) === i)
                .sort((a, b) => compareVersions(b, a))),
        getDownloadUrl: async (version) => {
            try {
                const promotions = await fetchJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
                const forgeVersion = promotions.promos[`${version}-recommended`] || promotions.promos[`${version}-latest`];
                return forgeVersion 
                    ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${forgeVersion}/forge-${version}-${forgeVersion}-installer.jar`
                    : `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${version}/forge-${version}-installer.jar`;
            } catch {
                return `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${version}/forge-${version}-installer.jar`;
            }
        }
    },
    neoforge: {
        getVersions: () => Promise.resolve(['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.2', '1.20.1']),
        getDownloadUrl: (version) => `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`
    }
};

// ユーティリティ関数
const fetchJSON = (url) => new Promise((resolve, reject) => {
    https.get(url, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (error) { reject(error); }
        });
    }).on('error', reject);
});

const compareVersions = (a, b) => {
    const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
    const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
    return bMajor - aMajor || bMinor - aMinor || (bPatch || 0) - (aPatch || 0);
};

const sendProgress = (percent, message) => mainWindow?.webContents.send('creation-progress', { percent, message });

// アプリケーション準備完了時の処理
app.whenReady().then(() => {
    createWindow();
    updateManager = new AutoUpdateManager(mainWindow);
    setupUpdateIPCHandlers(updateManager);
    setTimeout(() => updateManager.checkForUpdates().catch(console.error), 3000);
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// メインウィンドウの作成
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900, height: 800, resizable: true, minWidth: 800, minHeight: 600,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false, contextIsolation: true, enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('index.html');
    if (process.env.NODE_ENV === 'development') mainWindow.webContents.openDevTools();
    
    if (!updateManager) {
        updateManager = new AutoUpdateManager(mainWindow);
        setupUpdateIPCHandlers(updateManager);
    }
}

// IPCハンドラー
ipcMain.handle('show-about-dialog', async () => {
    const version = app.getVersion();
    await dialog.showMessageBox(mainWindow, {
        type: 'info', title: 'About Minecraft Server Creator', message: 'Minecraft Server Creator',
        detail: `Version: ${version}\n\nMinecraftサーバーを簡単に作成できるElectronアプリケーション\n\n© 2024 Your Company Name`,
        buttons: ['OK']
    });
});

ipcMain.handle('show-changelog', () => shell.openExternal('https://github.com/yourusername/minecraft-server-creator/releases'));

ipcMain.handle('select-folder', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'], title: 'サーバーの保存先を選択'
        });
        return { success: !result.canceled, path: result.canceled ? '' : result.filePaths[0] };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-default-path', () => path.join(os.homedir(), 'Downloads'));

ipcMain.handle('get-versions', async (event, serverType) => {
    try {
        return await SERVER_CONFIGS[serverType]?.getVersions() || ['1.21.4', '1.21.3', '1.21.1'];
    } catch (error) {
        console.error('バージョン取得エラー:', error);
        return ['1.21.4', '1.21.3', '1.21.1'];
    }
});

ipcMain.handle('check-java', async (event, mcVersion) => {
    try {
        const javaVersion = await getJavaVersion();
        const recommendedJava = getRecommendedJavaVersion(mcVersion);
        return {
            installed: javaVersion !== null, installedVersion: javaVersion, recommendedVersion: recommendedJava,
            compatible: javaVersion ? parseInt(javaVersion) >= parseInt(recommendedJava) : false
        };
    } catch {
        return { installed: false, installedVersion: null, recommendedVersion: getRecommendedJavaVersion(mcVersion), compatible: false };
    }
});

// Javaバージョン関連
function getJavaVersion() {
    return new Promise(resolve => {
        exec('java -version', (error, stdout, stderr) => {
            if (error) return resolve(null);
            const versionString = stderr || stdout;
            const match = versionString.match(/version "?([0-9]+(?:\.[0-9]+)?)/);
            if (match) {
                const version = match[1];
                resolve(version.startsWith('1.') ? version.split('.')[1] : version.split('.')[0]);
            } else resolve(null);
        });
    });
}

function getRecommendedJavaVersion(mcVersion) {
    const [major, minor] = mcVersion.split('.').map(Number);
    return (major > 1 || (major === 1 && minor >= 17)) ? '17' : 
           (major === 1 && minor >= 16) ? '16' : '8';
}

// サーバー作成
ipcMain.handle('create-server', async (event, config) => {
    try {
        const serverDir = path.join(config.savePath, config.serverName);
        
        sendProgress(10, 'フォルダを作成中...');
        await fs.mkdir(serverDir, { recursive: true });
        
        if (config.autoDownload) {
            sendProgress(20, 'サーバーファイルをダウンロード中...');
            await downloadServerJar(config.serverType, config.version, serverDir);
        }
        
        sendProgress(60, '設定ファイルを作成中...');
        await createConfigFiles(serverDir, config);
        
        sendProgress(80, '起動スクリプトを作成中...');
        await createStartScript(serverDir, config);
        
        if (config.autoEula) {
            sendProgress(90, 'EULA設定中...');
            await fs.writeFile(path.join(serverDir, 'eula.txt'), 
                '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\neula=true');
        }
        
        sendProgress(95, 'サーバー情報を保存中...');
        const serverInfo = {
            name: config.serverName, type: config.serverType, version: config.version,
            minMemory: config.minMemory, maxMemory: config.maxMemory,
            created: new Date().toISOString(), lastUpdated: new Date().toISOString(),
            autoDownload: config.autoDownload, autoEula: config.autoEula
        };
        await fs.writeFile(path.join(serverDir, '.server-info.json'), JSON.stringify(serverInfo, null, 2));
        
        sendProgress(100, 'サーバー作成完了！');
        return { success: true };
    } catch (error) {
        console.error('サーバー作成エラー:', error);
        return { success: false, error: error.message };
    }
});

// サーバーJARダウンロード
async function downloadServerJar(serverType, version, serverDir) {
    const config = SERVER_CONFIGS[serverType];
    if (!config) throw new Error('未対応のサーバータイプ');
    
    const downloadUrl = await config.getDownloadUrl(version);
    
    if (!downloadUrl) {
        // 手動セットアップが必要な場合（Spigot等）
        await createManualSetupFiles(serverType, version, serverDir);
        return;
    }
    
    const fileName = serverType.includes('forge') ? `${serverType}-installer.jar` : 'server.jar';
    const jarPath = path.join(serverDir, fileName);
    
    await downloadFile(downloadUrl, jarPath);
    
    if (serverType === 'forge' || serverType === 'neoforge') {
        await handleForgeInstallation(serverDir, fileName, version);
    }
}

// 手動セットアップファイル作成
async function createManualSetupFiles(serverType, version, serverDir) {
    const instructions = getManualInstructions(serverType, version);
    await fs.writeFile(path.join(serverDir, `${serverType}_セットアップ手順.txt`), instructions);
    
    if (serverType === 'spigot') {
        const buildBat = `@echo off
title Spigot Build Process
if not exist "BuildTools.jar" (
    echo エラー: BuildTools.jar が見つかりません
    echo https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar からダウンロード
    pause && exit /b 1
)
java -jar BuildTools.jar --rev ${version}
if exist "spigot-${version}.jar" (
    rename "spigot-${version}.jar" "server.jar"
    echo セットアップ完了！ start.bat でサーバーを起動できます
) else echo ビルドに失敗しました
pause`;
        await fs.writeFile(path.join(serverDir, 'build-spigot.bat'), buildBat);
    }
}

// 手動セットアップ説明
function getManualInstructions(serverType, version) {
    const instructions = {
        spigot: `Spigotサーバーのセットアップ方法\n\n1. BuildTools.jarをダウンロード\n2. build-spigot.batを実行\n3. start.batでサーバーを起動`,
        forge: `Forge サーバー手動セットアップ方法\n\n1. インストーラーを実行: java -jar forge-installer.jar --installServer\n2. 生成されたforge-*.jarをserver.jarにリネーム\n3. start.batで起動`
    };
    return instructions[serverType] || `${serverType} サーバーのセットアップが必要です`;
}

// Forgeインストール処理
async function handleForgeInstallation(serverDir, installerFileName, version) {
    try {
        sendProgress(40, 'Forgeインストーラーを実行中...');
        await new Promise((resolve, reject) => {
            const installer = spawn('java', ['-jar', installerFileName, '--installServer'], { cwd: serverDir, stdio: 'pipe' });
            installer.on('close', code => code === 0 ? resolve() : reject(new Error(`インストーラーエラー: ${code}`)));
            installer.on('error', reject);
        });
        
        const files = await fs.readdir(serverDir);
        const serverJar = files.find(file => file.startsWith('forge') && file.endsWith('.jar') && 
                                           !file.includes('installer') && file.includes(version));
        
        if (serverJar) {
            await fs.copyFile(path.join(serverDir, serverJar), path.join(serverDir, 'server.jar'));
            await fs.unlink(path.join(serverDir, installerFileName)).catch(() => {});
        }
    } catch (error) {
        await createManualSetupFiles('forge', version, serverDir);
    }
}

// ファイルダウンロード
function downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
        const file = require('fs').createWriteStream(filePath);
        https.get(url, response => {
            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;
            
            response.pipe(file);
            response.on('data', chunk => {
                downloadedSize += chunk.length;
                if (totalSize) {
                    const percent = Math.round((downloadedSize / totalSize) * 30) + 20;
                    sendProgress(percent, `ダウンロード中... ${Math.round(downloadedSize / 1024 / 1024)}MB / ${Math.round(totalSize / 1024 / 1024)}MB`);
                }
            });
            
            file.on('finish', () => { file.close(); resolve(); });
            file.on('error', error => { fs.unlink(filePath); reject(error); });
        }).on('error', reject);
    });
}

// 設定ファイル作成
async function createConfigFiles(serverDir) {
    const serverProperties = `server-port=25565
gamemode=survival
difficulty=easy
spawn-protection=16
max-players=20
online-mode=true
white-list=false
motd=A Minecraft Server`;
    
    await fs.writeFile(path.join(serverDir, 'server.properties'), serverProperties);
}

// 起動スクリプト作成
async function createStartScript(serverDir, config) {
    const serverType = config.serverType.charAt(0).toUpperCase() + config.serverType.slice(1);
    
    let startBat = `title ${serverType} Server v${config.version}\n`;
    
    if (config.serverType === 'spigot') {
        startBat += `@echo off
if not exist "server.jar" (
    echo エラー: server.jar が見つかりません
    echo build-spigot.bat を実行してSpigotをビルドしてください
    pause && exit /b 1
)`;
    }
    
    startBat += `\njava -Xmx${config.maxMemory}M -Xms${config.minMemory}M -jar server.jar nogui\npause`;
    
    await fs.writeFile(path.join(serverDir, 'start.bat'), startBat);
    
    const instructions = `起動方法:
1. start.batを起動
2. 初回は自動停止するのでserver.propertiesで設定変更
3. 再度start.batを実行

注意:
- ポート開放が必要な場合があります（デフォルト: 25565）
${config.serverType === 'spigot' ? '- Spigotの場合は先にbuild-spigot.batを実行\n' : ''}${(config.serverType === 'forge' || config.serverType === 'neoforge') ? '- 初回起動には時間がかかる場合があります\n' : ''}`;
    
    await fs.writeFile(path.join(serverDir, '起動方法.txt'), instructions);
}

// サーバー起動
ipcMain.handle('start-server', async (event, serverPath) => {
    try {
        const startBatPath = path.join(serverPath, 'start.bat');
        const command = os.platform() === 'win32' 
            ? ['cmd', ['/c', 'start', 'cmd', '/k', `"${startBatPath}"`]]
            : ['open', ['-a', 'Terminal', startBatPath]];
        
        spawn(...command, { cwd: serverPath, detached: true });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// サーバー更新チェック
ipcMain.handle('check-server-updates', async (event, serverPath) => {
    try {
        const serverInfoData = await fs.readFile(path.join(serverPath, '.server-info.json'), 'utf8');
        const serverInfo = JSON.parse(serverInfoData);
        const latestVersions = await SERVER_CONFIGS[serverInfo.type]?.getVersions() || [];
        const latestVersion = latestVersions[0];
        
        return {
            hasUpdate: serverInfo.version !== latestVersion,
            currentVersion: serverInfo.version, latestVersion,
            serverType: serverInfo.type, serverName: serverInfo.name
        };
    } catch (error) {
        return { hasUpdate: false, error: 'サーバー情報ファイルが見つかりません' };
    }
});

// サーバー更新実行
ipcMain.handle('update-server', async (event, serverPath, updateConfig) => {
    try {
        const sendUpdateProgress = (percent, message) => mainWindow.webContents.send('update-progress', { percent, message });
        
        sendUpdateProgress(10, 'サーバー情報を読み込み中...');
        const serverInfoData = await fs.readFile(path.join(serverPath, '.server-info.json'), 'utf8');
        const serverInfo = JSON.parse(serverInfoData);
        
        // バックアップ作成
        try {
            await fs.copyFile(path.join(serverPath, 'server.jar'), path.join(serverPath, `server-${serverInfo.version}-backup.jar`));
            sendUpdateProgress(30, 'バックアップを作成しました');
        } catch { console.log('バックアップ作成をスキップ'); }
        
        sendUpdateProgress(40, '新しいサーバーJARをダウンロード中...');
        await downloadServerJar(serverInfo.type, updateConfig.targetVersion, serverPath);
        
        sendUpdateProgress(80, 'サーバー情報を更新中...');
        serverInfo.version = updateConfig.targetVersion;
        serverInfo.lastUpdated = new Date().toISOString();
        await fs.writeFile(path.join(serverPath, '.server-info.json'), JSON.stringify(serverInfo, null, 2));
        
        // start.bat更新
        const serverType = serverInfo.type.charAt(0).toUpperCase() + serverInfo.type.slice(1);
        const startBat = `title ${serverType} Server v${updateConfig.targetVersion}\njava -Xmx${serverInfo.maxMemory}M -Xms${serverInfo.minMemory}M -jar server.jar nogui\npause`;
        await fs.writeFile(path.join(serverPath, 'start.bat'), startBat);
        
        sendUpdateProgress(100, 'サーバー更新完了！');
        return { success: true, message: `サーバーを v${serverInfo.version} から v${updateConfig.targetVersion} に更新しました` };
    } catch (error) {
        console.error('サーバー更新エラー:', error);
        return { success: false, error: error.message };
    }
});

// 自動更新チェック
ipcMain.handle('enable-auto-update-check', async (event, serverPath, intervalMinutes = 60) => {
    const checkInterval = intervalMinutes * 60 * 1000;
    
    const checkForUpdates = async () => {
        try {
            const updateInfo = await ipcMain.handle('check-server-updates', null, serverPath);
            if (updateInfo.hasUpdate) mainWindow.webContents.send('update-available', updateInfo);
        } catch (error) {
            console.error('自動更新チェックエラー:', error);
        }
    };
    
    const intervalId = setInterval(checkForUpdates, checkInterval);
    checkForUpdates();
    
    return { success: true, intervalId: intervalId.toString(), message: `${intervalMinutes}分間隔での自動更新チェックを開始しました` };
});
