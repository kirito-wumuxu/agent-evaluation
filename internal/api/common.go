package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Response 统一响应结构
type Response struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

func Success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Code:    0,
		Message: "success",
		Data:    data,
	})
}

func Error(c *gin.Context, httpCode int, message string) {
	c.JSON(httpCode, Response{
		Code:    -1,
		Message: message,
	})
}

// NormalizeTagsJSON 规范化场景标签 JSON
func NormalizeTagsJSON(rawTags interface{}, rawJSON string) string {
	if rawTags != nil {
		switch v := rawTags.(type) {
		case []string:
			if len(v) == 0 {
				return `["*"]`
			}
			b, _ := json.Marshal(v)
			return string(b)
		case []interface{}:
			var sList []string
			for _, item := range v {
				s := strings.TrimSpace(fmt.Sprintf("%v", item))
				if s != "" {
					sList = append(sList, s)
				}
			}
			if len(sList) == 0 {
				return `["*"]`
			}
			b, _ := json.Marshal(sList)
			return string(b)
		case string:
			trimmed := strings.TrimSpace(v)
			if trimmed != "" {
				var testArr []string
				if err := json.Unmarshal([]byte(trimmed), &testArr); err == nil {
					if len(testArr) == 0 {
						return `["*"]`
					}
					return trimmed
				}
				parts := strings.Split(trimmed, ",")
				var sList []string
				for _, p := range parts {
					if t := strings.TrimSpace(p); t != "" {
						sList = append(sList, t)
					}
				}
				if len(sList) == 0 {
					return `["*"]`
				}
				b, _ := json.Marshal(sList)
				return string(b)
			}
		}
	}
	if strings.TrimSpace(rawJSON) != "" {
		var testArr []string
		if err := json.Unmarshal([]byte(rawJSON), &testArr); err == nil {
			if len(testArr) == 0 {
				return `["*"]`
			}
			return rawJSON
		}
	}
	return `["*"]`
}
