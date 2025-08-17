const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const { spawn, exec } = require('child_process');
const os = require('os');

// 自動アップデート機能をインポート
const { AutoUpdateManager, setupUpdateIPCHandlers } = require('./auto-updater');

let mainWindow;
let updateManager;

// アプリケーション準備完了時の処理
app.whenReady().then(() => {
    createWindow();
    
    // 自動アップデート機能を初期化
    updateManager = new AutoUpdateManager(mainWindow);
    setupUpdateIPCHandlers(updateManager);
    
    // 起動後少し待ってからアップデートチェック
    setTimeout(() => {
        updateManager.checkForUpdates().catch(console.error);
    }, 3000);
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 全てのウィンドウが閉じられた時の処理
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// メインウィンドウの作成
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'assets', 'icon.png'),
        titleBarStyle: 'default',
        resizable: true,
        minWidth: 800,
        minHeight: 600
    });

    mainWindow.loadFile('index.html');
    
    // 開発者ツールを開く（開発時のみ）
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    // ウィンドウが作成された後にアップデートマネージャーを初期化
    if (!updateManager && mainWindow) {
        updateManager = new AutoUpdateManager(mainWindow);
        setupUpdateIPCHandlers(updateManager);
    }
}

// アプリ情報表示
ipcMain.handle('show-about-dialog', async () => {
    const version = app.getVersion();
    await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'About Minecraft Server Creator',
        message: 'Minecraft Server Creator',
        detail: `Version: ${version}\n\nMinecraftサーバーを簡単に作成できるElectronアプリケーション\n\n© 2024 Your Company Name`,
        buttons: ['OK']
    });
});

// 更新履歴表示
ipcMain.handle('show-changelog', async () => {
    const changelogUrl = 'https://github.com/yourusername/minecraft-server-creator/releases';
    await shell.openExternal(changelogUrl);
});

// フォルダ選択ダイアログ
ipcMain.handle('select-folder', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'サーバーの保存先を選択'
        });
        
        return {
            success: !result.canceled,
            path: result.canceled ? '' : result.filePaths[0]
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// デフォルトパス取得
ipcMain.handle('get-default-path', async () => {
    return path.join(os.homedir(), 'MinecraftServers');
});

// バージョン一覧取得
ipcMain.handle('get-versions', async (event, serverType) => {
    try {
        switch (serverType) {
            case 'vanilla':
                return await getVanillaVersions();
            case 'paper':
                return await getPaperVersions();
            case 'spigot':
                return await getSpigotVersions();
            case 'fabric':
                return await getFabricVersions();
            case 'forge':
                return await getForgeVersions();
            case 'neoforge':
                return await getNeoForgeVersions();
            default:
                throw new Error('未対応のサーバータイプ: ' + serverType);
        }
    } catch (error) {
        console.error('バージョン取得エラー:', error);
        return ['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.19.2', '1.18.2', '1.17.1', '1.16.5']; // フォールバック
    }
});

// Vanilla バージョン取得
async function getVanillaVersions() {
    return new Promise((resolve, reject) => {
        https.get('https://launchermeta.mojang.com/mc/game/version_manifest.json', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const manifest = JSON.parse(data);
                    const versions = manifest.versions
                        .filter(v => v.type === 'release')
                        .map(v => v.id);
                    resolve(versions);
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

// Paper バージョン取得
async function getPaperVersions() {
    return new Promise((resolve, reject) => {
        https.get('https://api.papermc.io/v2/projects/paper', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    const versions = response.versions.reverse();
                    resolve(versions);
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

// Spigot バージョン取得（BuildTools情報を含む）
async function getSpigotVersions() {
    // Spigotは手動ビルドが必要なので、一般的なバージョンリストを返す
    return ['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.19.2', '1.18.2', '1.17.1', '1.16.5'];
}

// Fabric バージョン取得
async function getFabricVersions() {
    return new Promise((resolve, reject) => {
        https.get('https://meta.fabricmc.net/v2/versions/game', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const versions = JSON.parse(data)
                        .filter(v => v.stable)
                        .map(v => v.version);
                    resolve(versions);
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

// Forge バージョン取得
async function getForgeVersions() {
    return new Promise((resolve, reject) => {
        https.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const promotions = JSON.parse(data);
                    const versions = Object.keys(promotions.promos)
                        .filter(key => key.endsWith('-recommended') || key.endsWith('-latest'))
                        .map(key => key.replace('-recommended', '').replace('-latest', ''))
                        .filter((version, index, arr) => arr.indexOf(version) === index) // 重複除去
                        .sort((a, b) => {
                            const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
                            const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
                            return bMajor - aMajor || bMinor - aMinor || (bPatch || 0) - (aPatch || 0);
                        });
                    resolve(versions);
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

// NeoForge バージョン取得
async function getNeoForgeVersions() {
    // NeoForgeは新しいプロジェクトなので、基本的なバージョンを返す
    return ['1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.2', '1.20.1'];
}

// Java互換性チェック
ipcMain.handle('check-java', async (event, mcVersion) => {
    try {
        const javaVersion = await getJavaVersion();
        const recommendedJava = getRecommendedJavaVersion(mcVersion);
        
        return {
            installed: javaVersion !== null,
            installedVersion: javaVersion,
            recommendedVersion: recommendedJava,
            compatible: javaVersion ? isJavaCompatible(javaVersion, recommendedJava) : false
        };
    } catch (error) {
        return {
            installed: false,
            installedVersion: null,
            recommendedVersion: getRecommendedJavaVersion(mcVersion),
            compatible: false
        };
    }
});

// Javaバージョン取得
function getJavaVersion() {
    return new Promise((resolve) => {
        exec('java -version', (error, stdout, stderr) => {
            if (error) {
                resolve(null);
                return;
            }
            
            const versionString = stderr || stdout;
            const match = versionString.match(/version "?([0-9]+(?:\.[0-9]+)?)/);
            if (match) {
                const version = match[1];
                // Java 1.8.x を 8 に変換
                if (version.startsWith('1.')) {
                    resolve(version.split('.')[1]);
                } else {
                    resolve(version.split('.')[0]);
                }
            } else {
                resolve(null);
            }
        });
    });
}

// 推奨Javaバージョン取得
function getRecommendedJavaVersion(mcVersion) {
    const [major, minor] = mcVersion.split('.').map(Number);
    
    if (major > 1 || (major === 1 && minor >= 17)) {
        return '17'; // 1.17以降はJava 17以上
    } else if (major === 1 && minor >= 16) {
        return '16'; // 1.16はJava 16推奨
    } else {
        return '8'; // それ以前はJava 8
    }
}

// Java互換性確認
function isJavaCompatible(installedVersion, recommendedVersion) {
    return parseInt(installedVersion) >= parseInt(recommendedVersion);
}

// 残りのIPCハンドラーは既存のコードと同じなので省略...
// (create-server, start-server, check-server-updates, update-server等)

// サーバー作成
ipcMain.handle('create-server', async (event, config) => {
    try {
        const serverDir = path.join(config.savePath, config.serverName);
        
        // プログレス送信
        const sendProgress = (percent, message) => {
            mainWindow.webContents.send('creation-progress', { percent, message });
        };

        sendProgress(10, 'フォルダを作成中...');
        
        // サーバーディレクトリ作成
        await fs.mkdir(serverDir, { recursive: true });
        
        sendProgress(20, 'サーバーファイルをダウンロード中...');
        
        // サーバーjarファイルをダウンロード
        if (config.autoDownload) {
            await downloadServerJar(config.serverType, config.version, serverDir, sendProgress);
        }
        
        sendProgress(60, '設定ファイルを作成中...');
        
        // 設定ファイル作成
        await createConfigFiles(serverDir, config);
        
        sendProgress(80, '起動スクリプトを作成中...');
        
        // 起動スクリプト作成
        await createStartScript(serverDir, config);
        
        sendProgress(90, 'EULA設定中...');
        
        // EULA設定
        if (config.autoEula) {
            await createEulaFile(serverDir);
        }
        
        sendProgress(95, 'サーバー情報を保存中...');
        
        // サーバー情報ファイルを作成
        const serverInfo = {
            name: config.serverName,
            type: config.serverType,
            version: config.version,
            minMemory: config.minMemory,
            maxMemory: config.maxMemory,
            created: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            autoDownload: config.autoDownload,
            autoEula: config.autoEula,
        };
        
        await fs.writeFile(path.join(serverDir, '.server-info.json'), JSON.stringify(serverInfo, null, 2));
        
        sendProgress(100, 'サーバー作成完了！');
        
        return { success: true };
    } catch (error) {
        console.error('サーバー作成エラー:', error);
        return { success: false, error: error.message };
    }
});

// サーバーJARダウンロード（修正版）
async function downloadServerJar(serverType, version, serverDir, progressCallback) {
    let downloadUrl;
    let fileName = 'server.jar';
    
    switch (serverType) {
        case 'vanilla':
            downloadUrl = await getVanillaDownloadUrl(version);
            break;
        case 'paper':
            downloadUrl = await getPaperDownloadUrl(version);
            break;
        case 'spigot':
            // Spigotの場合は特別な処理
            await handleSpigotSetup(version, serverDir, progressCallback);
            return;
        case 'fabric':
            downloadUrl = await getFabricDownloadUrl(version);
            break;
        case 'forge':
            downloadUrl = await getForgeDownloadUrl(version);
            fileName = 'forge-installer.jar';
            break;
        case 'neoforge':
            downloadUrl = await getNeoForgeDownloadUrl(version);
            fileName = 'neoforge-installer.jar';
            break;
        default:
            throw new Error('未対応のサーバータイプ');
    }
    
    if (!downloadUrl) {
        throw new Error('ダウンロードURLの取得に失敗しました');
    }
    
    const jarPath = path.join(serverDir, fileName);
    await downloadFile(downloadUrl, jarPath, progressCallback);
    
    // Forge/NeoForgeの場合は追加処理
    if (serverType === 'forge' || serverType === 'neoforge') {
        await handleForgeInstallation(serverDir, fileName, version, progressCallback);
    }
}

// Spigot セットアップ処理
async function handleSpigotSetup(version, serverDir, progressCallback) {
    progressCallback(30, 'Spigot用の設定ファイルを作成中...');
    
    // BuildTools使用方法の説明ファイルを作成
    const buildInstructions = `Spigotサーバーのセットアップ方法

Spigotは公式のJARファイルを配布していないため、手動でビルドする必要があります。

セットアップ手順:
1. https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar
   から BuildTools.jar をダウンロード

2. このフォルダに BuildTools.jar を配置

3. コマンドプロンプトでこのフォルダに移動し、以下のコマンドを実行:
   java -jar BuildTools.jar --rev ${version}

4. ビルドが完了したら、生成された spigot-${version}.jar を server.jar にリネーム

5. start.bat を実行してサーバーを起動

注意: ビルドには時間がかかる場合があります（5-15分程度）
`;
    
    await fs.writeFile(path.join(serverDir, 'Spigot_セットアップ手順.txt'), buildInstructions);
    
    // ビルド用バッチファイルを作成
    const buildBat = `@echo off
title Spigot Build Process
echo Spigot ${version} をビルド中...
echo.

if not exist "BuildTools.jar" (
    echo エラー: BuildTools.jar が見つかりません
    echo https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar
    echo から BuildTools.jar をダウンロードしてこのフォルダに配置してください
    pause
    exit /b 1
)

java -jar BuildTools.jar --rev ${version}

if exist "spigot-${version}.jar" (
    echo.
    echo ビルド成功！ spigot-${version}.jar を server.jar にリネーム中...
    rename "spigot-${version}.jar" "server.jar"
    echo.
    echo セットアップ完了！ start.bat でサーバーを起動できます
) else (
    echo.
    echo ビルドに失敗しました。エラーログを確認してください。
)

pause`;
    
    await fs.writeFile(path.join(serverDir, 'build-spigot.bat'), buildBat);
    
    progressCallback(50, 'Spigot用ファイルを作成完了');
}

// Forge インストール処理
async function handleForgeInstallation(serverDir, installerFileName, version, progressCallback) {
    progressCallback(40, 'Forgeインストーラーを実行中...');
    
    const installerPath = path.join(serverDir, installerFileName);
    
    try {
        // Forgeインストーラーを実行
        await new Promise((resolve, reject) => {
            const installer = spawn('java', ['-jar', installerFileName, '--installServer'], {
                cwd: serverDir,
                stdio: 'pipe'
            });
            
            let output = '';
            installer.stdout.on('data', (data) => {
                output += data.toString();
                progressCallback(60, 'Forgeサーバーファイルを生成中...');
            });
            
            installer.stderr.on('data', (data) => {
                output += data.toString();
            });
            
            installer.on('close', (code) => {
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(`Forgeインストーラーがエラーコード ${code} で終了しました`));
                }
            });
            
            installer.on('error', (error) => {
                reject(new Error(`Forgeインストーラーの実行に失敗: ${error.message}`));
            });
        });
        
        progressCallback(70, 'Forgeサーバーファイルを確認中...');
        
        // 生成されたサーバーJARファイルを確認
        const files = await fs.readdir(serverDir);
        const serverJar = files.find(file => 
            file.startsWith('forge') && 
            file.endsWith('.jar') && 
            !file.includes('installer') &&
            file.includes(version)
        );
        
        if (serverJar) {
            // server.jar として使用できるようにコピー
            await fs.copyFile(path.join(serverDir, serverJar), path.join(serverDir, 'server.jar'));
            progressCallback(80, 'Forgeサーバー設定完了');
        } else {
            throw new Error('Forgeサーバーファイルの生成に失敗しました');
        }
        
        // インストーラーファイルを削除（オプション）
        try {
            await fs.unlink(installerPath);
        } catch (error) {
            console.log('インストーラーファイルの削除をスキップ:', error.message);
        }
        
    } catch (error) {
        console.error('Forgeインストールエラー:', error);
        
        // フォールバック: 手動インストール用の説明ファイルを作成
        const forgeInstructions = `Forge サーバー手動セットアップ方法

自動インストールに失敗しました。手動でセットアップしてください：

1. ${installerFileName} を実行：
   java -jar ${installerFileName} --installServer

2. 生成された forge-${version}-*.jar を server.jar にリネーム

3. start.bat でサーバーを起動

問題が解決しない場合は、Forgeの公式サイトを確認してください：
https://files.minecraftforge.net/net/minecraftforge/forge/index_${version}.html
`;
        
        await fs.writeFile(path.join(serverDir, 'Forge_手動セットアップ.txt'), forgeInstructions);
        progressCallback(50, 'Forge手動セットアップファイルを作成');
    }
}

// Vanilla ダウンロードURL取得
async function getVanillaDownloadUrl(version) {
    return new Promise((resolve, reject) => {
        https.get('https://launchermeta.mojang.com/mc/game/version_manifest.json', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const manifest = JSON.parse(data);
                    const versionData = manifest.versions.find(v => v.id === version);
                    if (!versionData) {
                        reject(new Error('指定されたバージョンが見つかりません'));
                        return;
                    }
                    
                    https.get(versionData.url, (vRes) => {
                        let vData = '';
                        vRes.on('data', chunk => vData += chunk);
                        vRes.on('end', () => {
                            try {
                                const versionInfo = JSON.parse(vData);
                                resolve(versionInfo.downloads.server.url);
                            } catch (error) {
                                reject(error);
                            }
                        });
                    }).on('error', reject);
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

// Paper ダウンロードURL取得
async function getPaperDownloadUrl(version) {
    return new Promise((resolve, reject) => {
        https.get(`https://api.papermc.io/v2/projects/paper/versions/${version}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const versionData = JSON.parse(data);
                    const latestBuild = versionData.builds[versionData.builds.length - 1];
                    const downloadUrl = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latestBuild}/downloads/paper-${version}-${latestBuild}.jar`;
                    resolve(downloadUrl);
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

// Fabric ダウンロードURL取得
async function getFabricDownloadUrl(version) {
    return new Promise((resolve, reject) => {
        https.get('https://meta.fabricmc.net/v2/versions/loader', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const loaders = JSON.parse(data);
                    const latestLoader = loaders.find(l => l.stable);
                    if (!latestLoader) {
                        reject(new Error('安定版のFabric Loaderが見つかりません'));
                        return;
                    }
                    
                    https.get('https://meta.fabricmc.net/v2/versions/installer', (iRes) => {
                        let iData = '';
                        iRes.on('data', chunk => iData += chunk);
                        iRes.on('end', () => {
                            try {
                                const installers = JSON.parse(iData);
                                const latestInstaller = installers.find(i => i.stable);
                                const downloadUrl = `https://meta.fabricmc.net/v2/versions/loader/${version}/${latestLoader.version}/${latestInstaller.version}/server/jar`;
                                resolve(downloadUrl);
                            } catch (error) {
                                reject(error);
                            }
                        });
                    }).on('error', reject);
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

// Forge ダウンロードURL取得（修正版）
async function getForgeDownloadUrl(version) {
    try {
        return new Promise((resolve, reject) => {
            https.get(`https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json`, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const promotions = JSON.parse(data);
                        const recommendedKey = `${version}-recommended`;
                        const latestKey = `${version}-latest`;
                        
                        let forgeVersion = promotions.promos[recommendedKey] || promotions.promos[latestKey];
                        
                        if (forgeVersion) {
                            const downloadUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${forgeVersion}/forge-${version}-${forgeVersion}-installer.jar`;
                            resolve(downloadUrl);
                        } else {
                            // フォールバック: 一般的なForgeバージョン形式を試行
                            const fallbackUrl = `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${version}/forge-${version}-installer.jar`;
                            resolve(fallbackUrl);
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            }).on('error', reject);
        });
    } catch (error) {
        // 最終フォールバック
        return `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${version}/forge-${version}-installer.jar`;
    }
}

// NeoForge ダウンロードURL取得（修正版）
async function getNeoForgeDownloadUrl(version) {
    // NeoForgeも簡略化（実際のAPIがある場合は適宜修正）
    return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
}

// ファイルダウンロード
function downloadFile(url, filePath, progressCallback) {
    return new Promise((resolve, reject) => {
        const file = require('fs').createWriteStream(filePath);
        
        https.get(url, (response) => {
            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;
            
            response.pipe(file);
            
            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (totalSize && progressCallback) {
                    const percent = Math.round((downloadedSize / totalSize) * 30) + 20; // 20-50%の範囲
                    progressCallback(percent, `ダウンロード中... ${Math.round(downloadedSize / 1024 / 1024)}MB / ${Math.round(totalSize / 1024 / 1024)}MB`);
                }
            });
            
            file.on('finish', () => {
                file.close();
                resolve();
            });
            
            file.on('error', (error) => {
                fs.unlink(filePath);
                reject(error);
            });
        }).on('error', reject);
    });
}

// 設定ファイル作成
async function createConfigFiles(serverDir, config) {
    // server.properties
    const serverProperties = `
#Minecraft server properties
server-port=25565
gamemode=survival
difficulty=easy
spawn-protection=16
max-players=20
online-mode=true
white-list=false
motd=A Minecraft Server
`.trim();
    
    await fs.writeFile(path.join(serverDir, 'server.properties'), serverProperties);
}

// 起動スクリプト作成（修正版）
async function createStartScript(serverDir, config) {
    const serverType = config.serverType.charAt(0).toUpperCase() + config.serverType.slice(1);
    
    let startBat;
    
    if (config.serverType === 'spigot') {
        startBat = `title ${serverType} Server v${config.version}
@echo off
if not exist "server.jar" (
    echo エラー: server.jar が見つかりません
    echo build-spigot.bat を実行してSpigotをビルドしてください
    pause
    exit /b 1
)
java -Xmx${config.maxMemory}M -Xms${config.minMemory}M -jar server.jar nogui
pause`;
    } else {
        startBat = `title ${serverType} Server v${config.version}
java -Xmx${config.maxMemory}M -Xms${config.minMemory}M -jar server.jar nogui
pause`;
    }
    
    await fs.writeFile(path.join(serverDir, 'start.bat'), startBat);
    
    // 起動方法説明ファイル（修正版）
    let instructions = `起動方法:\n\n`;
    
    if (config.serverType === 'spigot') {
        instructions += `Spigotサーバーの場合:
1. まず build-spigot.bat を実行してSpigotをビルド
2. ビルドが完了したら start.bat を起動
3. サーバーが起動したら一度stopと入力してサーバーを停止
4. server.propertiesなどからサーバー設定を行ってください
5. 再度start.batを起動してサーバーを開始

`;
    } else {
        instructions += `1. start.batを起動してください
2. "For help, type "help""と出てきたら一度stopと入力してサーバーを停止
3. server.propertiesなどからサーバー設定を行ってください
4. 再度start.batを起動してサーバーを開始

`;
    }
    
    instructions += `注意:
- 初回起動時は自動的にサーバーが停止します
- server.propertiesでサーバー設定をカスタマイズできます
- ポート開放が必要な場合があります（デフォルト: 25565）
`;
    
    if (config.serverType === 'forge' || config.serverType === 'neoforge') {
        instructions += `- ${serverType}サーバーの初回起動には時間がかかる場合があります\n`;
    }
    
    await fs.writeFile(path.join(serverDir, '起動方法.txt'), instructions);
}

// EULA作成
async function createEulaFile(serverDir) {
    const eulaContent = `#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).
eula=true`;
    
    await fs.writeFile(path.join(serverDir, 'eula.txt'), eulaContent);
}

// サーバー起動
ipcMain.handle('start-server', async (event, serverPath) => {
    try {
        const startBatPath = path.join(serverPath, 'start.bat');
        
        // Windowsの場合はcmdで実行
        if (os.platform() === 'win32') {
            spawn('cmd', ['/c', 'start', 'cmd', '/k', `"${startBatPath}"`], {
                cwd: serverPath,
                detached: true
            });
        } else {
            // macOS/Linuxの場合はターミナルで実行
            spawn('open', ['-a', 'Terminal', startBatPath], {
                cwd: serverPath,
                detached: true
            });
        }
        
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// サーバー更新チェック
ipcMain.handle('check-server-updates', async (event, serverPath) => {
    try {
        const serverInfoPath = path.join(serverPath, '.server-info.json');
        
        // サーバー情報ファイルが存在するかチェック
        try {
            const serverInfoData = await fs.readFile(serverInfoPath, 'utf8');
            const serverInfo = JSON.parse(serverInfoData);
            
            // 現在のバージョンと最新バージョンを比較
            const latestVersions = await getLatestVersions(serverInfo.type);
            const currentVersion = serverInfo.version;
            const latestVersion = latestVersions[0]; // 最新バージョン
            
            return {
                hasUpdate: currentVersion !== latestVersion,
                currentVersion,
                latestVersion,
                serverType: serverInfo.type,
                serverName: serverInfo.name
            };
        } catch (error) {
            // サーバー情報ファイルが存在しない場合は更新チェック不可
            return {
                hasUpdate: false,
                error: 'サーバー情報ファイルが見つかりません'
            };
        }
    } catch (error) {
        return {
            hasUpdate: false,
            error: error.message
        };
    }
});

// サーバー更新実行
ipcMain.handle('update-server', async (event, serverPath, updateConfig) => {
    try {
        const sendProgress = (percent, message) => {
            mainWindow.webContents.send('update-progress', { percent, message });
        };

        sendProgress(10, 'サーバー情報を読み込み中...');
        
        const serverInfoPath = path.join(serverPath, '.server-info.json');
        const serverInfoData = await fs.readFile(serverInfoPath, 'utf8');
        const serverInfo = JSON.parse(serverInfoData);
        
        sendProgress(20, '最新バージョンを確認中...');
        
        // 現在のserver.jarをバックアップ
        const serverJarPath = path.join(serverPath, 'server.jar');
        const backupJarPath = path.join(serverPath, `server-${serverInfo.version}-backup.jar`);
        
        try {
            await fs.copyFile(serverJarPath, backupJarPath);
            sendProgress(30, 'バックアップを作成しました');
        } catch (error) {
            console.log('バックアップ作成をスキップ（既存ファイルなし）');
        }
        
        sendProgress(40, '新しいサーバーJARをダウンロード中...');
        
        // 新しいバージョンをダウンロード
        await downloadServerJar(serverInfo.type, updateConfig.targetVersion, serverPath, sendProgress);
        
        sendProgress(80, 'サーバー情報を更新中...');
        
        // サーバー情報ファイルを更新
        serverInfo.version = updateConfig.targetVersion;
        serverInfo.lastUpdated = new Date().toISOString();
        await fs.writeFile(serverInfoPath, JSON.stringify(serverInfo, null, 2));
        
        // start.batを更新
        const serverType = serverInfo.type.charAt(0).toUpperCase() + serverInfo.type.slice(1);
        const startBat = `title ${serverType} Server v${updateConfig.targetVersion}
java -Xmx${serverInfo.maxMemory}M -Xms${serverInfo.minMemory}M -jar server.jar nogui
pause`;
        
        await fs.writeFile(path.join(serverPath, 'start.bat'), startBat);
        
        sendProgress(100, 'サーバー更新完了！');
        
        return { 
            success: true, 
            message: `サーバーを v${serverInfo.version} から v${updateConfig.targetVersion} に更新しました` 
        };
        
    } catch (error) {
        console.error('サーバー更新エラー:', error);
        return { 
            success: false, 
            error: error.message 
        };
    }
});

// 最新バージョン取得（更新チェック用）
async function getLatestVersions(serverType) {
    switch (serverType) {
        case 'vanilla':
            return await getVanillaVersions();
        case 'paper':
            return await getPaperVersions();
        case 'spigot':
            return await getSpigotVersions();
        case 'fabric':
            return await getFabricVersions();
        case 'forge':
            return await getForgeVersions();
        case 'neoforge':
            return await getNeoForgeVersions();
        default:
            throw new Error('未対応のサーバータイプ: ' + serverType);
    }
}

// 自動更新チェック（定期実行）
ipcMain.handle('enable-auto-update-check', async (event, serverPath, intervalMinutes = 60) => {
    const checkInterval = intervalMinutes * 60 * 1000; // ミリ秒に変換
    
    const checkForUpdates = async () => {
        try {
            const updateInfo = await ipcMain.handle('check-server-updates', null, serverPath);
            if (updateInfo.hasUpdate) {
                // メインプロセスに更新通知を送信
                mainWindow.webContents.send('update-available', updateInfo);
            }
        } catch (error) {
            console.error('自動更新チェックエラー:', error);
        }
    };
    
    // 定期実行開始
    const intervalId = setInterval(checkForUpdates, checkInterval);
    
    // 初回実行
    checkForUpdates();
    
    return { 
        success: true, 
        intervalId: intervalId.toString(),
        message: `${intervalMinutes}分間隔での自動更新チェックを開始しました` 
    };
});
