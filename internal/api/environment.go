package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"agent-evaluation/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-yaml"
	"gorm.io/gorm"
)

type EnvironmentHandler struct {
	db *gorm.DB
}

func NewEnvironmentHandler(db *gorm.DB) *EnvironmentHandler {
	return &EnvironmentHandler{db: db}
}

func (h *EnvironmentHandler) List(c *gin.Context) {
	var envs []model.Environment
	if err := h.db.Order("id desc").Find(&envs).Error; err != nil {
		Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	Success(c, envs)
}

func (h *EnvironmentHandler) Get(c *gin.Context) {
	id := c.Param("id")
	var env model.Environment
	if err := h.db.First(&env, id).Error; err != nil {
		Error(c, http.StatusNotFound, "环境配置未找到")
		return
	}
	Success(c, env)
}

func (h *EnvironmentHandler) Create(c *gin.Context) {
	var req struct {
		Name             string      `json:"name" binding:"required"`
		Description      string      `json:"description"`
		VariablesJSON    string      `json:"variables_json"`
		ScenarioTagsJSON string      `json:"scenario_tags_json"`
		ScenarioTags     interface{} `json:"scenario_tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "请求参数校验失败: "+err.Error())
		return
	}

	if req.VariablesJSON != "" {
		var testMap interface{}
		if err := json.Unmarshal([]byte(req.VariablesJSON), &testMap); err != nil {
			Error(c, http.StatusBadRequest, "环境变量必须是有效的 JSON 格式")
			return
		}
	} else {
		req.VariablesJSON = "{}"
	}

	tagsJSON := NormalizeTagsJSON(req.ScenarioTags, req.ScenarioTagsJSON)

	env := model.Environment{
		Name:             req.Name,
		Description:      req.Description,
		VariablesJSON:    req.VariablesJSON,
		ScenarioTagsJSON: tagsJSON,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}
	if err := h.db.Create(&env).Error; err != nil {
		Error(c, http.StatusInternalServerError, "创建环境配置失败: "+err.Error())
		return
	}
	Success(c, env)
}

func (h *EnvironmentHandler) Update(c *gin.Context) {
	id := c.Param("id")
	var env model.Environment
	if err := h.db.First(&env, id).Error; err != nil {
		Error(c, http.StatusNotFound, "环境配置未找到")
		return
	}

	var req struct {
		Name             string      `json:"name"`
		Description      string      `json:"description"`
		VariablesJSON    string      `json:"variables_json"`
		ScenarioTagsJSON string      `json:"scenario_tags_json"`
		ScenarioTags     interface{} `json:"scenario_tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "请求参数校验失败: "+err.Error())
		return
	}

	if req.VariablesJSON != "" {
		var testMap interface{}
		if err := json.Unmarshal([]byte(req.VariablesJSON), &testMap); err != nil {
			Error(c, http.StatusBadRequest, "环境变量必须是有效的 JSON 格式")
			return
		}
		env.VariablesJSON = req.VariablesJSON
	}

	if req.Name != "" {
		env.Name = req.Name
	}
	env.Description = req.Description
	if req.ScenarioTags != nil || req.ScenarioTagsJSON != "" {
		env.ScenarioTagsJSON = NormalizeTagsJSON(req.ScenarioTags, req.ScenarioTagsJSON)
	}
	env.UpdatedAt = time.Now()

	if err := h.db.Save(&env).Error; err != nil {
		Error(c, http.StatusInternalServerError, "更新环境配置失败: "+err.Error())
		return
	}
	Success(c, env)
}

func (h *EnvironmentHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.db.Delete(&model.Environment{}, id).Error; err != nil {
		Error(c, http.StatusInternalServerError, "删除环境配置失败: "+err.Error())
		return
	}
	Success(c, gin.H{"id": id})
}

// ImportYAML 导入 YAML 格式的环境配置
// 支持标准键值对以及带 name/value/description 的列表变量定义
func (h *EnvironmentHandler) ImportYAML(c *gin.Context) {
	var yamlBytes []byte

	// 1. 优先尝试从上传的文件读取
	file, err := c.FormFile("file")
	if err == nil {
		f, openErr := file.Open()
		if openErr != nil {
			Error(c, http.StatusBadRequest, "打开上传文件失败: "+openErr.Error())
			return
		}
		defer f.Close()
		yamlBytes, _ = io.ReadAll(f)
	} else {
		// 2. 尝试从 JSON 请求体读取 yaml_content
		var req struct {
			YamlContent string `json:"yaml_content"`
		}
		if err := c.ShouldBindJSON(&req); err == nil && req.YamlContent != "" {
			yamlBytes = []byte(req.YamlContent)
		} else {
			// 3. 尝试读取 Raw Body
			raw, _ := c.GetRawData()
			if len(raw) > 0 {
				yamlBytes = raw
			}
		}
	}

	if len(yamlBytes) == 0 {
		Error(c, http.StatusBadRequest, "未能获取到有效的 YAML 内容，请提供 yaml_content 或上传文件")
		return
	}

	// 尝试作为单个环境对象解析
	var singleEnv map[string]interface{}
	if err := yaml.Unmarshal(yamlBytes, &singleEnv); err == nil && singleEnv != nil {
		if _, hasName := singleEnv["name"]; hasName {
			env, err := h.parseAndSaveSingleEnv(singleEnv)
			if err != nil {
				Error(c, http.StatusBadRequest, err.Error())
				return
			}
			Success(c, env)
			return
		}
	}

	// 尝试作为多环境数组解析
	var listEnvs []map[string]interface{}
	if err := yaml.Unmarshal(yamlBytes, &listEnvs); err == nil && len(listEnvs) > 0 {
		var results []model.Environment
		for _, item := range listEnvs {
			env, err := h.parseAndSaveSingleEnv(item)
			if err != nil {
				Error(c, http.StatusBadRequest, err.Error())
				return
			}
			results = append(results, *env)
		}
		Success(c, results)
		return
	}

	Error(c, http.StatusBadRequest, "YAML 格式不符合规范，根节点需包含 name 与 variables")
}

// parseAndSaveSingleEnv 解析并存入环境配置
func (h *EnvironmentHandler) parseAndSaveSingleEnv(item map[string]interface{}) (*model.Environment, error) {
	nameRaw, ok := item["name"]
	if !ok || nameRaw == nil {
		return nil, errors.New("缺少必要的环境名称 (name)")
	}
	name := fmt.Sprintf("%v", nameRaw)
	if name == "" {
		return nil, errors.New("环境名称 (name) 不能为空")
	}

	desc := ""
	if descRaw, ok := item["description"]; ok && descRaw != nil {
		desc = fmt.Sprintf("%v", descRaw)
	}

	varMap := make(map[string]interface{})

	// 提取 variables
	if varsRaw, ok := item["variables"]; ok && varsRaw != nil {
		switch v := varsRaw.(type) {
		case []interface{}:
			// 列表形式: [{name: "base_url", value: "...", description: ""}, ...]
			for _, elem := range v {
				if elemMap, ok := elem.(map[string]interface{}); ok {
					var k string
					if n, exists := elemMap["name"]; exists && n != nil {
						k = fmt.Sprintf("%v", n)
					} else if n, exists := elemMap["key"]; exists && n != nil {
						k = fmt.Sprintf("%v", n)
					}
					if k != "" {
						val := elemMap["value"]
						varMap[k] = val
					}
				}
			}
		case map[string]interface{}:
			// 字典映射形式: {base_url: "...", api_key: "..."}
			for k, val := range v {
				varMap[k] = val
			}
		}
	}

	varBytes, _ := json.MarshalIndent(varMap, "", "  ")

	var env model.Environment
	err := h.db.Where("name = ?", name).First(&env).Error
	now := time.Now()
	if errors.Is(err, gorm.ErrRecordNotFound) {
		env = model.Environment{
			Name:          name,
			Description:   desc,
			VariablesJSON: string(varBytes),
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		if err := h.db.Create(&env).Error; err != nil {
			return nil, fmt.Errorf("创建环境配置失败: %w", err)
		}
	} else if err == nil {
		if desc != "" {
			env.Description = desc
		}
		env.VariablesJSON = string(varBytes)
		env.UpdatedAt = now
		if err := h.db.Save(&env).Error; err != nil {
			return nil, fmt.Errorf("更新环境配置失败: %w", err)
		}
	} else {
		return nil, err
	}

	return &env, nil
}
