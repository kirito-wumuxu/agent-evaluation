package updater

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	DefaultGitHubRepo = "kirito-wumuxu/agent-evaluation"
	DefaultTimeout    = 60 * time.Second
)

// GitHubRelease 代表 GitHub Releases API 返回的元数据
type GitHubRelease struct {
	TagName     string         `json:"tag_name"`
	Name        string         `json:"name"`
	Body        string         `json:"body"`
	PublishedAt time.Time      `json:"published_at"`
	Assets      []ReleaseAsset `json:"assets"`
}

// ReleaseAsset 代表 Release 附带的构建产物资产
type ReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// UpdateInfo 客户端或界面获取的更新描述对象
type UpdateInfo struct {
	CurrentVersion string    `json:"current_version"`
	LatestVersion  string    `json:"latest_version"`
	HasUpdate      bool      `json:"has_update"`
	ReleaseNotes   string    `json:"release_notes"`
	PublishedAt    time.Time `json:"published_at"`
	AssetURL       string    `json:"asset_url"`
	AssetName      string    `json:"asset_name"`
	AssetSize      int64     `json:"asset_size"`
	ChecksumURL    string    `json:"checksum_url"`
	ChecksumSHA256 string    `json:"checksum_sha256"`
}

// Manager 软件版本自更新管理器
type Manager struct {
	repo         string
	proxy        string
	apiBaseURL   string
	httpClient   *http.Client
	cacheMu      sync.RWMutex
	cachedInfo   *UpdateInfo
	lastCheckAt  time.Time
	cacheTTL     time.Duration
}

// NewManager 创建更新管理器
func NewManager(repo, proxy string) *Manager {
	if repo == "" {
		repo = DefaultGitHubRepo
	}
	return &Manager{
		repo:       repo,
		proxy:      proxy,
		apiBaseURL: "https://api.github.com",
		httpClient: &http.Client{Timeout: DefaultTimeout},
		cacheTTL:   5 * time.Minute,
	}
}

// SetProxy 设置网络加速代理 (如 https://ghproxy.net/)
func (m *Manager) SetProxy(proxy string) {
	m.proxy = strings.TrimSpace(proxy)
}

// CheckUpdate 检测 GitHub Releases 最新版本并判定是否有更新
func (m *Manager) CheckUpdate(currentVersion string, force bool) (*UpdateInfo, error) {
	m.cacheMu.RLock()
	if !force && m.cachedInfo != nil && time.Since(m.lastCheckAt) < m.cacheTTL {
		info := *m.cachedInfo
		info.CurrentVersion = currentVersion
		info.HasUpdate = CompareVersions(currentVersion, info.LatestVersion) < 0
		m.cacheMu.RUnlock()
		return &info, nil
	}
	m.cacheMu.RUnlock()

	baseURL := m.apiBaseURL
	if baseURL == "" {
		baseURL = "https://api.github.com"
	}
	apiURL := fmt.Sprintf("%s/repos/%s/releases/latest", baseURL, m.repo)
	if m.proxy != "" {
		apiURL = applyProxy(m.proxy, apiURL)
	}

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("构建更新检查请求失败: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "agent-evaluation-updater")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 GitHub Releases 失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub API 响应异常 HTTP %d: %s", resp.StatusCode, string(body))
	}

	var release GitHubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("解析 GitHub Release 失败: %w", err)
	}

	info := &UpdateInfo{
		CurrentVersion: currentVersion,
		LatestVersion:  release.TagName,
		ReleaseNotes:   release.Body,
		PublishedAt:    release.PublishedAt,
		HasUpdate:      CompareVersions(currentVersion, release.TagName) < 0,
	}

	// 匹配当前平台对应的构建资产 (如 agent-eval-server_v0.0.1_linux_amd64.tar.gz)
	osName := runtime.GOOS
	archName := runtime.GOARCH
	platformSuffix := fmt.Sprintf("_%s_%s.", osName, archName)

	var checksumAsset *ReleaseAsset
	for _, asset := range release.Assets {
		if asset.Name == "checksums.txt" {
			chk := asset
			checksumAsset = &chk
		}
		if strings.Contains(asset.Name, platformSuffix) {
			info.AssetURL = asset.BrowserDownloadURL
			if m.proxy != "" {
				info.AssetURL = applyProxy(m.proxy, asset.BrowserDownloadURL)
			}
			info.AssetName = asset.Name
			info.AssetSize = asset.Size
		}
	}

	// 若存在 checksums.txt，解析匹配该包的 sha256 校验和
	if checksumAsset != nil && info.AssetName != "" {
		info.ChecksumURL = checksumAsset.BrowserDownloadURL
		if m.proxy != "" {
			info.ChecksumURL = applyProxy(m.proxy, checksumAsset.BrowserDownloadURL)
		}
		sha, err := m.fetchChecksum(info.ChecksumURL, info.AssetName)
		if err == nil {
			info.ChecksumSHA256 = sha
		}
	}

	m.cacheMu.Lock()
	m.cachedInfo = info
	m.lastCheckAt = time.Now()
	m.cacheMu.Unlock()

	return info, nil
}

// fetchChecksum 从 checksums.txt 中提取特定文件的 SHA256
func (m *Manager) fetchChecksum(checksumURL, targetAssetName string) (string, error) {
	req, err := http.NewRequest("GET", checksumURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "agent-evaluation-updater")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("获取 checksums.txt 失败 HTTP %d", resp.StatusCode)
	}

	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	for _, line := range strings.Split(string(content), "\n") {
		parts := strings.Fields(strings.TrimSpace(line))
		if len(parts) >= 2 {
			hash := parts[0]
			name := filepath.Base(parts[1])
			if name == targetAssetName || strings.Contains(parts[1], targetAssetName) {
				return hash, nil
			}
		}
	}
	return "", fmt.Errorf("checksums.txt 中未找到 %s 的校验和", targetAssetName)
}

// ApplyUpdate 下载新版本资产、校验哈希、解压提取单二进制并原子替换当前可执行文件
func (m *Manager) ApplyUpdate(assetURL, expectedSHA256 string, onProgress func(percent int, msg string)) error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取当前可执行文件路径失败: %w", err)
	}
	exePath, err = filepath.EvalSymlinks(exePath)
	if err != nil {
		return fmt.Errorf("解析可执行文件符号链接失败: %w", err)
	}
	return m.ApplyUpdateToPath(exePath, assetURL, expectedSHA256, onProgress)
}

// ApplyUpdateToPath 下载新版本资产并原子替换指定路径的可执行文件 (便于单元测试与灵活部署)
func (m *Manager) ApplyUpdateToPath(exePath, assetURL, expectedSHA256 string, onProgress func(percent int, msg string)) error {
	if assetURL == "" {
		return fmt.Errorf("下载地址为空，未找到适配当前系统平台 (%s/%s) 的发布资产", runtime.GOOS, runtime.GOARCH)
	}

	exeDir := filepath.Dir(exePath)

	if onProgress != nil {
		onProgress(10, "正在连接下载服务器...")
	}

	// 2. 下载归档包文件至同目录临时文件 (确保后续可原子 rename)
	req, err := http.NewRequest("GET", assetURL, nil)
	if err != nil {
		return fmt.Errorf("创建下载请求失败: %w", err)
	}
	req.Header.Set("User-Agent", "agent-evaluation-updater")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("下载发布资产失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载发布资产返回 HTTP %d", resp.StatusCode)
	}

	tempArchive, err := os.CreateTemp(exeDir, "agent-eval-update-archive-*")
	if err != nil {
		return fmt.Errorf("创建临时下载文件失败: %w", err)
	}
	tempArchivePath := tempArchive.Name()
	defer os.Remove(tempArchivePath)

	hasher := sha256.New()
	writer := io.MultiWriter(tempArchive, hasher)

	totalBytes := resp.ContentLength
	var downloadedBytes int64
	buf := make([]byte, 32*1024)

	for {
		n, rErr := resp.Body.Read(buf)
		if n > 0 {
			_, wErr := writer.Write(buf[:n])
			if wErr != nil {
				tempArchive.Close()
				return fmt.Errorf("写入临时下载文件失败: %w", wErr)
			}
			downloadedBytes += int64(n)
			if onProgress != nil && totalBytes > 0 {
				pct := 10 + int((downloadedBytes*60)/totalBytes)
				onProgress(pct, fmt.Sprintf("正在下载更新包... (%d/%d KB)", downloadedBytes/1024, totalBytes/1024))
			}
		}
		if rErr == io.EOF {
			break
		}
		if rErr != nil {
			tempArchive.Close()
			return fmt.Errorf("读取网络下载流失败: %w", rErr)
		}
	}
	_ = tempArchive.Close()

	// 3. SHA256 校验和防篡改检验
	calculatedSHA := hex.EncodeToString(hasher.Sum(nil))
	if expectedSHA256 != "" && !strings.EqualFold(calculatedSHA, expectedSHA256) {
		return fmt.Errorf("文件哈希校验失败: 期望 %s, 实际计算得到 %s", expectedSHA256, calculatedSHA)
	}

	if onProgress != nil {
		onProgress(75, "校验通过，正在解压更新文件...")
	}

	// 4. 解压提取可执行二进制文件
	var extractedBinPath string
	lowerURL := strings.ToLower(assetURL)
	if strings.HasSuffix(lowerURL, ".zip") {
		extractedBinPath, err = extractBinaryFromZip(tempArchivePath, exeDir)
	} else if strings.HasSuffix(lowerURL, ".tar.gz") || strings.HasSuffix(lowerURL, ".tgz") {
		extractedBinPath, err = extractBinaryFromTarGz(tempArchivePath, exeDir)
	} else {
		return fmt.Errorf("不支持的归档包格式: %s", assetURL)
	}
	if err != nil {
		return fmt.Errorf("解压提取二进制失败: %w", err)
	}
	defer os.Remove(extractedBinPath)

	if onProgress != nil {
		onProgress(90, "正在替换程序二进制文件...")
	}

	// 5. 确保新二进制具备可执行权限
	if err := os.Chmod(extractedBinPath, 0755); err != nil {
		return fmt.Errorf("赋予新二进制执行权限失败: %w", err)
	}

	// 6. 原子重命名替换
	oldBackupPath := exePath + ".old"
	_ = os.Remove(oldBackupPath)

	// Windows 下正在运行的可执行文件无法被直接覆写，但支持重命名为 .old
	if err := os.Rename(exePath, oldBackupPath); err != nil {
		return fmt.Errorf("备份当前可执行文件失败: %w", err)
	}

	if err := os.Rename(extractedBinPath, exePath); err != nil {
		// 尝试还原备份
		_ = os.Rename(oldBackupPath, exePath)
		return fmt.Errorf("替换新二进制文件失败: %w", err)
	}

	// 尽力删除旧备份（Windows 下可在程序重启后由新进程处理）
	_ = os.Remove(oldBackupPath)

	if onProgress != nil {
		onProgress(100, "自更新完成！")
	}

	return nil
}

// RestartCurrentProcess 重启当前服务进程
func RestartCurrentProcess() error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取可执行文件路径失败: %w", err)
	}
	exePath, err = filepath.EvalSymlinks(exePath)
	if err != nil {
		return fmt.Errorf("解析可执行文件路径失败: %w", err)
	}

	// Unix 系统（Linux/macOS）使用 syscall.Exec 原地重载进程映像
	if runtime.GOOS != "windows" {
		log.Printf("[Updater] 正在通过 syscall.Exec 重启进程: %s %v", exePath, os.Args)
		return syscall.Exec(exePath, os.Args, os.Environ())
	}

	// Windows 系统派生新进程并退出当前进程
	cmd := exec.Command(exePath, os.Args[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("Windows 启动新进程失败: %w", err)
	}
	os.Exit(0)
	return nil
}

// -------------------------------------------------------------
// 辅助函数
// -------------------------------------------------------------

func applyProxy(proxy, targetURL string) string {
	proxy = strings.TrimRight(proxy, "/")
	if proxy == "" {
		return targetURL
	}
	return proxy + "/" + targetURL
}

func extractBinaryFromTarGz(archivePath, targetDir string) (string, error) {
	file, err := os.Open(archivePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	gzReader, err := gzip.NewReader(file)
	if err != nil {
		return "", err
	}
	defer gzReader.Close()

	tarReader := tar.NewReader(gzReader)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}

		baseName := filepath.Base(header.Name)
		if isBinaryName(baseName) && (header.Typeflag == tar.TypeReg || header.Typeflag == tar.TypeRegA) {
			tempBin, err := os.CreateTemp(targetDir, "agent-eval-bin-*")
			if err != nil {
				return "", err
			}
			if _, err := io.Copy(tempBin, tarReader); err != nil {
				tempBin.Close()
				os.Remove(tempBin.Name())
				return "", err
			}
			tempBin.Close()
			return tempBin.Name(), nil
		}
	}
	return "", fmt.Errorf("未在压缩包中找到可执行文件 agent-eval-server")
}

func extractBinaryFromZip(archivePath, targetDir string) (string, error) {
	zipReader, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", err
	}
	defer zipReader.Close()

	for _, file := range zipReader.File {
		baseName := filepath.Base(file.Name)
		if isBinaryName(baseName) && !file.FileInfo().IsDir() {
			rc, err := file.Open()
			if err != nil {
				return "", err
			}

			tempBin, err := os.CreateTemp(targetDir, "agent-eval-bin-*")
			if err != nil {
				rc.Close()
				return "", err
			}

			if _, err := io.Copy(tempBin, rc); err != nil {
				rc.Close()
				tempBin.Close()
				os.Remove(tempBin.Name())
				return "", err
			}
			rc.Close()
			tempBin.Close()
			return tempBin.Name(), nil
		}
	}
	return "", fmt.Errorf("未在 zip 压缩包中找到可执行文件 agent-eval-server")
}

func isBinaryName(name string) bool {
	cleanName := strings.ToLower(filepath.Base(name))
	return cleanName == "agent-eval-server" || cleanName == "agent-eval-server.exe"
}

// CompareVersions 比较两个版本号，返回 1 (v1 > v2), -1 (v1 < v2), 0 (v1 == v2)
// 支持规范的语义化版本对比，如 "v0.0.1" < "v0.0.2", "v0.1.0" < "v1.0.0"
func CompareVersions(v1, v2 string) int {
	v1Clean := strings.TrimPrefix(strings.TrimSpace(v1), "v")
	v2Clean := strings.TrimPrefix(strings.TrimSpace(v2), "v")

	if v1Clean == v2Clean {
		return 0
	}

	// 本地开发版总是视为落后于正式发布版
	if v1Clean == "dev" || v1Clean == "none" || v1Clean == "unknown" || v1Clean == "" {
		if v2Clean != "" && v2Clean != "dev" {
			return -1
		}
		return 0
	}
	if v2Clean == "dev" || v2Clean == "none" || v2Clean == "unknown" || v2Clean == "" {
		return 1
	}

	parts1 := strings.Split(v1Clean, ".")
	parts2 := strings.Split(v2Clean, ".")

	maxLen := len(parts1)
	if len(parts2) > maxLen {
		maxLen = len(parts2)
	}

	for i := 0; i < maxLen; i++ {
		var n1, n2 int
		if i < len(parts1) {
			// 处理预发布标识符如 1.0.0-rc1
			part := strings.Split(parts1[i], "-")[0]
			n1, _ = strconv.Atoi(part)
		}
		if i < len(parts2) {
			part := strings.Split(parts2[i], "-")[0]
			n2, _ = strconv.Atoi(part)
		}

		if n1 > n2 {
			return 1
		}
		if n1 < n2 {
			return -1
		}
	}

	return 0
}
