package api

import (
	"net/http"
	"time"

	"agent-evaluation/internal/model"
	"agent-evaluation/internal/updater"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SystemUpdateHandler struct {
	db        *gorm.DB
	version   string
	commit    string
	buildTime string
	updater   *updater.Manager
}

func NewSystemUpdateHandler(db *gorm.DB, version, commit, buildTime string, mgr *updater.Manager) *SystemUpdateHandler {
	if mgr == nil {
		mgr = updater.NewManager("", "")
	}
	return &SystemUpdateHandler{
		db:        db,
		version:   version,
		commit:    commit,
		buildTime: buildTime,
		updater:   mgr,
	}
}

func (h *SystemUpdateHandler) refreshProxyFromDB() {
	var cfg model.SystemConfig
	if err := h.db.Where("key = ?", "github_proxy").First(&cfg).Error; err == nil && cfg.Value != "" {
		h.updater.SetProxy(cfg.Value)
	}
}

// GetVersion 获取当前软件版本及最新发布信息
func (h *SystemUpdateHandler) GetVersion(c *gin.Context) {
	h.refreshProxyFromDB()

	// 默认使用缓存，避免频繁刷新造成 GitHub API 限流
	info, err := h.updater.CheckUpdate(h.version, false)
	if err != nil {
		Success(c, gin.H{
			"current_version": h.version,
			"git_commit":      h.commit,
			"build_time":      h.buildTime,
			"has_update":      false,
			"check_error":     err.Error(),
		})
		return
	}

	Success(c, gin.H{
		"current_version": h.version,
		"git_commit":      h.commit,
		"build_time":      h.buildTime,
		"latest_version":  info.LatestVersion,
		"has_update":      info.HasUpdate,
		"release_notes":   info.ReleaseNotes,
		"published_at":    info.PublishedAt,
		"asset_url":       info.AssetURL,
		"asset_name":      info.AssetName,
		"asset_size":      info.AssetSize,
		"checksum_url":    info.ChecksumURL,
	})
}

// CheckUpdate 强制刷新检查 GitHub 最新版本
func (h *SystemUpdateHandler) CheckUpdate(c *gin.Context) {
	h.refreshProxyFromDB()

	info, err := h.updater.CheckUpdate(h.version, true)
	if err != nil {
		Error(c, http.StatusInternalServerError, "检查更新失败: "+err.Error())
		return
	}

	Success(c, gin.H{
		"current_version": h.version,
		"git_commit":      h.commit,
		"build_time":      h.buildTime,
		"latest_version":  info.LatestVersion,
		"has_update":      info.HasUpdate,
		"release_notes":   info.ReleaseNotes,
		"published_at":    info.PublishedAt,
		"asset_url":       info.AssetURL,
		"asset_name":      info.AssetName,
		"asset_size":      info.AssetSize,
		"checksum_url":    info.ChecksumURL,
	})
}

// ApplyUpdate 执行自更新
func (h *SystemUpdateHandler) ApplyUpdate(c *gin.Context) {
	h.refreshProxyFromDB()

	var req struct {
		AssetURL       string `json:"asset_url"`
		ChecksumSHA256 string `json:"checksum_sha256"`
	}
	_ = c.ShouldBindJSON(&req)

	assetURL := req.AssetURL
	checksum := req.ChecksumSHA256

	if assetURL == "" {
		info, err := h.updater.CheckUpdate(h.version, true)
		if err != nil {
			Error(c, http.StatusInternalServerError, "获取最新发布包失败: "+err.Error())
			return
		}
		if !info.HasUpdate {
			Error(c, http.StatusBadRequest, "当前已是最新版本，无需更新")
			return
		}
		assetURL = info.AssetURL
		checksum = info.ChecksumSHA256
	}

	if assetURL == "" {
		Error(c, http.StatusBadRequest, "未找到适配当前操作系统与架构的发布安装包")
		return
	}

	if err := h.updater.ApplyUpdate(assetURL, checksum, nil); err != nil {
		Error(c, http.StatusInternalServerError, "自更新失败: "+err.Error())
		return
	}

	// 异步延迟 1 秒后触发进程重启
	go func() {
		time.Sleep(1 * time.Second)
		_ = updater.RestartCurrentProcess()
	}()

	Success(c, gin.H{
		"message": "自更新成功完成！服务将在 1 秒后自动重启生效。",
	})
}

// RestartServer 管理员手动触发重启服务
func (h *SystemUpdateHandler) RestartServer(c *gin.Context) {
	go func() {
		time.Sleep(500 * time.Millisecond)
		_ = updater.RestartCurrentProcess()
	}()

	Success(c, gin.H{
		"message": "服务正在重启，请稍后刷新页面...",
	})
}
