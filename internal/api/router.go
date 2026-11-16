package api

import (
	"io/fs"
	"net/http"
	"strings"

	"agent-evaluation/internal/engine"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// SetupRouter 初始化 Gin 路由与静态内嵌托管
func SetupRouter(db *gorm.DB, runner *engine.TaskRunner, staticFS fs.FS) *gin.Engine {
	r := gin.Default()

	// CORS 跨域配置 (支持本地开发 pnpm dev)
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-API-Key")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// 认证与会话中间件 (飞书 SSO 拦截与当前用户载入)
	r.Use(AuthMiddleware(db))

	// 注册 RESTful API v1
	v1 := r.Group("/api/v1")
	{
		// 认证与飞书 SSO 登录
		authHandler := NewAuthHandler(db)
		v1.GET("/auth/config", authHandler.GetConfig)
		v1.GET("/auth/feishu/url", authHandler.GetFeishuAuthURL)
		v1.GET("/auth/feishu/callback", authHandler.FeishuCallback)
		v1.POST("/auth/feishu/login", authHandler.FeishuLogin)
		v1.POST("/auth/login", authHandler.PasswordLogin)
		v1.POST("/auth/dev-login", authHandler.DevLogin)
		v1.GET("/auth/me", authHandler.GetMe)

		// 环境配置 (admin, developer 可编辑，tester 仅可读取)
		envHandler := NewEnvironmentHandler(db)
		v1.GET("/environments", RequireRoles("admin", "developer", "tester"), envHandler.List)
		v1.GET("/environments/:id", RequireRoles("admin", "developer", "tester"), envHandler.Get)
		v1.POST("/environments", RequireRoles("admin", "developer"), envHandler.Create)
		v1.PUT("/environments/:id", RequireRoles("admin", "developer"), envHandler.Update)
		v1.DELETE("/environments/:id", RequireRoles("admin", "developer"), envHandler.Delete)
		v1.POST("/environments/import-yaml", RequireRoles("admin", "developer"), envHandler.ImportYAML)

		// 场景配置 (admin, developer 可编辑与试跑，tester 仅可读取)
		scHandler := NewScenarioHandler(db)
		v1.GET("/scenarios", RequireRoles("admin", "developer", "tester"), scHandler.List)
		v1.GET("/scenarios/:id", RequireRoles("admin", "developer", "tester"), scHandler.Get)
		v1.POST("/scenarios", RequireRoles("admin", "developer"), scHandler.Create)
		v1.PUT("/scenarios/:id", RequireRoles("admin", "developer"), scHandler.Update)
		v1.DELETE("/scenarios/:id", RequireRoles("admin", "developer"), scHandler.Delete)
		v1.POST("/scenarios/test-run", RequireRoles("admin", "developer"), scHandler.TestRun)

		// 用例集与用例 (admin, developer, tester 均有权限)
		dsHandler := NewDatasetHandler(db)
		v1.GET("/datasets", RequireRoles("admin", "developer", "tester"), dsHandler.ListDatasets)
		v1.GET("/datasets/:id", RequireRoles("admin", "developer", "tester"), dsHandler.GetDataset)
		v1.POST("/datasets", RequireRoles("admin", "developer", "tester"), dsHandler.CreateDataset)
		v1.PUT("/datasets/:id", RequireRoles("admin", "developer", "tester"), dsHandler.UpdateDataset)
		v1.DELETE("/datasets/:id", RequireRoles("admin", "developer", "tester"), dsHandler.DeleteDataset)
		v1.GET("/datasets/:id/cases", RequireRoles("admin", "developer", "tester"), dsHandler.ListCases)
		v1.POST("/datasets/:id/cases", RequireRoles("admin", "developer", "tester"), dsHandler.CreateCase)
		v1.PUT("/cases/:case_id", RequireRoles("admin", "developer", "tester"), dsHandler.UpdateCase)
		v1.DELETE("/cases/:case_id", RequireRoles("admin", "developer", "tester"), dsHandler.DeleteCase)
		v1.GET("/cases/:case_id/latest-run", RequireRoles("admin", "developer", "tester"), dsHandler.GetCaseLatestRun)
		v1.POST("/datasets/:id/cases/batch", RequireRoles("admin", "developer", "tester"), dsHandler.BatchImportCases)
		v1.GET("/datasets/:id/export", RequireRoles("admin", "developer", "tester"), dsHandler.ExportCases)

		// 评测模块 (admin, developer 可编辑与试跑，tester 仅可读取)
		evHandler := NewEvaluatorHandler(db)
		v1.GET("/evaluators", RequireRoles("admin", "developer", "tester"), evHandler.List)
		v1.GET("/evaluators/:id", RequireRoles("admin", "developer", "tester"), evHandler.Get)
		v1.POST("/evaluators", RequireRoles("admin", "developer"), evHandler.Create)
		v1.PUT("/evaluators/:id", RequireRoles("admin", "developer"), evHandler.Update)
		v1.DELETE("/evaluators/:id", RequireRoles("admin", "developer"), evHandler.Delete)
		v1.POST("/evaluators/test-run", RequireRoles("admin", "developer"), evHandler.TestRun)

		// 评测任务 (admin, developer, tester 均可创建、修改、执行与删除)
		taskHandler := NewTaskHandler(db, runner)
		v1.GET("/tasks", RequireRoles("admin", "developer", "tester"), taskHandler.List)
		v1.GET("/tasks/:id", RequireRoles("admin", "developer", "tester"), taskHandler.Get)
		v1.POST("/tasks", RequireRoles("admin", "developer", "tester"), taskHandler.Create)
		v1.PUT("/tasks/:id", RequireRoles("admin", "developer", "tester"), taskHandler.Update)
		v1.DELETE("/tasks/:id", RequireRoles("admin", "developer", "tester"), taskHandler.Delete)
		v1.POST("/tasks/:id/run", RequireRoles("admin", "developer", "tester"), taskHandler.Run)

		// 运行记录与人工复核 (admin, developer, tester 均可查看与质检复核)
		runHandler := NewRunHandler(db)
		v1.GET("/runs", RequireRoles("admin", "developer", "tester"), runHandler.List)
		v1.GET("/runs/:id", RequireRoles("admin", "developer", "tester"), runHandler.Get)
		v1.DELETE("/runs/:id", RequireRoles("admin", "developer", "tester"), runHandler.Delete)
		v1.GET("/runs/:id/items", RequireRoles("admin", "developer", "tester"), runHandler.ListItems)
		v1.POST("/runs/:id/items/:item_id/review", RequireRoles("admin", "developer", "tester"), runHandler.ReviewItem)

		// 系统全局配置 (严格仅限 admin 管理员)
		sysHandler := NewSystemConfigHandler(db)
		v1.GET("/system-configs", RequireRoles("admin"), sysHandler.List)
		v1.PUT("/system-configs", RequireRoles("admin"), sysHandler.BatchUpdate)

		// 编码 Agent 专属开放接口 (OpenAPI)
		openAPIHandler := NewOpenAPIHandler(db, runner)
		v1.GET("/openapi/skill/download", openAPIHandler.DownloadSkillTarGz)
		v1.GET("/openapi/config", openAPIHandler.GetOpenAPIConfig)

		// 需守卫的评测调度接口 (包含本地免鉴权与远程 API Key 守卫)
		openapiGroup := v1.Group("/openapi")
		openapiGroup.Use(OpenAPIAuthMiddleware(db))
		{
			openapiGroup.GET("/tasks", openAPIHandler.ListTasks)
			openapiGroup.POST("/tasks/:id/trigger", openAPIHandler.TriggerTask)
			openapiGroup.GET("/runs/:run_id/status", openAPIHandler.GetRunStatus)
			openapiGroup.GET("/runs/:run_id/summary", openAPIHandler.GetRunSummary)
		}
	}

	// 生产环境内嵌托管 React SPA 静态资源
	if staticFS != nil {
		fileServer := http.FileServer(http.FS(staticFS))
		r.NoRoute(func(c *gin.Context) {
			path := c.Request.URL.Path
			// 如果是 API 请求，则返回 404
			if strings.HasPrefix(path, "/api") {
				c.JSON(http.StatusNotFound, gin.H{"error": "API route not found"})
				return
			}

			// 检查静态文件是否存在
			f, err := staticFS.Open(strings.TrimPrefix(path, "/"))
			if err == nil {
				_ = f.Close()
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}

			// SPA Fallback: 默认返回 index.html
			c.Request.URL.Path = "/"
			fileServer.ServeHTTP(c.Writer, c.Request)
		})
	}

	return r
}
