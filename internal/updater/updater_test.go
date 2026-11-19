package updater

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		v1       string
		v2       string
		expected int
	}{
		{"v0.0.1", "v0.0.2", -1},
		{"v0.0.2", "v0.0.1", 1},
		{"v0.0.1", "v0.0.1", 0},
		{"0.0.1", "v0.0.1", 0},
		{"v0.1.0", "v0.0.9", 1},
		{"v1.0.0", "v0.9.9", 1},
		{"v1.0.1", "v1.0.2-beta", -1},
		{"dev", "v0.0.1", -1},
		{"v0.0.1", "dev", 1},
		{"none", "v0.0.1", -1},
		{"v1.2.3", "v1.2.3", 0},
	}

	for _, tc := range tests {
		res := CompareVersions(tc.v1, tc.v2)
		if res != tc.expected {
			t.Errorf("CompareVersions(%q, %q) = %d; expected %d", tc.v1, tc.v2, res, tc.expected)
		}
	}
}

func TestCheckUpdate_WithMockServer(t *testing.T) {
	osName := runtime.GOOS
	archName := runtime.GOARCH
	mockAssetName := fmt.Sprintf("agent-eval-server_v1.0.0_%s_%s.tar.gz", osName, archName)
	mockChecksum := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

	var ts *httptest.Server
	ts = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/test-owner/test-repo/releases/latest" {
			release := GitHubRelease{
				TagName:     "v1.0.0",
				Name:        "Release v1.0.0",
				Body:        "## 修复了重要问题\n- 增强稳定性",
				PublishedAt: time.Now(),
				Assets: []ReleaseAsset{
					{
						Name:               mockAssetName,
						BrowserDownloadURL: ts.URL + "/download/" + mockAssetName,
						Size:               1024,
					},
					{
						Name:               "checksums.txt",
						BrowserDownloadURL: ts.URL + "/download/checksums.txt",
						Size:               128,
					},
				},
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(release)
			return
		}

		if r.URL.Path == "/download/checksums.txt" {
			content := fmt.Sprintf("%s  %s\n", mockChecksum, mockAssetName)
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write([]byte(content))
			return
		}

		http.NotFound(w, r)
	}))
	defer ts.Close()

	mgr := NewManager("test-owner/test-repo", "")
	mgr.apiBaseURL = ts.URL

	info, err := mgr.CheckUpdate("v0.0.1", true)
	if err != nil {
		t.Fatalf("CheckUpdate failed: %v", err)
	}

	if !info.HasUpdate {
		t.Errorf("expected HasUpdate=true, got false")
	}
	if info.LatestVersion != "v1.0.0" {
		t.Errorf("expected LatestVersion=v1.0.0, got %s", info.LatestVersion)
	}
	if info.AssetName != mockAssetName {
		t.Errorf("expected AssetName=%s, got %s", mockAssetName, info.AssetName)
	}
	if info.ChecksumSHA256 != mockChecksum {
		t.Errorf("expected ChecksumSHA256=%s, got %s", mockChecksum, info.ChecksumSHA256)
	}
	if info.ReleaseNotes != "## 修复了重要问题\n- 增强稳定性" {
		t.Errorf("unexpected ReleaseNotes: %s", info.ReleaseNotes)
	}
}

func TestApplyUpdate_TarGz(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "updater-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// 1. 创建待被替换的旧二进制文件
	oldBinPath := filepath.Join(tempDir, "agent-eval-server")
	if err := os.WriteFile(oldBinPath, []byte("OLD_BINARY_CONTENT"), 0755); err != nil {
		t.Fatalf("failed to write old binary: %v", err)
	}

	// 2. 打包生成包含新二进制文件的 .tar.gz
	newBinaryContent := []byte("NEW_BINARY_CONTENT_V1.0.0")
	var archiveBuf bytes.Buffer
	gzWriter := gzip.NewWriter(&archiveBuf)
	tarWriter := tar.NewWriter(gzWriter)

	header := &tar.Header{
		Name:     "agent-eval-server_v1.0.0_linux_amd64/agent-eval-server",
		Mode:     0755,
		Size:     int64(len(newBinaryContent)),
		Typeflag: tar.TypeReg,
	}
	if err := tarWriter.WriteHeader(header); err != nil {
		t.Fatalf("failed to write tar header: %v", err)
	}
	if _, err := tarWriter.Write(newBinaryContent); err != nil {
		t.Fatalf("failed to write tar body: %v", err)
	}
	tarWriter.Close()
	gzWriter.Close()

	archiveBytes := archiveBuf.Bytes()
	hasher := sha256.New()
	hasher.Write(archiveBytes)
	expectedSHA256 := hex.EncodeToString(hasher.Sum(nil))

	// 3. 启动 Mock Server 提供归档包下载
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/gzip")
		_, _ = w.Write(archiveBytes)
	}))
	defer ts.Close()

	// 4. 调用 ApplyUpdateToPath 执行更新
	mgr := NewManager("test-owner/test-repo", "")
	progressCalled := false
	err = mgr.ApplyUpdateToPath(oldBinPath, ts.URL+"/agent-eval-server.tar.gz", expectedSHA256, func(pct int, msg string) {
		progressCalled = true
	})
	if err != nil {
		t.Fatalf("ApplyUpdateToPath failed: %v", err)
	}

	if !progressCalled {
		t.Errorf("expected progress callback to be invoked")
	}

	// 5. 校验目标文件已被成功替换为新内容
	updatedContent, err := os.ReadFile(oldBinPath)
	if err != nil {
		t.Fatalf("failed to read updated binary: %v", err)
	}
	if string(updatedContent) != string(newBinaryContent) {
		t.Errorf("expected binary content %q, got %q", string(newBinaryContent), string(updatedContent))
	}
}

func TestApplyUpdate_Zip(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "updater-zip-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	oldBinPath := filepath.Join(tempDir, "agent-eval-server.exe")
	if err := os.WriteFile(oldBinPath, []byte("OLD_WIN_BINARY"), 0755); err != nil {
		t.Fatalf("failed to write old binary: %v", err)
	}

	newBinaryContent := []byte("NEW_WIN_BINARY_V1.0.0")
	var zipBuf bytes.Buffer
	zipWriter := zip.NewWriter(&zipBuf)
	f, err := zipWriter.Create("agent-eval-server_v1.0.0_windows_amd64/agent-eval-server.exe")
	if err != nil {
		t.Fatalf("failed to create zip entry: %v", err)
	}
	if _, err := f.Write(newBinaryContent); err != nil {
		t.Fatalf("failed to write zip content: %v", err)
	}
	zipWriter.Close()

	archiveBytes := zipBuf.Bytes()
	hasher := sha256.New()
	hasher.Write(archiveBytes)
	expectedSHA256 := hex.EncodeToString(hasher.Sum(nil))

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/zip")
		_, _ = w.Write(archiveBytes)
	}))
	defer ts.Close()

	mgr := NewManager("test-owner/test-repo", "")
	err = mgr.ApplyUpdateToPath(oldBinPath, ts.URL+"/agent-eval-server.zip", expectedSHA256, nil)
	if err != nil {
		t.Fatalf("ApplyUpdateToPath zip failed: %v", err)
	}

	updatedContent, err := os.ReadFile(oldBinPath)
	if err != nil {
		t.Fatalf("failed to read updated binary: %v", err)
	}
	if string(updatedContent) != string(newBinaryContent) {
		t.Errorf("expected %q, got %q", string(newBinaryContent), string(updatedContent))
	}
}
