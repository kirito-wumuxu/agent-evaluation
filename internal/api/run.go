package api

import (
	"net/http"
	"time"

	"agent-evaluation/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type RunHandler struct {
	db *gorm.DB
}

func NewRunHandler(db *gorm.DB) *RunHandler {
	return &RunHandler{db: db}
}

func (h *RunHandler) List(c *gin.Context) {
	var runs []model.RunRecord
	query := h.db.Preload("Task").Order("id desc")

	if taskID := c.Query("task_id"); taskID != "" {
		query = query.Where("task_id = ?", taskID)
	}

	if err := query.Find(&runs).Error; err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, runs)
}

func (h *RunHandler) Get(c *gin.Context) {
	id := c.Param("id")
	var run model.RunRecord
	if err := h.db.Preload("Task").
		Preload("Task.Scenario").
		Preload("Task.Environment").
		Preload("Task.Dataset").
		First(&run, id).Error; err != nil {
		Error(c, http.StatusNotFound, "运行记录未找到")
		return
	}
	Success(c, run)
}

func (h *RunHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.db.Delete(&model.RunRecord{}, id).Error; err != nil {
		Error(c, http.StatusInternalServerError, "删除运行记录失败: "+err.Error())
		return
	}
	// 级联清理明细
	h.db.Where("run_record_id = ?", id).Delete(&model.RunRecordItem{})
	Success(c, gin.H{"id": id})
}

// ListItems 获取运行记录的单用例明细列表，支持筛选
func (h *RunHandler) ListItems(c *gin.Context) {
	runID := c.Param("id")
	query := h.db.Where("run_record_id = ?", runID).Preload("TestCase").Order("id asc")

	// 过滤条件: status (COMPLETED / ERROR)
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}

	// 过滤条件: machine_passed (true / false)
	if passed := c.Query("machine_passed"); passed != "" {
		if passed == "true" {
			query = query.Where("machine_passed = ?", true)
		} else if passed == "false" {
			query = query.Where("machine_passed = ?", false)
		}
	}

	// 过滤条件: reviewed (true / false)
	if reviewed := c.Query("reviewed"); reviewed != "" {
		if reviewed == "true" {
			query = query.Where("reviewed_at IS NOT NULL")
		} else if reviewed == "false" {
			query = query.Where("reviewed_at IS NULL")
		}
	}

	var items []model.RunRecordItem
	if err := query.Find(&items).Error; err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, items)
}

// ReviewItem 人工复核接口，双轨记录质检人员评价并重新汇总
func (h *RunHandler) ReviewItem(c *gin.Context) {
	runID := c.Param("id")
	itemID := c.Param("item_id")

	var item model.RunRecordItem
	if err := h.db.Where("id = ? AND run_record_id = ?", itemID, runID).First(&item).Error; err != nil {
		Error(c, http.StatusNotFound, "用例运行明细未找到")
		return
	}

	var req struct {
		HumanScore   *float64 `json:"human_score" binding:"required"`
		HumanPassed  *bool    `json:"human_passed" binding:"required"`
		HumanComment string   `json:"human_comment"`
		ReviewerName string   `json:"reviewer_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "参数校验失败: "+err.Error())
		return
	}

	reviewer := req.ReviewerName
	if reviewer == "" {
		if uVal, exists := c.Get("currentUser"); exists && uVal != nil {
			user := uVal.(*model.User)
			if user.Name != "" {
				reviewer = user.Name
			}
		}
	}
	if reviewer == "" {
		reviewer = "质检员"
	}

	now := time.Now()
	item.HumanScore = req.HumanScore
	item.HumanPassed = req.HumanPassed
	item.HumanComment = req.HumanComment
	item.ReviewerName = reviewer
	item.ReviewedAt = &now

	if err := h.db.Save(&item).Error; err != nil {
		Error(c, http.StatusInternalServerError, "保存人工复核结果失败: "+err.Error())
		return
	}

	// 重新聚合 run_records 的人工复核汇总数据
	h.recalcHumanStats(item.RunRecordID)

	Success(c, item)
}

func (h *RunHandler) recalcHumanStats(runRecordID uint) {
	var items []model.RunRecordItem
	h.db.Where("run_record_id = ? AND reviewed_at IS NOT NULL", runRecordID).Find(&items)

	reviewedCount := len(items)
	humanPassCount := 0
	totalHumanScore := 0.0

	for _, it := range items {
		if it.HumanPassed != nil && *it.HumanPassed {
			humanPassCount++
		}
		if it.HumanScore != nil {
			totalHumanScore += *it.HumanScore
		}
	}

	humanAvgScore := 0.0
	if reviewedCount > 0 {
		humanAvgScore = totalHumanScore / float64(reviewedCount)
	}

	h.db.Model(&model.RunRecord{}).Where("id = ?", runRecordID).Updates(map[string]interface{}{
		"reviewed_count":   reviewedCount,
		"human_pass_count": humanPassCount,
		"human_avg_score":  humanAvgScore,
	})
}
