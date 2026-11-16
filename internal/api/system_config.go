package api

import (
	"net/http"
	"time"

	"agent-evaluation/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SystemConfigHandler struct {
	db *gorm.DB
}

func NewSystemConfigHandler(db *gorm.DB) *SystemConfigHandler {
	return &SystemConfigHandler{db: db}
}

func (h *SystemConfigHandler) List(c *gin.Context) {
	var list []model.SystemConfig
	if err := h.db.Find(&list).Error; err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, list)
}

func (h *SystemConfigHandler) BatchUpdate(c *gin.Context) {
	var req map[string]string
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "参数校验失败: "+err.Error())
		return
	}

	now := time.Now()
	for k, v := range req {
		var cfg model.SystemConfig
		if err := h.db.First(&cfg, "key = ?", k).Error; err == nil {
			cfg.Value = v
			cfg.UpdatedAt = now
			h.db.Save(&cfg)
		} else {
			h.db.Create(&model.SystemConfig{
				Key:       k,
				Value:     v,
				UpdatedAt: now,
			})
		}
	}

	var updated []model.SystemConfig
	h.db.Find(&updated)
	Success(c, updated)
}
